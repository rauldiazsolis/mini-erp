import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb, TENANT_SCHEMA_VERSION } from '../src/server/db/tenant-db.ts';

describe('Database Engine (DB-per-tenant)', () => {
  let tenantDb: DatabaseSync;

  beforeEach(() => {
    tenantDb = new DatabaseSync(':memory:');
    initTenantDb(tenantDb);
  });

  describe('Tenant DB', () => {
    it('inicializa correctamente las tablas requeridas por Connector API 4.2.0 y el ERP', () => {
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
