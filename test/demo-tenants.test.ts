import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';
import {
  DEMO_CUSTOMERS,
  DEMO_TEMPLATES,
  isDemoTemplate,
  seedDemoSession,
} from '../src/server/seeds/index.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

function systemDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  initSystemDb(db);
  return db;
}

function count(db: DatabaseSync, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

async function insertUser(id: string): Promise<void> {
  await pgDb()
    .system.insertInto('users')
    .values({ id, email: `${id}@b.com`, password_hash: 'hash', name: id, global_role: 'user', created_at: new Date().toISOString() })
    .execute();
}

async function countWhere(table: 'memberships' | 'registers' | 'register_devices' | 'tenant_api_keys' | 'tenants'): Promise<number> {
  const row = await pgDb().system.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
  return row.n;
}

describe('Templates de demo (#9)', () => {
  it('son los presets', () => {
    expect([...DEMO_TEMPLATES]).toEqual(['kiosco', 'almacen', 'ferreteria']);
    expect(isDemoTemplate('almacen')).toBe(true);
    expect(isDemoTemplate('panaderia')).toBe(false);
  });

  it('seedDemoSession siembra el catálogo del preset y los clientes demo, sin historial', async () => {
    const manager = new TenantManager(pgDb().system, { inMemory: true });
    await manager.createTenant({ id: 'demo-a', slug: 'demo-a', name: 'Demo Almacen' });
    const db = manager.getTenantDb('demo-a');
    await seedDemoSession(db, 'almacen');
    expect(count(db, 'SELECT COUNT(*) AS n FROM products WHERE sku = ?', 'ALM-001')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS n FROM products WHERE sku LIKE ?', 'KIO-%')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM customers')).toBe(DEMO_CUSTOMERS.length);
    expect(count(db, 'SELECT COUNT(*) AS n FROM sales')).toBe(0);
  });
});

describe('TenantManager y demos (#9)', () => {
  it('crea un tenant sin dueño', async () => {
    const manager = new TenantManager(pgDb().system, { inMemory: true });
    await manager.createTenant({ id: 'demo-b', slug: 'demo-b', name: 'Demo' });
    expect(await manager.tenantExists('demo-b')).toBe(true);
    expect(await countWhere('memberships')).toBe(0);
  });

  it('deleteTenant borra el tenant con sus cajas, equipos, keys y membresías', async () => {
    const sys = pgDb().system;
    const manager = new TenantManager(sys, { inMemory: true });
    await insertUser('ana');
    await manager.createTenant({ id: 'tienda', slug: 'tienda', name: 'Tienda', ownerUserId: 'ana' });
    const now = new Date().toISOString();
    await sys
      .insertInto('registers')
      .values({ id: 'reg-1', tenant_id: 'tienda', name: 'Caja 1', branch: 'CENTRAL', point_of_sale: 'Caja 1', created_at: now })
      .execute();
    await sys.insertInto('register_devices').values({ register_id: 'reg-1', device_id: 'equipo-1', first_seen_at: now, last_seen_at: now }).execute();
    await sys
      .insertInto('tenant_api_keys')
      .values({ id: 'key-1', tenant_id: 'tienda', name: 'Caja 1', key_hash: 'h', key_prefix: 'p', branch: 'CENTRAL', point_of_sale: 'Caja 1', created_at: now, register_id: 'reg-1' })
      .execute();

    await manager.deleteTenant('tienda');

    expect(await manager.tenantExists('tienda')).toBe(false);
    expect([await countWhere('tenants'), await countWhere('memberships'), await countWhere('registers'), await countWhere('register_devices'), await countWhere('tenant_api_keys')]).toEqual([0, 0, 0, 0, 0]);
  });

  it('deleteTenant borra el archivo de la base', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-erp-demo-'));
    try {
      const manager = new TenantManager(pgDb().system, { baseDir: dir });
      await manager.createTenant({ id: 'demo-c', slug: 'demo-c', name: 'Demo' });
      const file = join(dir, 'demo-c.sqlite');
      expect(existsSync(file)).toBe(true);
      await manager.deleteTenant('demo-c');
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('las demos no aparecen en la lista de comercios, ni para root', async () => {
    const sys = systemDb();
    const manager = new TenantManager(pgDb().system, { inMemory: true });
    const auth = new AuthService(pgDb().system);
    const { user } = await auth.createUser({ email: 'root@b.com', password: 'secreta1', name: 'Root' });
    await manager.createTenant({ id: 'tienda', slug: 'tienda', name: 'Tienda', ownerUserId: user.id });
    await manager.createTenant({ id: 'demo-d', slug: 'demo-d', name: 'Demo' });
    sys.prepare("INSERT INTO demo_tenants (tenant_id, template, last_full_reset_at) VALUES ('demo-d', 'kiosco', 'x')").run();

    const ids = (await auth.listUserTenants(user.id)).map((t) => t.tenantId);
    expect(ids).toEqual(['tienda']);
  });
});
