import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSystemDb, SYSTEM_SCHEMA_VERSION } from '../src/server/db/system-db.ts';
import { initTenantDb, TENANT_SCHEMA_VERSION } from '../src/server/db/tenant-db.ts';

describe('Database Engine (DB-per-tenant)', () => {
  let systemDb: DatabaseSync;
  let tenantDb: DatabaseSync;

  beforeEach(() => {
    systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);

    tenantDb = new DatabaseSync(':memory:');
    initTenantDb(tenantDb);
  });

  describe('System DB', () => {
    it('inicializa correctamente las tablas del sistema con la versión de schema esperada', () => {
      const versionRow = systemDb.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(versionRow.user_version).toBe(SYSTEM_SCHEMA_VERSION);

      const tables = systemDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);

      expect(names).toContain('users');
      expect(names).toContain('tenants');
      expect(names).toContain('memberships');
      expect(names).toContain('tenant_api_keys');
    });

    it('permite insertar y consultar usuarios con roles', () => {
      systemDb
        .prepare(
          'INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('user-1', 'root@example.com', 'hash123', 'Root User', 'root', new Date().toISOString());

      const user = systemDb.prepare('SELECT * FROM users WHERE id = ?').get('user-1') as {
        email: string;
        global_role: string;
      };

      expect(user.email).toBe('root@example.com');
      expect(user.global_role).toBe('root');
    });
  });

  describe('Tenant DB', () => {
    it('inicializa correctamente las tablas requeridas por Connector API 4.0.0 y el ERP', () => {
      const versionRow = tenantDb.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(versionRow.user_version).toBe(TENANT_SCHEMA_VERSION);

      const tables = tenantDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);

      expect(names).toContain('branches');
      expect(names).toContain('products');
      expect(names).toContain('stock');
      expect(names).toContain('customers');
      expect(names).toContain('account_holds');
      expect(names).toContain('account_movements');
      expect(names).toContain('sales');
      expect(names).toContain('stock_movements');
      expect(names).toContain('cash_movements');
      expect(names).toContain('customer_payments');
      expect(names).toContain('push_lots');
      expect(names).toContain('idempotency_keys');
      expect(names).toContain('tenant_settings');
    });

    it('registra stock por sucursal y permite consulta atómica', () => {
      const now = new Date().toISOString();
      tenantDb
        .prepare('INSERT INTO branches (id, name, code, created_at) VALUES (?, ?, ?, ?)')
        .run('b-1', 'Sucursal Central', 'CENTRAL', now);

      tenantDb
        .prepare(
          'INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('p-1', 'COCA-500', '["779123456789"]', 'Coca Cola 500ml', 1500, 0.21, 'Bebidas', 1, now, now);

      tenantDb
        .prepare('INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, ?, ?)')
        .run('p-1', 'b-1', 48.5, now);

      const stockRow = tenantDb
        .prepare('SELECT quantity FROM stock WHERE product_id = ? AND branch_id = ?')
        .get('p-1', 'b-1') as { quantity: number };

      expect(stockRow.quantity).toBe(48.5);
    });
  });
});
