import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { bootstrap } from '../src/server/bootstrap.ts';
import { DEV_ADMIN_EMAIL, DEV_POS_API_KEY, DEV_TENANT_ID } from '../src/server/db/dev-seed.ts';
import { hashApiKey } from '../src/server/auth/crypto.ts';

function boot(env: NodeJS.ProcessEnv) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const bundle = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }) });
  const result = bootstrap({ env, bundle });
  clearInterval(result.sweeper);
  const count = (sql: string, param: string): number => (systemDb.prepare(sql).get(param) as { n: number }).n;
  return {
    result,
    users: count('SELECT COUNT(*) AS n FROM users WHERE email = ?', DEV_ADMIN_EMAIL),
    tenants: count('SELECT COUNT(*) AS n FROM tenants WHERE id = ?', DEV_TENANT_ID),
    keys: count('SELECT COUNT(*) AS n FROM tenant_api_keys WHERE key_hash = ?', hashApiKey(DEV_POS_API_KEY)),
  };
}

describe('bootstrap (#3)', () => {
  it('en producción no siembra el admin, el tenant ni la key de desarrollo', () => {
    const { result, users, tenants, keys } = boot({ NODE_ENV: 'production' });
    expect(result.devInfo).toBeUndefined();
    expect([users, tenants, keys]).toEqual([0, 0, 0]);
  });

  it('fuera de producción siembra los datos de desarrollo', () => {
    const { result, users, tenants, keys } = boot({});
    expect(result.devInfo).toEqual({ email: DEV_ADMIN_EMAIL, rawKey: DEV_POS_API_KEY });
    expect([users, tenants, keys]).toEqual([1, 1, 1]);
  });
});
