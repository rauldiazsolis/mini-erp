import { sql, type Kysely } from 'kysely';
import type { SystemDatabase } from './pg/system-schema.ts';
import type { AuthService } from '../auth/auth-service.ts';
import type { TenantManager } from './tenant-manager.ts';
import { hashApiKey } from '../auth/crypto.ts';
import type { BillingService } from '../billing/billing-service.ts';
import type { DemoSessionService } from '../demo/demo-session-service.ts';
import { generateHistoricalDemoActivity, seedDemoSession } from '../seeds/index.ts';
import {
  DEV_BRANCH,
  DEV_DEMOS,
  DEV_PASSWORD,
  DEV_SUPPORT_WHATSAPP,
  DEV_TENANTS,
  DEV_USERS,
  type DevTenant,
  type DevUserKey,
} from '../seeds/dev-fixtures.ts';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';

/** Lo que el arranque muestra en el log: con qué entrar y qué keys conectar al POS. */
export type DevInfo = {
  password: string;
  users: { email: string; label: string }[];
  keys: { rawKey: string; label: string }[];
};

type Deps = {
  /** Lo global, en PostgreSQL (`Database.system`); los comercios siguen en SQLite. */
  db: Kysely<SystemDatabase>;
  authService: AuthService;
  tenantManager: TenantManager;
  billing: BillingService;
  demoSessions: DemoSessionService;
};

type UserIds = Record<DevUserKey, string>;

/**
 * Datos de desarrollo (#21): usuarios de cada rol, un comercio por rubro con un estado de créditos
 * distinto y un par de demos. Idempotente: lo que ya existe no se toca; una demo vencida se vuelve
 * a crear. Para sembrar de nuevo, se borra la carpeta de datos de desarrollo.
 */
export async function ensureDevData(deps: Deps): Promise<DevInfo> {
  const ids = await ensureUsers(deps);
  // Sin WhatsApp de soporte no hay "Pedir ayuda" (#23); no pisa uno cargado a mano
  if ((await deps.billing.settings()).supportWhatsapp === '') {
    await deps.billing.updateSettings({ supportWhatsapp: DEV_SUPPORT_WHATSAPP }, ids.root);
  }
  // En orden: el Almacén usa lo que el Kiosco dejó del saldo pagado del dueño A
  for (const tenant of DEV_TENANTS) {
    if (!(await deps.tenantManager.tenantExists(tenant.id))) await seedTenant(deps, tenant, ids);
    // Los sembrados antes de M6 no tienen rubro (#22)
    await deps.db.updateTable('tenants').set({ business_type: tenant.preset }).where('id', '=', tenant.id).where('business_type', 'is', null).execute();
  }
  await ensureDemos(deps);
  return devInfo();
}

async function ensureUsers(deps: Deps): Promise<UserIds> {
  const ids: Partial<UserIds> = {};
  for (const [key, u] of Object.entries(DEV_USERS) as [DevUserKey, { email: string; name: string }][]) {
    if (key === 'root') {
      ids[key] = (await deps.authService.ensureRoot({ email: u.email, password: DEV_PASSWORD, name: u.name })).user.id;
      continue;
    }
    const existing = await deps.authService.findUserByEmail(u.email);
    const id = existing?.id ?? (await deps.authService.createUser({ email: u.email, password: DEV_PASSWORD, name: u.name })).user.id;
    // Las cuentas nacen como user: el soporte se marca acá, como lo haría root a mano
    if (key === 'support') await deps.db.updateTable('users').set({ global_role: 'support' }).where('id', '=', id).execute();
    ids[key] = id;
  }
  const { root, support, ownerA, ownerB, adminK, memberK } = ids;
  if (root === undefined || support === undefined || ownerA === undefined || ownerB === undefined || adminK === undefined || memberK === undefined) {
    throw new Error('Faltan usuarios de desarrollo');
  }
  return { root, support, ownerA, ownerB, adminK, memberK };
}

async function seedTenant(deps: Deps, t: DevTenant, ids: UserIds): Promise<void> {
  const now = new Date();
  await deps.tenantManager.createTenant({ id: t.id, slug: t.id, name: t.name, ownerUserId: ids[t.owner], businessType: t.preset });
  const db = deps.tenantManager.getTenantDb(t.id);
  // El catálogo del rubro y los clientes, como una demo
  await seedDemoSession(db, t.preset);

  const at = now.toISOString();
  // El staff y las cajas con su key fija, juntos
  await deps.db.transaction().execute(async (trx) => {
    for (const s of t.staff) {
      await trx
        .insertInto('memberships')
        .values({ user_id: ids[s.user], tenant_id: t.id, role: s.role, status: 'active', created_at: at })
        .onConflict((oc) => oc.columns(['user_id', 'tenant_id']).doNothing())
        .execute();
    }
    for (const r of t.registers) await insertRegisterWithKey(trx, t.id, r, at);
  });

  const branchId = (db.prepare('SELECT id FROM branches ORDER BY created_at LIMIT 1').get() as { id: string }).id;
  for (const [index, r] of t.registers.entries()) {
    // Las ventas quedan de su caja, sin equipo ligado: el primer POS que se conecte con la key la liga
    await generateHistoricalDemoActivity(db, branchId, now, {
      days: r.historyDays,
      idPrefix: index === 0 ? '' : `c${String(index + 1)}_`,
      origin: { deviceId: `pos_caja_${String(index + 1)}`, branch: DEV_BRANCH, pointOfSale: r.pointOfSale, registerId: r.id, chargeDevice: '' },
    });
  }

  await seedCredits(deps, t, ids, now);
}

async function insertRegisterWithKey(db: Kysely<SystemDatabase>, tenantId: string, r: DevTenant['registers'][number], at: string): Promise<void> {
  await db
    .insertInto('registers')
    .values({ id: r.id, tenant_id: tenantId, name: r.name, branch: DEV_BRANCH, point_of_sale: r.pointOfSale, active: true, created_at: at })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  await db
    .insertInto('tenant_api_keys')
    .values({
      id: r.keyId,
      tenant_id: tenantId,
      name: r.name,
      key_hash: hashApiKey(r.rawKey),
      key_prefix: r.rawKey.slice(0, 10),
      branch: DEV_BRANCH,
      point_of_sale: r.pointOfSale,
      active: true,
      created_at: at,
      register_id: r.id,
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}

/**
 * El estado de créditos del comercio, armado con las mismas operaciones que usa la plataforma.
 * Precio de 1000 por caja y día, mitad de lo pagado y mitad de lo regalado (configuración por defecto).
 */
async function seedCredits(deps: Deps, t: DevTenant, ids: UserIds, now: Date): Promise<void> {
  const { billing } = deps;
  const today = argentinaToday(now);
  const db = deps.tenantManager.getTenantDb(t.id);
  const bonusId = await billing.grantSignupBonus(t.id, ids[t.owner]);

  /** Un cargo por caja y día con ventas, entre `from` y `to` (inclusive). */
  const chargeSales = async (from: string, to: string): Promise<void> => {
    for (const r of t.registers) {
      const days = db
        .prepare('SELECT DISTINCT day FROM sales WHERE register_id = ? AND voids_sale_id IS NULL AND day BETWEEN ? AND ? ORDER BY day')
        .all(r.id, from, to)
        .map((row) => (row as { day: string }).day);
      await billing.charge({ tenantId: t.id, registerId: r.id, chargeDevice: '', days });
    }
  };
  const all = { from: '0000-00-00', to: today };

  switch (t.credits) {
    case 'ok':
      // Pagó hace 25 días y tuvo una promo (vence antes que el bono, se usa primero): le sobra regalado
      await billing.registerPayment({ tenantId: t.id, day: shiftDay(today, -25), amount: 22000, info: 'Transferencia', actorUserId: ids.root });
      await billing.grantCredits({ tenantId: t.id, amount: 10000, expiresOn: shiftDay(today, 60), reason: 'Promo de lanzamiento', actorUserId: ids.root });
      await chargeSales(all.from, all.to);
      break;
    case 'low':
      // Usa lo que quedó del pago (compartido con el Kiosco), le anulan el bono y le queda un crédito chico
      await chargeSales(all.from, all.to);
      await billing.voidCredit({ tenantId: t.id, creditId: bonusId, reason: 'Bono duplicado', actorUserId: ids.root });
      await billing.grantCredits({ tenantId: t.id, amount: 4000, expiresOn: shiftDay(today, 15), reason: 'Crédito de cortesía', actorUserId: ids.root });
      break;
    case 'debt': {
      // El bono venció hace 4 días y nunca pagó: lo de esos días es deuda, todavía en gracia
      const cut = shiftDay(today, -4);
      await chargeSales(all.from, shiftDay(cut, -1));
      await deps.db.updateTable('gift_credits').set({ expires_at: `${cut}T03:00:00.000Z` }).where('id', '=', bonusId).execute();
      await chargeSales(cut, today);
      break;
    }
  }
}

/**
 * Las cajas de demo con key fija (#24): si no hay una viva con esa key (un reinicio o la inactividad
 * la revocaron), se crea otra caja de visitante y se le pone la key. La revocada suelta el hash, que es único.
 */
async function ensureDemos(deps: Deps): Promise<void> {
  if (!deps.demoSessions.enabled()) return;
  for (const d of DEV_DEMOS) {
    const hash = hashApiKey(d.rawKey);
    const alive = await deps.db
      .selectFrom('tenant_api_keys as k')
      .innerJoin('demo_sessions as s', 's.register_id', 'k.register_id')
      .select('k.id')
      .where('k.key_hash', '=', hash)
      .where('k.active', '=', true)
      .where('s.revoked_at', 'is', null)
      .executeTakeFirst();
    if (alive !== undefined) continue;
    await deps.db
      .updateTable('tenant_api_keys')
      .set({ key_hash: sql<string>`${sql.ref('key_hash')} || ':revocada:' || ${sql.ref('id')}` })
      .where('key_hash', '=', hash)
      .execute();
    const session = await deps.demoSessions.create(d.template);
    await deps.db
      .updateTable('tenant_api_keys')
      .set({ key_hash: hash, key_prefix: d.rawKey.slice(0, 10) })
      .where('register_id', '=', (eb) => eb.selectFrom('demo_sessions').select('register_id').where('id', '=', session.sessionId))
      .execute();
  }
}

function devInfo(): DevInfo {
  const ownerOf = (key: DevUserKey): string => {
    const names = DEV_TENANTS.filter((t) => t.owner === key).map((t) => t.name);
    const staff = DEV_TENANTS.flatMap((t) => t.staff.filter((s) => s.user === key).map((s) => `${s.role} de ${t.name}`));
    return [...(names.length > 0 ? [`owner de ${names.join(' y ')}`] : []), ...staff].join(', ');
  };
  const label: Record<DevUserKey, string> = {
    root: 'root, sin comercios',
    support: 'soporte, sin comercios',
    ownerA: ownerOf('ownerA'),
    ownerB: ownerOf('ownerB'),
    adminK: ownerOf('adminK'),
    memberK: ownerOf('memberK'),
  };
  return {
    password: DEV_PASSWORD,
    users: (Object.keys(DEV_USERS) as DevUserKey[]).map((key) => ({ email: DEV_USERS[key].email, label: label[key] })),
    keys: [
      ...DEV_TENANTS.flatMap((t) => t.registers.map((r) => ({ rawKey: r.rawKey, label: `${t.name} · ${r.name}` }))),
      ...DEV_DEMOS.map((d) => ({ rawKey: d.rawKey, label: `Demo ${d.template}` })),
    ],
  };
}
