import { describe, it, expect } from 'vitest';
import { sql } from 'kysely';
import { tenantSchemaName } from '../src/server/db/pg/tenant-schema-name.ts';
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
    const manager = new TenantManager(pgDb());
    await manager.createTenant({ id: 'demo-a', slug: 'demo-a', name: 'Demo Almacen' });
    const db = manager.forTenant('demo-a');
    await seedDemoSession(db, 'almacen');
    const skus = (await db.selectFrom('products').select('sku').execute()).map((p) => p.sku);
    expect(skus.filter((sku) => sku === 'ALM-001')).toHaveLength(1);
    expect(skus.filter((sku) => sku.startsWith('KIO-'))).toHaveLength(0);
    // Cada producto, con su stock en la sucursal del comercio
    expect(await db.selectFrom('stock').select('product_id').where('branch_id', '=', 'branch-central').execute()).toHaveLength(skus.length);
    expect(await db.selectFrom('customers').select('id').execute()).toHaveLength(DEMO_CUSTOMERS.length);
    expect(await db.selectFrom('sales').select('id').execute()).toHaveLength(0);
  });
});

describe('TenantManager y demos (#9)', () => {
  it('crea un tenant sin dueño', async () => {
    const manager = new TenantManager(pgDb());
    await manager.createTenant({ id: 'demo-b', slug: 'demo-b', name: 'Demo' });
    expect(await manager.tenantExists('demo-b')).toBe(true);
    expect(await countWhere('memberships')).toBe(0);
  });

  it('deleteTenant borra el tenant con sus cajas, equipos, keys y membresías', async () => {
    const sys = pgDb().system;
    const manager = new TenantManager(pgDb());
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

  it('deleteTenant borra el esquema del comercio', async () => {
    const manager = new TenantManager(pgDb());
    await manager.createTenant({ id: 'demo-c', slug: 'demo-c', name: 'Demo' });
    const schemas = async () =>
      (await sql<{ n: string }>`SELECT count(*) AS n FROM pg_namespace WHERE nspname = ${tenantSchemaName('demo-c')}`.execute(pgDb().root)).rows[0]?.n;
    expect(Number(await schemas())).toBe(1);
    await manager.deleteTenant('demo-c');
    expect(Number(await schemas())).toBe(0);
  });

  it('las demos no aparecen en la lista de comercios, ni para root', async () => {
    const manager = new TenantManager(pgDb());
    const auth = new AuthService(pgDb().system);
    const { user } = await auth.createUser({ email: 'root@b.com', password: 'secreta1', name: 'Root' });
    await manager.createTenant({ id: 'tienda', slug: 'tienda', name: 'Tienda', ownerUserId: user.id });
    await manager.createTenant({ id: 'demo-d', slug: 'demo-d', name: 'Demo' });
    await pgDb().system.insertInto('demo_tenants').values({ tenant_id: 'demo-d', template: 'kiosco', last_full_reset_at: new Date().toISOString() }).execute();

    const ids = (await auth.listUserTenants(user.id)).map((t) => t.tenantId);
    expect(ids).toEqual(['tienda']);
  });
});
