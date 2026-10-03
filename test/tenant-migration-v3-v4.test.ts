import { describe, it, expect } from 'vitest';
import { migrateDb, readVersion } from '../src/server/db/migrations/migrate.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { createDbAtVersion } from './helpers/db-at-version.ts';

const at = '2026-10-02T12:00:00.000Z';

describe('comercio v3 y v4 (#2)', () => {
  it('una base v2 con cobranzas pasa a v4: voids_payment_id rellenado y tabla de discrepancias', () => {
    const db = createDbAtVersion(TENANT_SCHEMA, 2);
    db.prepare('INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('c1', 'Ana', at, at);
    db.prepare('INSERT INTO customer_payments (id, customer_id, payload, created_at) VALUES (?, ?, ?, ?)')
      .run('p1', 'c1', JSON.stringify({ id: 'p1', customerId: 'c1', total: 500 }), at);
    db.prepare('INSERT INTO customer_payments (id, customer_id, payload, created_at) VALUES (?, ?, ?, ?)')
      .run('p2', 'c1', JSON.stringify({ id: 'p2', customerId: 'c1', total: -500, voidsPaymentId: 'p1' }), at);

    expect(migrateDb(db, TENANT_SCHEMA)).toEqual({
      from: 2, to: 6, applied: ['v3 anulacion-cobranzas', 'v4 discrepancias', 'v5 ventas-y-caja', 'v6 caja-de-venta'],
    });
    expect(readVersion(db)).toBe(6);
    expect(db.prepare('SELECT id, voids_payment_id FROM customer_payments ORDER BY id').all()).toEqual([
      { id: 'p1', voids_payment_id: null },
      { id: 'p2', voids_payment_id: 'p1' },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 1 });
    // Sin clave foránea a customers: se puede guardar la cobranza de un cliente que todavía no existe
    expect(db.prepare('PRAGMA foreign_key_list(customer_payments)').all()).toEqual([]);
    db.prepare('INSERT INTO customer_payments (id, customer_id, payload, created_at) VALUES (?, ?, ?, ?)').run('p3', 'nadie', '{}', at);

    const indices = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_customer_payments_voids', 'idx_customer_payments_customer', 'idx_discrepancies_open', 'idx_discrepancies_customer') ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(indices).toEqual(['idx_customer_payments_customer', 'idx_customer_payments_voids', 'idx_discrepancies_customer', 'idx_discrepancies_open']);
    const columnas = (db.prepare('PRAGMA table_info(discrepancies)').all() as { name: string }[]).map((r) => r.name);
    expect(columnas).toEqual([
      'id', 'kind', 'device_id', 'origin_branch', 'origin_pos', 'customer_id', 'ref_type', 'ref_id', 'amount',
      'pending', 'created_at', 'resolved_at', 'resolution', 'resolved_by', 'note',
    ]);
  });
});
