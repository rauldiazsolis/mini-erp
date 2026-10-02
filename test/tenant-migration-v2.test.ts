import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { migrateDb, readVersion } from '../src/server/db/migrations/migrate.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { createDbAtVersion } from './helpers/db-at-version.ts';

/** Solo hasta la v2: cada test de migración prueba la suya. */
const HASTA_V2 = { ...TENANT_SCHEMA, migrations: TENANT_SCHEMA.migrations.filter((m) => m.version <= 2) };

const TABLAS = [
  'branches', 'products', 'stock', 'customers', 'account_holds', 'account_movements', 'sales',
  'stock_movements', 'cash_movements', 'customer_payments', 'push_lots', 'idempotency_keys', 'tenant_settings',
];

function sembrarV1(db: DatabaseSync): void {
  const at = '2026-10-01T12:00:00.000Z';
  db.prepare('INSERT INTO branches (id, name, code, created_at) VALUES (?, ?, ?, ?)').run('b1', 'Central', 'CENTRAL', at);
  db.prepare('INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'SKU1', 'Yerba', at, at);
  db.prepare('INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'b1', 7, at);
  db.prepare('INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('c1', 'Ana', at, at);
  db.prepare('INSERT INTO account_holds (id, customer_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)').run('h1', 'c1', 100, 'pending', at);
  db.prepare('INSERT INTO account_movements (id, customer_id, type, amount, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('m1', 'c1', 'sale', 100, 100, at);
  db.prepare('INSERT INTO sales (id, payload, total, created_at) VALUES (?, ?, ?, ?)').run('s1', '{}', 100, at);
  db.prepare('INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('sm1', 'p1', 'b1', -1, 'sale', 'nota', at);
  db.prepare('INSERT INTO cash_movements (id, payload, created_at) VALUES (?, ?, ?)').run('cm1', '{}', at);
  db.prepare('INSERT INTO customer_payments (id, customer_id, payload, created_at) VALUES (?, ?, ?, ?)').run('cp1', 'c1', '{}', at);
  db.prepare('INSERT INTO push_lots (id, device_id, status, events, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('l1', 'd1', 'ok', '[]', at, at);
  db.prepare('INSERT INTO idempotency_keys (key, status, body, created_at) VALUES (?, ?, ?, ?)').run('k1', 200, '{}', at);
  db.prepare('INSERT INTO tenant_settings (key, value) VALUES (?, ?)').run('ticket', '1');
}

const contar = (db: DatabaseSync): Record<string, number> =>
  Object.fromEntries(TABLAS.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));

describe('comercio v2 indices (#47)', () => {
  it('una base v1 con datos pasa a v2 sin perder nada', () => {
    const db = createDbAtVersion(TENANT_SCHEMA, 1);
    sembrarV1(db);
    const antes = contar(db);
    expect(Object.values(antes).every((n) => n === 1)).toBe(true);

    expect(migrateDb(db, HASTA_V2)).toEqual({ from: 1, to: 2, applied: ['v2 indices'] });
    expect(readVersion(db)).toBe(2);
    expect(contar(db)).toEqual(antes);
    expect(db.prepare('SELECT notes FROM stock_movements').get()).toEqual({ notes: 'nota' });
  });

  it('crea los índices y las consultas los usan', () => {
    const db = createDbAtVersion(TENANT_SCHEMA, 1);
    migrateDb(db, HASTA_V2);
    const indices = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(indices).toEqual([
      'idx_account_holds_customer',
      'idx_account_movements_customer',
      'idx_sales_created_at',
      'idx_sales_voids_sale_id',
      'idx_stock_movements_created_at',
      'idx_stock_movements_product',
    ]);
    const plan = (db.prepare('EXPLAIN QUERY PLAN SELECT * FROM account_movements WHERE customer_id = ?').all('c1') as { detail: string }[])
      .map((r) => r.detail).join(' ');
    expect(plan).toContain('idx_account_movements_customer');
  });
});
