import type { DatabaseSync } from 'node:sqlite';
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
import { readBillingSettings, writeBillingSettings } from '../billing/settings.ts';

/** Lo que el arranque muestra en el log: con qué entrar y qué keys conectar al POS. */
export type DevInfo = {
  password: string;
  users: { email: string; label: string }[];
  keys: { rawKey: string; label: string }[];
};

type Deps = {
  systemDb: DatabaseSync;
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
export function ensureDevData(deps: Deps): DevInfo {
  const ids = ensureUsers(deps);
  // Sin WhatsApp de soporte no hay "Pedir ayuda" (#23); no pisa uno cargado a mano
  if (readBillingSettings(deps.systemDb).supportWhatsapp === '') {
    writeBillingSettings(deps.systemDb, { supportWhatsapp: DEV_SUPPORT_WHATSAPP }, ids.root, new Date().toISOString());
  }
  // En orden: el Almacén usa lo que el Kiosco dejó del saldo pagado del dueño A
  for (const tenant of DEV_TENANTS) {
    if (!deps.tenantManager.tenantExists(tenant.id)) seedTenant(deps, tenant, ids);
    // Los sembrados antes de M6 no tienen rubro (#22)
    deps.systemDb.prepare('UPDATE tenants SET business_type = ? WHERE id = ? AND business_type IS NULL').run(tenant.preset, tenant.id);
  }
  ensureDemos(deps);
  return devInfo();
}

function ensureUsers(deps: Deps): UserIds {
  const ids: Partial<UserIds> = {};
  for (const [key, u] of Object.entries(DEV_USERS) as [DevUserKey, { email: string; name: string }][]) {
    if (key === 'root') {
      ids[key] = deps.authService.ensureRoot({ email: u.email, password: DEV_PASSWORD, name: u.name }).user.id;
      continue;
    }
    const existing = deps.authService.findUserByEmail(u.email);
    const id = existing?.id ?? deps.authService.createUser({ email: u.email, password: DEV_PASSWORD, name: u.name }).user.id;
    // Las cuentas nacen como user: el soporte se marca acá, como lo haría root a mano
    if (key === 'support') deps.systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(id);
    ids[key] = id;
  }
  const { root, support, ownerA, ownerB, adminK, memberK } = ids;
  if (root === undefined || support === undefined || ownerA === undefined || ownerB === undefined || adminK === undefined || memberK === undefined) {
    throw new Error('Faltan usuarios de desarrollo');
  }
  return { root, support, ownerA, ownerB, adminK, memberK };
}

function seedTenant(deps: Deps, t: DevTenant, ids: UserIds): void {
  const now = new Date();
  deps.tenantManager.createTenant({ id: t.id, slug: t.id, name: t.name, ownerUserId: ids[t.owner], businessType: t.preset });
  const db = deps.tenantManager.getTenantDb(t.id);
  // El catálogo del rubro y los clientes, como una demo
  seedDemoSession(db, t.preset);

  const addMember = deps.systemDb.prepare(
    "INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, status, created_at) VALUES (?, ?, ?, 'active', ?)",
  );
  for (const s of t.staff) addMember.run(ids[s.user], t.id, s.role, now.toISOString());

  const branchId = (db.prepare('SELECT id FROM branches ORDER BY created_at LIMIT 1').get() as { id: string }).id;
  t.registers.forEach((r, index) => {
    insertRegisterWithKey(deps.systemDb, t.id, r, now.toISOString());
    // Las ventas quedan de su caja, sin equipo ligado: el primer POS que se conecte con la key la liga
    generateHistoricalDemoActivity(db, branchId, now, {
      days: r.historyDays,
      idPrefix: index === 0 ? '' : `c${String(index + 1)}_`,
      origin: { deviceId: `pos_caja_${String(index + 1)}`, branch: DEV_BRANCH, pointOfSale: r.pointOfSale, registerId: r.id, chargeDevice: '' },
    });
  });

  seedCredits(deps, t, ids, now);
}

function insertRegisterWithKey(systemDb: DatabaseSync, tenantId: string, r: DevTenant['registers'][number], at: string): void {
  systemDb
    .prepare('INSERT OR IGNORE INTO registers (id, tenant_id, name, branch, point_of_sale, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
    .run(r.id, tenantId, r.name, DEV_BRANCH, r.pointOfSale, at);
  systemDb
    .prepare(
      `INSERT OR IGNORE INTO tenant_api_keys (id, tenant_id, name, key_hash, key_prefix, branch, point_of_sale, active, created_at, register_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(r.keyId, tenantId, r.name, hashApiKey(r.rawKey), r.rawKey.slice(0, 10), DEV_BRANCH, r.pointOfSale, at, r.id);
}

/**
 * El estado de créditos del comercio, armado con las mismas operaciones que usa la plataforma.
 * Precio de 1000 por caja y día, mitad de lo pagado y mitad de lo regalado (configuración por defecto).
 */
function seedCredits(deps: Deps, t: DevTenant, ids: UserIds, now: Date): void {
  const { billing } = deps;
  const today = argentinaToday(now);
  const db = deps.tenantManager.getTenantDb(t.id);
  const bonusId = billing.grantSignupBonus(t.id, ids[t.owner]);

  /** Un cargo por caja y día con ventas, entre `from` y `to` (inclusive). */
  const chargeSales = (from: string, to: string): void => {
    for (const r of t.registers) {
      const days = db
        .prepare('SELECT DISTINCT day FROM sales WHERE register_id = ? AND voids_sale_id IS NULL AND day BETWEEN ? AND ? ORDER BY day')
        .all(r.id, from, to)
        .map((row) => (row as { day: string }).day);
      billing.charge({ tenantId: t.id, registerId: r.id, chargeDevice: '', days });
    }
  };
  const all = { from: '0000-00-00', to: today };

  switch (t.credits) {
    case 'ok':
      // Pagó hace 25 días y tuvo una promo (vence antes que el bono, se usa primero): le sobra regalado
      billing.registerPayment({ tenantId: t.id, day: shiftDay(today, -25), amount: 22000, info: 'Transferencia', actorUserId: ids.root });
      billing.grantCredits({ tenantId: t.id, amount: 10000, expiresOn: shiftDay(today, 60), reason: 'Promo de lanzamiento', actorUserId: ids.root });
      chargeSales(all.from, all.to);
      break;
    case 'low':
      // Usa lo que quedó del pago (compartido con el Kiosco), le anulan el bono y le queda un crédito chico
      chargeSales(all.from, all.to);
      billing.voidCredit({ tenantId: t.id, creditId: bonusId, reason: 'Bono duplicado', actorUserId: ids.root });
      billing.grantCredits({ tenantId: t.id, amount: 4000, expiresOn: shiftDay(today, 15), reason: 'Crédito de cortesía', actorUserId: ids.root });
      break;
    case 'debt': {
      // El bono venció hace 4 días y nunca pagó: lo de esos días es deuda, todavía en gracia
      const cut = shiftDay(today, -4);
      chargeSales(all.from, shiftDay(cut, -1));
      deps.systemDb.prepare('UPDATE gift_credits SET expires_at = ? WHERE id = ?').run(`${cut}T03:00:00.000Z`, bonusId);
      chargeSales(cut, today);
      break;
    }
  }
}

/**
 * Las cajas de demo con key fija (#24): si no hay una viva con esa key (un reinicio o la inactividad
 * la revocaron), se crea otra caja de visitante y se le pone la key. La revocada suelta el hash, que es único.
 */
function ensureDemos(deps: Deps): void {
  if (!deps.demoSessions.enabled()) return;
  for (const d of DEV_DEMOS) {
    const hash = hashApiKey(d.rawKey);
    const alive = deps.systemDb
      .prepare(
        `SELECT 1 FROM tenant_api_keys k JOIN demo_sessions s ON s.register_id = k.register_id
         WHERE k.key_hash = ? AND k.active = 1 AND s.revoked_at IS NULL`,
      )
      .get(hash);
    if (alive !== undefined) continue;
    deps.systemDb.prepare("UPDATE tenant_api_keys SET key_hash = key_hash || ':revocada:' || id WHERE key_hash = ?").run(hash);
    const session = deps.demoSessions.create(d.template);
    deps.systemDb
      .prepare('UPDATE tenant_api_keys SET key_hash = ?, key_prefix = ? WHERE register_id = (SELECT register_id FROM demo_sessions WHERE id = ?)')
      .run(hash, d.rawKey.slice(0, 10), session.sessionId);
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
