import type { DatabaseSync } from 'node:sqlite';
import type { AuthService } from '../auth/auth-service.ts';
import type { TenantManager } from './tenant-manager.ts';
import { hashApiKey } from '../auth/crypto.ts';
import type { BillingService } from '../billing/billing-service.ts';

export const DEV_POS_API_KEY = 'mpos_dev_demo_key_12345';
export const DEV_ADMIN_EMAIL = 'admin@local.test';
export const DEV_ADMIN_PASS = 'admin123';
export const DEV_TENANT_ID = 'tienda-demo';
export const DEV_BRANCH = 'CENTRAL';
export const DEV_POS = 'Caja 1';
/** Usuarios para probar los roles a mano (#19), con la misma contraseña de desarrollo. */
export const DEV_ADMIN2_EMAIL = 'admin2@local.test';
export const DEV_MEMBER_EMAIL = 'empleado@local.test';

export function ensureDevData(params: {
  systemDb: DatabaseSync;
  authService: AuthService;
  tenantManager: TenantManager;
  billing: BillingService;
}): { email: string; rawKey: string } {
  const userRow = params.systemDb
    .prepare('SELECT id, email FROM users WHERE email = ?')
    .get(DEV_ADMIN_EMAIL) as { id: string; email: string } | undefined;

  let ownerUserId: string;

  if (userRow === undefined) {
    // 1. Crear el admin de desarrollo como root (#3: el registro ya no da root)
    const { user } = params.authService.ensureRoot({
      email: DEV_ADMIN_EMAIL,
      password: DEV_ADMIN_PASS,
      name: 'Admin Demo',
    });
    ownerUserId = user.id;
  } else {
    ownerUserId = userRow.id;
  }

  // 2. Crear tenant con datos iniciales si no existe
  const tenantRow = params.systemDb
    .prepare('SELECT id FROM tenants WHERE id = ?')
    .get(DEV_TENANT_ID) as { id: string } | undefined;

  if (tenantRow === undefined) {
    params.tenantManager.createTenant({
      id: DEV_TENANT_ID,
      slug: DEV_TENANT_ID,
      name: 'Tienda Demo Central',
      ownerUserId,
      seedDemoData: true,
    });
    // Con el bono de alta, como un comercio nuevo (#21)
    params.billing.grantSignupBonus(DEV_TENANT_ID, ownerUserId);
  }

  // 3. Un admin y un empleado para probar los roles (#19)
  for (const [email, name, role] of [
    [DEV_ADMIN2_EMAIL, 'Admin Demo 2', 'admin'],
    [DEV_MEMBER_EMAIL, 'Empleado Demo', 'member'],
  ] as const) {
    const existing = params.authService.findUserByEmail(email);
    const userId = existing?.id ?? params.authService.createUser({ email, password: DEV_ADMIN_PASS, name }).user.id;
    params.systemDb
      .prepare("INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(userId, DEV_TENANT_ID, role, new Date().toISOString());
  }

  // 4. Asegurar API Key de desarrollo fija y conocida
  const keyHash = hashApiKey(DEV_POS_API_KEY);
  const keyRow = params.systemDb
    .prepare('SELECT id FROM tenant_api_keys WHERE key_hash = ?')
    .get(keyHash) as { id: string } | undefined;

  if (keyRow === undefined) {
    const now = new Date().toISOString();
    // La caja de la key (#21), con el mismo id que le da la migración de sistema v5
    const registerId = 'reg_key_dev_default';
    params.systemDb
      .prepare(
        `INSERT OR IGNORE INTO registers (id, tenant_id, name, branch, point_of_sale, active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(registerId, DEV_TENANT_ID, 'Caja Principal POS', DEV_BRANCH, DEV_POS, now);
    params.systemDb
      .prepare(
        `INSERT INTO tenant_api_keys (id, tenant_id, name, key_hash, key_prefix, branch, point_of_sale, active, created_at, register_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run('key_dev_default', DEV_TENANT_ID, 'Caja Principal POS', keyHash, 'mpos_dev_d', DEV_BRANCH, DEV_POS, now, registerId);
  }

  return {
    email: DEV_ADMIN_EMAIL,
    rawKey: DEV_POS_API_KEY,
  };
}
