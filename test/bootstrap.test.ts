import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { bootstrap } from '../src/server/bootstrap.ts';
import { DEV_DEMOS, DEV_PASSWORD, DEV_POS_API_KEY, DEV_SUPPORT_WHATSAPP, DEV_TENANTS, DEV_USERS } from '../src/server/seeds/dev-fixtures.ts';
import { readBillingSettings, writeBillingSettings } from '../src/server/billing/settings.ts';
import { hashApiKey } from '../src/server/auth/crypto.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

async function boot(env: NodeJS.ProcessEnv) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const tenantManager = new TenantManager(pgDb().system, { inMemory: true });
  const bundle = createApp({ database: pgDb(), systemDb, tenantManager });
  const run = async () => {
    const result = await bootstrap({ env, bundle });
    clearInterval(result.sweeper);
    clearInterval(result.billingSweeper);
    clearInterval(result.funnelSweeper);
    return result;
  };
  return { result: await run(), run, systemDb, tenantManager, bundle };
}

const n = (db: DatabaseSync, sql: string, ...params: string[]): number => (db.prepare(sql).get(...params) as { n: number }).n;

type Counted = 'users' | 'tenants' | 'memberships' | 'tenant_api_keys' | 'gift_credits' | 'charges' | 'paid_movements' | 'demo_sessions' | 'demo_tenants';
const pgCount = async (table: Counted): Promise<number> =>
  (await pgDb().system.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n;

async function counts() {
  return {
    users: await pgCount('users'),
    tenants: await pgCount('tenants'),
    memberships: await pgCount('memberships'),
    keys: await pgCount('tenant_api_keys'),
    gifts: await pgCount('gift_credits'),
    charges: await pgCount('charges'),
    paid: await pgCount('paid_movements'),
    demos: await pgCount('demo_sessions'),
  };
}

/** Las cajas de demo vivas con esa key: key activa y demo sin revocar. */
async function aliveDemoKeys(rawKey: string) {
  return await pgDb()
    .system.selectFrom('tenant_api_keys as k')
    .innerJoin('demo_sessions as s', 's.register_id', 'k.register_id')
    .select(['s.template', 's.tenant_id'])
    .where('k.key_hash', '=', hashApiKey(rawKey))
    .where('k.active', '=', true)
    .where('s.revoked_at', 'is', null)
    .execute();
}

const [kiosco, almacen, ferreteria] = DEV_TENANTS;
if (kiosco === undefined || almacen === undefined || ferreteria === undefined) throw new Error('Faltan comercios de desarrollo');

describe('bootstrap (#3)', () => {
  it('en producción no siembra nada de desarrollo: solo los tres comercios demo (#24)', async () => {
    const { result } = await boot({ NODE_ENV: 'production' });
    expect(result.devInfo).toBeUndefined();
    const c = await counts();
    expect([c.users, c.tenants, c.keys, c.demos]).toEqual([0, 3, 0, 0]);
  });
});

describe('seed de desarrollo (#21)', () => {
  it('root y soporte no son miembros de ningún comercio', async () => {
    const { systemDb } = await boot({});
    const rows = systemDb
      .prepare('SELECT u.email, u.global_role AS role, (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS n FROM users u WHERE u.email IN (?, ?) ORDER BY u.email')
      .all(DEV_USERS.root.email, DEV_USERS.support.email);
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { email: DEV_USERS.root.email, role: 'root', n: 0 },
      { email: DEV_USERS.support.email, role: 'support', n: 0 },
    ]);
  });

  it('todos entran con la contraseña de desarrollo', async () => {
    const { bundle } = await boot({});
    for (const u of Object.values(DEV_USERS)) {
      await expect(bundle.authService.login({ email: u.email, password: DEV_PASSWORD })).resolves.toBeDefined();
    }
  });

  it('un comercio por rubro: dueño A con Kiosco y Almacén, dueño B con Ferretería, y el staff del Kiosco', async () => {
    const { systemDb } = await boot({});
    const rows = systemDb
      .prepare(
        `SELECT m.tenant_id AS tenant, u.email, m.role, t.holder_user_id = u.id AS holder
         FROM memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id
         ORDER BY m.tenant_id, u.email`,
      )
      .all();
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { tenant: almacen.id, email: DEV_USERS.ownerA.email, role: 'owner', holder: 1 },
      { tenant: ferreteria.id, email: DEV_USERS.ownerB.email, role: 'owner', holder: 1 },
      { tenant: kiosco.id, email: DEV_USERS.adminK.email, role: 'admin', holder: 0 },
      { tenant: kiosco.id, email: DEV_USERS.ownerA.email, role: 'owner', holder: 1 },
      { tenant: kiosco.id, email: DEV_USERS.memberK.email, role: 'member', holder: 0 },
    ]);
  });

  it('cada comercio tiene su rubro, también si se sembró antes de M6 (#22)', async () => {
    const { systemDb, run } = await boot({});
    const rubros = () => systemDb.prepare('SELECT id, business_type FROM tenants WHERE business_type IS NOT NULL ORDER BY id').all();
    const expected = [
      { id: almacen.id, business_type: 'almacen' },
      { id: ferreteria.id, business_type: 'ferreteria' },
      { id: kiosco.id, business_type: 'kiosco' },
    ];
    expect(rubros().map((r) => ({ ...r }))).toEqual(expected);
    systemDb.prepare('UPDATE tenants SET business_type = NULL').run();
    await run();
    expect(rubros().map((r) => ({ ...r }))).toEqual(expected);
  });

  it('cada caja tiene su key fija, y la key de siempre es la Caja 1 del Kiosco', async () => {
    const { systemDb } = await boot({});
    for (const t of DEV_TENANTS) {
      for (const r of t.registers) {
        const row = systemDb
          .prepare('SELECT k.tenant_id, r.point_of_sale FROM tenant_api_keys k JOIN registers r ON r.id = k.register_id WHERE k.key_hash = ? AND k.active = 1')
          .get(hashApiKey(r.rawKey));
        expect({ ...row }).toEqual({ tenant_id: t.id, point_of_sale: r.pointOfSale });
      }
    }
    expect(kiosco.registers[0]?.rawKey).toBe(DEV_POS_API_KEY);
  });

  it('las ventas sembradas son de su caja y cada caja tiene un cargo por día con ventas', async () => {
    const { systemDb, tenantManager } = await boot({});
    for (const t of DEV_TENANTS) {
      const db = tenantManager.getTenantDb(t.id);
      expect(n(db, 'SELECT COUNT(*) AS n FROM sales WHERE register_id IS NULL')).toBe(0);
      const salesDays = db
        .prepare("SELECT register_id || '|' || day AS k FROM sales WHERE voids_sale_id IS NULL GROUP BY register_id, day ORDER BY k")
        .all()
        .map((r) => (r as { k: string }).k);
      const chargeDays = systemDb
        .prepare("SELECT register_id || '|' || day AS k FROM charges WHERE tenant_id = ? ORDER BY k")
        .all(t.id)
        .map((r) => (r as { k: string }).k);
      expect(salesDays.length).toBeGreaterThan(5);
      expect(chargeDays).toEqual(salesDays);
    }
  });

  it('cada comercio muestra un estado de créditos distinto: ok, saldo bajo y deuda en gracia', async () => {
    const { bundle } = await boot({});
    const k = await bundle.billing.summary(kiosco.id);
    const a = await bundle.billing.summary(almacen.id);
    const f = await bundle.billing.summary(ferreteria.id);
    expect([k.state, a.state, f.state]).toEqual(['ok', 'low', 'debt']);
    // El Kiosco consumió de lo pagado y de lo regalado; el Almacén comparte el saldo pagado del dueño A
    expect(k.giftBalance).toBeGreaterThan(0);
    expect(a.paidBalance).toBe(k.paidBalance);
    expect(f.debt).toBeGreaterThan(0);
  });

  it('los regalados pasan por todos los estados: promo usada y bono vigente en el Kiosco, bono anulado en el Almacén, vencido en la Ferretería', async () => {
    const { bundle } = await boot({});
    const status = async (tenantId: string) => (await bundle.billing.listGifts(tenantId)).map((g) => `${g.origin}:${g.status}`).sort();
    expect(await status(kiosco.id)).toEqual(['grant:used', 'signup:active']);
    expect(await status(almacen.id)).toEqual(['grant:active', 'signup:voided']);
    expect(await status(ferreteria.id)).toEqual(['signup:expired']);
    expect((await bundle.billing.listMovements(kiosco.id)).some((m) => m.kind === 'payment')).toBe(true);
  });

  it('carga un WhatsApp de soporte de prueba, sin pisar uno cargado a mano (#23)', async () => {
    const { run } = await boot({});
    expect((await readBillingSettings(pgDb().system)).supportWhatsapp).toBe(DEV_SUPPORT_WHATSAPP);
    await writeBillingSettings(pgDb().system, { supportWhatsapp: '5491177778888' }, 'root', new Date().toISOString());
    await run();
    expect((await readBillingSettings(pgDb().system)).supportWhatsapp).toBe('5491177778888');
  });

  it('crea los tres comercios demo, sin dueño (#24)', async () => {
    await boot({});
    expect(await pgDb().system.selectFrom('demo_tenants').select('tenant_id').orderBy('tenant_id').execute()).toEqual([
      { tenant_id: 'demo-almacen' },
      { tenant_id: 'demo-ferreteria' },
      { tenant_id: 'demo-kiosco' },
    ]);
    const demoMembers = await pgDb().system.selectFrom('memberships').select('tenant_id').where('tenant_id', 'like', 'demo-%').execute();
    expect(demoMembers).toEqual([]);
  });

  it('en producción también crea los comercios demo (#24)', async () => {
    await boot({ NODE_ENV: 'production' });
    expect(await pgCount('demo_tenants')).toBe(3);
  });

  it('hay dos cajas de demo andando, con key fija, en los comercios demo (#24)', async () => {
    await boot({});
    for (const d of DEV_DEMOS) {
      expect(await aliveDemoKeys(d.rawKey)).toEqual([{ template: d.template, tenant_id: `demo-${d.template}` }]);
    }
  });

  it('una caja de demo revocada se vuelve a crear al arrancar, con la misma key (#24)', async () => {
    const { bundle, run } = await boot({});
    const first = DEV_DEMOS[0];
    if (first === undefined) throw new Error('Faltan demos');
    await bundle.demoSessions.revokeTenant(`demo-${first.template}`, 'reset');
    await run();
    expect(await aliveDemoKeys(first.rawKey)).toHaveLength(1);
  });

  it('arrancar otra vez no duplica nada', async () => {
    const { run } = await boot({});
    const before = await counts();
    await run();
    expect(await counts()).toEqual(before);
  });

  it('devuelve los usuarios y las keys para el log del arranque', async () => {
    const { result } = await boot({});
    expect(result.devInfo?.password).toBe(DEV_PASSWORD);
    expect(result.devInfo?.users.map((u) => u.email)).toContain(DEV_USERS.root.email);
    expect(result.devInfo?.keys.map((k) => k.rawKey)).toEqual(
      expect.arrayContaining([DEV_POS_API_KEY, ...DEV_DEMOS.map((d) => d.rawKey)]),
    );
  });
});
