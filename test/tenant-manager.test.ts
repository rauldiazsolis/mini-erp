import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSystemDb } from '../src/db/system-db.js';
import { TenantManager } from '../src/db/tenant-manager.js';

describe('TenantManager', () => {
  let systemDb: DatabaseSync;
  let manager: TenantManager;

  beforeEach(() => {
    systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);
    // Manager configurado en memoria para tests
    manager = new TenantManager(systemDb, { inMemory: true });
  });

  afterEach(() => {
    manager.closeAll();
  });

  it('crea un nuevo tenant con sucursal por defecto y datos seed iniciales', () => {
    systemDb
      .prepare('INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('user-1', 'owner@example.com', 'hash', 'Owner', 'user', new Date().toISOString());

    const tenant = manager.createTenant({
      id: 'tenant-kiosco',
      slug: 'kiosco-central',
      name: 'Kiosco Central',
      ownerUserId: 'user-1',
      seedDemoData: true,
    });

    expect(tenant.id).toBe('tenant-kiosco');
    expect(tenant.status).toBe('active');

    // Verificar en systemDb
    const membership = systemDb
      .prepare('SELECT role FROM memberships WHERE user_id = ? AND tenant_id = ?')
      .get('user-1', 'tenant-kiosco') as { role: string };
    expect(membership.role).toBe('owner');

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

  it('permite consultar stock consolidado por producto', () => {
    systemDb
      .prepare('INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('user-stock', 'stock@example.com', 'hash', 'Stock Owner', 'user', new Date().toISOString());

    manager.createTenant({
      id: 'tenant-stock-test',
      slug: 'stock-test',
      name: 'Stock Test',
      ownerUserId: 'user-stock',
      seedDemoData: true,
    });

    const tenantDb = manager.getTenantDb('tenant-stock-test');
    const stockItems = manager.getConsolidatedStock(tenantDb);

    expect(stockItems.length).toBeGreaterThan(0);
    expect(typeof stockItems[0]?.productId).toBe('string');
    expect(typeof stockItems[0]?.quantity).toBe('number');
  });
});
