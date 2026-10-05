import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { bootstrap } from '../src/server/bootstrap.ts';
import { DEV_DEMOS, DEV_PASSWORD, DEV_POS_API_KEY, DEV_SUPPORT_WHATSAPP, DEV_TENANTS, DEV_USERS } from '../src/server/seeds/dev-fixtures.ts';
import { readBillingSettings, writeBillingSettings } from '../src/server/billing/settings.ts';
import { hashApiKey } from '../src/server/auth/crypto.ts';

function boot(env: NodeJS.ProcessEnv) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const tenantManager = new TenantManager(systemDb, { inMemory: true });
  const bundle = createApp({ systemDb, tenantManager });
  const run = () => {
    const result = bootstrap({ env, bundle });
    clearInterval(result.sweeper);
    clearInterval(result.billingSweeper);
    return result;
  };
  return { result: run(), run, systemDb, tenantManager, bundle };
}

const n = (db: DatabaseSync, sql: string, ...params: string[]): number => (db.prepare(sql).get(...params) as { n: number }).n;

function counts(db: DatabaseSync) {
  return {
    users: n(db, 'SELECT COUNT(*) AS n FROM users'),
    tenants: n(db, 'SELECT COUNT(*) AS n FROM tenants'),
    memberships: n(db, 'SELECT COUNT(*) AS n FROM memberships'),
    keys: n(db, 'SELECT COUNT(*) AS n FROM tenant_api_keys'),
    gifts: n(db, 'SELECT COUNT(*) AS n FROM gift_credits'),
    charges: n(db, 'SELECT COUNT(*) AS n FROM charges'),
    paid: n(db, 'SELECT COUNT(*) AS n FROM paid_movements'),
    demos: n(db, 'SELECT COUNT(*) AS n FROM demo_sessions'),
  };
}

const [kiosco, almacen, ferreteria] = DEV_TENANTS;
if (kiosco === undefined || almacen === undefined || ferreteria === undefined) throw new Error('Faltan comercios de desarrollo');

describe('bootstrap (#3)', () => {
  it('en producción no siembra nada', () => {
    const { result, systemDb } = boot({ NODE_ENV: 'production' });
    expect(result.devInfo).toBeUndefined();
    const c = counts(systemDb);
    expect([c.users, c.tenants, c.keys, c.demos]).toEqual([0, 0, 0, 0]);
  });
});

describe('seed de desarrollo (#21)', () => {
  it('root y soporte no son miembros de ningún comercio', () => {
    const { systemDb } = boot({});
    const rows = systemDb
      .prepare('SELECT u.email, u.global_role AS role, (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS n FROM users u WHERE u.email IN (?, ?) ORDER BY u.email')
      .all(DEV_USERS.root.email, DEV_USERS.support.email);
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { email: DEV_USERS.root.email, role: 'root', n: 0 },
      { email: DEV_USERS.support.email, role: 'support', n: 0 },
    ]);
  });

  it('todos entran con la contraseña de desarrollo', () => {
    const { bundle } = boot({});
    for (const u of Object.values(DEV_USERS)) {
      expect(() => bundle.authService.login({ email: u.email, password: DEV_PASSWORD })).not.toThrow();
    }
  });

  it('un comercio por rubro: dueño A con Kiosco y Almacén, dueño B con Ferretería, y el staff del Kiosco', () => {
    const { systemDb } = boot({});
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

  it('cada comercio tiene su rubro, también si se sembró antes de M6 (#22)', () => {
    const { systemDb, run } = boot({});
    const rubros = () => systemDb.prepare('SELECT id, business_type FROM tenants WHERE business_type IS NOT NULL ORDER BY id').all();
    const expected = [
      { id: almacen.id, business_type: 'almacen' },
      { id: ferreteria.id, business_type: 'ferreteria' },
      { id: kiosco.id, business_type: 'kiosco' },
    ];
    expect(rubros().map((r) => ({ ...r }))).toEqual(expected);
    systemDb.prepare('UPDATE tenants SET business_type = NULL').run();
    run();
    expect(rubros().map((r) => ({ ...r }))).toEqual(expected);
  });

  it('cada caja tiene su key fija, y la key de siempre es la Caja 1 del Kiosco', () => {
    const { systemDb } = boot({});
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

  it('las ventas sembradas son de su caja y cada caja tiene un cargo por día con ventas', () => {
    const { systemDb, tenantManager } = boot({});
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

  it('cada comercio muestra un estado de créditos distinto: ok, saldo bajo y deuda en gracia', () => {
    const { bundle } = boot({});
    const k = bundle.billing.summary(kiosco.id);
    const a = bundle.billing.summary(almacen.id);
    const f = bundle.billing.summary(ferreteria.id);
    expect([k.state, a.state, f.state]).toEqual(['ok', 'low', 'debt']);
    // El Kiosco consumió de lo pagado y de lo regalado; el Almacén comparte el saldo pagado del dueño A
    expect(k.giftBalance).toBeGreaterThan(0);
    expect(a.paidBalance).toBe(k.paidBalance);
    expect(f.debt).toBeGreaterThan(0);
  });

  it('los regalados pasan por todos los estados: promo usada y bono vigente en el Kiosco, bono anulado en el Almacén, vencido en la Ferretería', () => {
    const { bundle } = boot({});
    const status = (tenantId: string) => bundle.billing.listGifts(tenantId).map((g) => `${g.origin}:${g.status}`).sort();
    expect(status(kiosco.id)).toEqual(['grant:used', 'signup:active']);
    expect(status(almacen.id)).toEqual(['grant:active', 'signup:voided']);
    expect(status(ferreteria.id)).toEqual(['signup:expired']);
    expect(bundle.billing.listMovements(kiosco.id).some((m) => m.kind === 'payment')).toBe(true);
  });

  it('carga un WhatsApp de soporte de prueba, sin pisar uno cargado a mano (#23)', () => {
    const { systemDb, run } = boot({});
    expect(readBillingSettings(systemDb).supportWhatsapp).toBe(DEV_SUPPORT_WHATSAPP);
    writeBillingSettings(systemDb, { supportWhatsapp: '5491177778888' }, 'root', new Date().toISOString());
    run();
    expect(readBillingSettings(systemDb).supportWhatsapp).toBe('5491177778888');
  });

  it('hay dos demos andando, sin dueño y con key fija', () => {
    const { systemDb } = boot({});
    for (const d of DEV_DEMOS) {
      const row = systemDb
        .prepare(
          `SELECT s.template, (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = s.tenant_id) AS members
           FROM tenant_api_keys k JOIN demo_sessions s ON s.tenant_id = k.tenant_id WHERE k.key_hash = ?`,
        )
        .get(hashApiKey(d.rawKey));
      expect({ ...row }).toEqual({ template: d.template, members: 0 });
    }
  });

  it('una demo vencida se vuelve a crear al arrancar', () => {
    const { systemDb, tenantManager, run } = boot({});
    const first = DEV_DEMOS[0];
    if (first === undefined) throw new Error('Faltan demos');
    const row = systemDb
      .prepare('SELECT k.tenant_id FROM tenant_api_keys k WHERE k.key_hash = ?')
      .get(hashApiKey(first.rawKey)) as { tenant_id: string };
    tenantManager.deleteTenant(row.tenant_id);
    run();
    expect(n(systemDb, 'SELECT COUNT(*) AS n FROM tenant_api_keys k JOIN demo_sessions s ON s.tenant_id = k.tenant_id WHERE k.key_hash = ?', hashApiKey(first.rawKey))).toBe(1);
  });

  it('arrancar otra vez no duplica nada', () => {
    const { systemDb, run } = boot({});
    const before = counts(systemDb);
    run();
    expect(counts(systemDb)).toEqual(before);
  });

  it('devuelve los usuarios y las keys para el log del arranque', () => {
    const { result } = boot({});
    expect(result.devInfo?.password).toBe(DEV_PASSWORD);
    expect(result.devInfo?.users.map((u) => u.email)).toContain(DEV_USERS.root.email);
    expect(result.devInfo?.keys.map((k) => k.rawKey)).toEqual(
      expect.arrayContaining([DEV_POS_API_KEY, ...DEV_DEMOS.map((d) => d.rawKey)]),
    );
  });
});
