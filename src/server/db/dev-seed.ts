import type { DatabaseSync } from 'node:sqlite';
import type { AuthService } from '../auth/auth-service.ts';
import type { TenantManager } from './tenant-manager.ts';
import { hashApiKey } from '../auth/crypto.ts';

export const DEV_POS_API_KEY = 'mpos_dev_demo_key_12345';
export const DEV_ADMIN_EMAIL = 'admin@local.test';
export const DEV_ADMIN_PASS = 'admin123';
export const DEV_TENANT_ID = 'tienda-demo';
export const DEV_BRANCH = 'CENTRAL';
export const DEV_POS = 'Caja 1';

export function ensureDevData(params: {
  systemDb: DatabaseSync;
  authService: AuthService;
  tenantManager: TenantManager;
}): { email: string; rawKey: string } {
  const userRow = params.systemDb
    .prepare('SELECT id, email FROM users WHERE email = ?')
    .get(DEV_ADMIN_EMAIL) as { id: string; email: string } | undefined;

  let ownerUserId: string;

  if (userRow === undefined) {
    // 1. Crear usuario Root
    const { user } = params.authService.register({
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
  }

  // 3. Asegurar API Key de desarrollo fija y conocida
  const keyHash = hashApiKey(DEV_POS_API_KEY);
  const keyRow = params.systemDb
    .prepare('SELECT id FROM tenant_api_keys WHERE key_hash = ?')
    .get(keyHash) as { id: string } | undefined;

  if (keyRow === undefined) {
    const now = new Date().toISOString();
    params.systemDb
      .prepare(
        `INSERT INTO tenant_api_keys (id, tenant_id, name, key_hash, key_prefix, branch, point_of_sale, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run('key_dev_default', DEV_TENANT_ID, 'Caja Principal POS', keyHash, 'mpos_dev_d', DEV_BRANCH, DEV_POS, now);
  }

  return {
    email: DEV_ADMIN_EMAIL,
    rawKey: DEV_POS_API_KEY,
  };
}
