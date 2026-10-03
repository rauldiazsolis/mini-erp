import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { bootstrap } from '../src/server/bootstrap.ts';
import {
  DEV_ADMIN_EMAIL,
  DEV_ADMIN2_EMAIL,
  DEV_MEMBER_EMAIL,
  DEV_POS_API_KEY,
  DEV_TENANT_ID,
} from '../src/server/db/dev-seed.ts';
import { hashApiKey } from '../src/server/auth/crypto.ts';

function boot(env: NodeJS.ProcessEnv) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const bundle = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }) });
  const result = bootstrap({ env, bundle });
  clearInterval(result.sweeper);
  clearInterval(result.billingSweeper);
  const count = (sql: string, param: string): number => (systemDb.prepare(sql).get(param) as { n: number }).n;
  return {
    result,
    users: count('SELECT COUNT(*) AS n FROM users WHERE email = ?', DEV_ADMIN_EMAIL),
    tenants: count('SELECT COUNT(*) AS n FROM tenants WHERE id = ?', DEV_TENANT_ID),
    keys: count('SELECT COUNT(*) AS n FROM tenant_api_keys WHERE key_hash = ?', hashApiKey(DEV_POS_API_KEY)),
    roleUsers: (
      systemDb
        .prepare('SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? AND u.email IN (?, ?) ORDER BY u.email')
        .all(DEV_TENANT_ID, DEV_ADMIN2_EMAIL, DEV_MEMBER_EMAIL) as { email: string; role: string }[]
    ).map((r) => ({ ...r })),
    systemDb,
    bundle,
  };
}

describe('bootstrap (#3)', () => {
  it('en producción no siembra el admin, el tenant ni la key de desarrollo', () => {
    const { result, users, tenants, keys } = boot({ NODE_ENV: 'production' });
    expect(result.devInfo).toBeUndefined();
    expect([users, tenants, keys]).toEqual([0, 0, 0]);
  });

  it('en producción tampoco crea los usuarios de prueba de roles (#19)', () => {
    const { systemDb } = boot({ NODE_ENV: 'production' });
    expect((systemDb.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(0);
  });

  it('fuera de producción siembra los datos de desarrollo', () => {
    const { result, users, tenants, keys } = boot({});
    expect(result.devInfo).toEqual({ email: DEV_ADMIN_EMAIL, rawKey: DEV_POS_API_KEY });
    expect([users, tenants, keys]).toEqual([1, 1, 1]);
  });

  it('fuera de producción, tienda-demo tiene titular y bono de alta (#21)', () => {
    const { systemDb } = boot({});
    expect(systemDb.prepare("SELECT origin, amount FROM gift_credits WHERE tenant_id = ?").all(DEV_TENANT_ID)).toEqual([
      { origin: 'signup', amount: 50000 },
    ]);
    expect(systemDb.prepare('SELECT holder_user_id IS NOT NULL AS ok FROM tenants WHERE id = ?').get(DEV_TENANT_ID)).toEqual({ ok: 1 });
  });

  it('fuera de producción suma un admin y un empleado en tienda-demo, y no se duplican (#19)', () => {
    const { roleUsers, bundle } = boot({});
    expect(roleUsers).toEqual([
      { email: DEV_ADMIN2_EMAIL, role: 'admin' },
      { email: DEV_MEMBER_EMAIL, role: 'member' },
    ]);
    const again = bootstrap({ env: {}, bundle });
    clearInterval(again.sweeper);
    clearInterval(again.billingSweeper);
    expect(() => bundle.authService.login({ email: DEV_MEMBER_EMAIL, password: 'admin123' })).not.toThrow();
  });
});
