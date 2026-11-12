import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

async function insertUser(id: string, email: string, name: string): Promise<void> {
  await db().system.insertInto('users').values({ id, email, password_hash: 'hash', name, global_role: 'user', created_at: new Date().toISOString() }).execute();
}

describe('TenantManager', () => {
  let manager: TenantManager;

  beforeEach(() => {
    // Lo de sistema en PostgreSQL; la base de cada comercio, en memoria
    manager = new TenantManager(db().system, { inMemory: true });
  });

  afterEach(() => {
    manager.closeAll();
  });

  it('crea un nuevo tenant con sucursal por defecto y datos seed iniciales', async () => {
    await insertUser('user-1', 'owner@example.com', 'Owner');

    const tenant = await manager.createTenant({
      id: 'tenant-kiosco',
      slug: 'kiosco-central',
      name: 'Kiosco Central',
      ownerUserId: 'user-1',
      seedDemoData: true,
    });

    expect(tenant.id).toBe('tenant-kiosco');
    expect(tenant.status).toBe('active');

    // Verificar en el sistema (PostgreSQL)
    const membership = await db()
      .system.selectFrom('memberships')
      .select(['role', 'status'])
      .where('user_id', '=', 'user-1')
      .where('tenant_id', '=', 'tenant-kiosco')
      .executeTakeFirst();
    expect(membership).toEqual({ role: 'owner', status: 'active' });

    // Verificar en tenantDb
    const tenantDb = manager.getTenantDb('tenant-kiosco');
    const branches = tenantDb.prepare('SELECT * FROM branches').all() as { code: string; name: string }[];
    expect(branches.length).toBe(1);
    expect(branches[0]?.code).toBe('CENTRAL');

    const products = tenantDb.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
    expect(products.count).toBeGreaterThan(0);

    const customers = tenantDb.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number };
    expect(customers.count).toBeGreaterThan(0);
  });

  it('el owner que crea el comercio es su titular; sin owner (una demo), no hay titular (#21)', async () => {
    await insertUser('user-9', 'titular@example.com', 'Titular');
    await manager.createTenant({ id: 'con-titular', slug: 'con-titular', name: 'Con titular', ownerUserId: 'user-9' });
    await manager.createTenant({ id: 'sin-titular', slug: 'sin-titular', name: 'Sin titular' });
    const rows = await db().system.selectFrom('tenants').select(['id', 'holder_user_id']).orderBy('id').execute();
    expect(rows).toEqual([
      { id: 'con-titular', holder_user_id: 'user-9' },
      { id: 'sin-titular', holder_user_id: null },
    ]);
  });

  it('permite consultar stock consolidado por producto', async () => {
    await insertUser('user-stock', 'stock@example.com', 'Stock Owner');

    await manager.createTenant({
      id: 'tenant-stock-test',
      slug: 'stock-test',
      name: 'Stock Test',
      ownerUserId: 'user-stock',
      seedDemoData: true,
    });

    const tenantDb = manager.getTenantDb('tenant-stock-test');
    const stockItems = await manager.getConsolidatedStock(tenantDb);

    expect(stockItems.length).toBeGreaterThan(0);
    expect(typeof stockItems[0]?.productId).toBe('string');
    expect(typeof stockItems[0]?.quantity).toBe('number');
  });

  it('desambigua silenciosamente el slug agregando -2, -3 sólo si ya existe uno anterior', async () => {
    await insertUser('user-dup', 'dup@example.com', 'Dup Owner');

    // Primer tenant con slug "mi-tienda"
    const t1 = await manager.createTenant({
      id: 'mi-tienda',
      slug: 'mi-tienda',
      name: 'Mi Tienda',
      ownerUserId: 'user-dup',
      seedDemoData: false,
    });
    expect(t1.slug).toBe('mi-tienda');
    expect(t1.id).toBe('mi-tienda');

    // Segundo tenant con mismo slug "mi-tienda" -> debe resolver a "mi-tienda-2"
    const t2 = await manager.createTenant({
      id: 'mi-tienda',
      slug: 'mi-tienda',
      name: 'Mi Tienda',
      ownerUserId: 'user-dup',
      seedDemoData: false,
    });
    expect(t2.slug).toBe('mi-tienda-2');
    expect(t2.id).toBe('mi-tienda-2');

    // Tercer tenant con mismo slug "mi-tienda" -> debe resolver a "mi-tienda-3"
    const t3 = await manager.createTenant({
      id: 'mi-tienda',
      slug: 'mi-tienda',
      name: 'Mi Tienda',
      ownerUserId: 'user-dup',
      seedDemoData: false,
    });
    expect(t3.slug).toBe('mi-tienda-3');
    expect(t3.id).toBe('mi-tienda-3');
  });

  it('lee el nombre y el rubro del comercio; null si no existe o no tiene rubro', async () => {
    await manager.createTenant({ id: 'con-rubro', slug: 'con-rubro', name: 'Con rubro', businessType: 'almacen' });
    await manager.createTenant({ id: 'sin-rubro', slug: 'sin-rubro', name: 'Sin rubro' });
    expect(await manager.getTenantName('con-rubro')).toBe('Con rubro');
    expect(await manager.getTenantName('no-existe')).toBeNull();
    expect(await manager.getBusinessType('con-rubro')).toBe('almacen');
    expect(await manager.getBusinessType('sin-rubro')).toBeNull();
    expect(await manager.getBusinessType('no-existe')).toBeNull();
  });

  it('tenantExists busca por id y por slug', async () => {
    await manager.createTenant({ id: 'id-1', slug: 'slug-1', name: 'Uno' });
    expect(await manager.tenantExists('id-1')).toBe(true);
    expect(await manager.tenantExists('slug-1')).toBe(true);
    expect(await manager.tenantExists('otro')).toBe(false);
  });

  it('si la membresía falla, el comercio no queda a medias en sistema', async () => {
    // El owner no existe: la FK de memberships lo rechaza y la fila de tenants se deshace con ella
    await expect(manager.createTenant({ id: 'huerfano', slug: 'huerfano', name: 'Huérfano', ownerUserId: 'nadie' })).rejects.toThrow();
    expect(await manager.tenantExists('huerfano')).toBe(false);
  });
});
