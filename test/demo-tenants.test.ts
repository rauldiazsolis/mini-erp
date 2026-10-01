import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import {
  DEMO_CUSTOMERS,
  DEMO_TEMPLATES,
  isDemoTemplate,
  seedDemoSession,
} from '../src/server/seeds/index.ts';

function systemDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  initSystemDb(db);
  return db;
}

function count(db: DatabaseSync, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function markAsDemo(sys: DatabaseSync, tenantId: string): void {
  const now = new Date().toISOString();
  sys
    .prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)')
    .run(tenantId, 'kiosco', now, now);
}

describe('Templates de demo (#9)', () => {
  it('son los presets', () => {
    expect([...DEMO_TEMPLATES]).toEqual(['kiosco', 'almacen', 'ferreteria']);
    expect(isDemoTemplate('almacen')).toBe(true);
    expect(isDemoTemplate('panaderia')).toBe(false);
  });

  it('seedDemoSession siembra el catálogo del preset y los clientes demo, sin historial', () => {
    const manager = new TenantManager(systemDb(), { inMemory: true });
    manager.createTenant({ id: 'demo-a', slug: 'demo-a', name: 'Demo Almacen' });
    const db = manager.getTenantDb('demo-a');
    seedDemoSession(db, 'almacen');
    expect(count(db, 'SELECT COUNT(*) AS n FROM products WHERE sku = ?', 'ALM-001')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS n FROM products WHERE sku LIKE ?', 'KIO-%')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM customers')).toBe(DEMO_CUSTOMERS.length);
    expect(count(db, 'SELECT COUNT(*) AS n FROM sales')).toBe(0);
  });
});

describe('TenantManager y demos (#9)', () => {
  it('crea un tenant sin dueño', () => {
    const sys = systemDb();
    const manager = new TenantManager(sys, { inMemory: true });
    manager.createTenant({ id: 'demo-b', slug: 'demo-b', name: 'Demo' });
    expect(manager.tenantExists('demo-b')).toBe(true);
    expect(count(sys, 'SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ?', 'demo-b')).toBe(0);
  });

  it('deleteTenant borra el tenant, sus keys, membresías y su fila de demo', () => {
    const sys = systemDb();
    const manager = new TenantManager(sys, { inMemory: true });
    const auth = new AuthService(sys);
    const { user } = auth.createUser({ email: 'a@b.com', password: 'secreta1', name: 'A' });
    manager.createTenant({ id: 'tienda', slug: 'tienda', name: 'Tienda', ownerUserId: user.id });
    const keys = new ApiKeyService(sys);
    const { rawKey } = keys.createApiKey({
      tenantId: 'tienda',
      name: 'Caja',
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
    });
    markAsDemo(sys, 'tienda');

    manager.deleteTenant('tienda');

    expect(manager.tenantExists('tienda')).toBe(false);
    expect(keys.validateApiKey(rawKey)).toBeUndefined();
    expect(count(sys, 'SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ?', 'tienda')).toBe(0);
    expect(count(sys, 'SELECT COUNT(*) AS n FROM demo_sessions WHERE tenant_id = ?', 'tienda')).toBe(0);
  });

  it('deleteTenant borra el archivo de la base', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-erp-demo-'));
    try {
      const manager = new TenantManager(systemDb(), { baseDir: dir });
      manager.createTenant({ id: 'demo-c', slug: 'demo-c', name: 'Demo' });
      const file = join(dir, 'demo-c.sqlite');
      expect(existsSync(file)).toBe(true);
      manager.deleteTenant('demo-c');
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('las demos no aparecen en la lista de comercios, ni para root', () => {
    const sys = systemDb();
    const manager = new TenantManager(sys, { inMemory: true });
    const auth = new AuthService(sys);
    const { user } = auth.createUser({ email: 'root@b.com', password: 'secreta1', name: 'Root' });
    manager.createTenant({ id: 'tienda', slug: 'tienda', name: 'Tienda', ownerUserId: user.id });
    manager.createTenant({ id: 'demo-d', slug: 'demo-d', name: 'Demo' });
    markAsDemo(sys, 'demo-d');

    const ids = auth.listUserTenants(user.id, 'root').map((t) => t.tenantId);
    expect(ids).toEqual(['tienda']);
  });
});
