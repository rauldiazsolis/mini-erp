import { describe, it, expect } from 'vitest';
import { migrateDb, readVersion } from '../src/server/db/migrations/migrate.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { createDbAtVersion } from './helpers/db-at-version.ts';

const at = '2026-10-02T12:00:00.000Z';

describe('comercio v5: ventas y caja (#20)', () => {
  it('una base v4 con datos pasa a v5 con columnas derivadas, cobranzas del admin normalizadas e índices', () => {
    const db = createDbAtVersion(TENANT_SCHEMA, 4);
    db.prepare('INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('c1', 'Ana', at, at);
    const venta = db.prepare(
      'INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    // Numerada antes de la medianoche, con createdAt del día siguiente: manda ticket.date
    venta.run('v1', JSON.stringify({ id: 'v1', total: 100, customerId: 'c1', createdAt: '2026-10-02T03:10:00.000Z', ticket: { date: '2026-10-01', number: 7 }, payments: [{ method: 'cash', amount: 100 }], lines: [] }), 'dev', 'CENTRAL', 'Caja 1', 100, null, at);
    // Sin ticket: el createdAt del payload, a las 23:30 argentinas
    venta.run('v2', JSON.stringify({ id: 'v2', total: -100, voidsSaleId: 'v1', createdAt: '2026-10-03T02:30:00.000Z', payments: [], lines: [] }), 'dev', 'CENTRAL', 'Caja 1', -100, 'v1', at);
    // Sin createdAt en el payload: el de la fila
    venta.run('v3', JSON.stringify({ id: 'v3', total: 50, payments: [], lines: [] }), 'dev', 'CENTRAL', null, 50, null, '2026-10-02T01:00:00.000Z');
    // Payload roto: el de la fila, sin tumbar la migración
    venta.run('v4', 'no es json', 'dev', 'CENTRAL', 'Caja 1', 10, null, at);

    const cobranza = db.prepare(
      'INSERT INTO customer_payments (id, customer_id, payload, device_id, branch, point_of_sale, voids_payment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const delPos = { id: 'p1', customerId: 'c1', payments: [{ method: 'cash', amount: 700 }], total: 700, createdAt: '2026-10-02T03:30:00.000Z', receipt: { date: '2026-10-01', number: 3 } };
    cobranza.run('p1', 'c1', JSON.stringify(delPos), 'dev', 'CENTRAL', 'Caja 1', null, at);
    // Las dos formas que escribía registerPayment
    cobranza.run('p2', 'c1', JSON.stringify({ id: 'p2', customerId: 'c1', total: 500, method: 'transfer', reference: 'op-1' }), 'admin_panel', 'ADMIN', 'Oficina', null, at);
    cobranza.run('p3', 'c1', JSON.stringify({ id: 'p3', customerId: 'c1', total: 300, method: 'cash', reference: null }), 'admin_panel', 'ADMIN', 'Oficina', null, at);

    const caja = db.prepare('INSERT INTO cash_movements (id, payload, device_id, branch, point_of_sale, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    caja.run('m1', JSON.stringify({ id: 'm1', direction: 'in', amount: 2000, concept: 'Fondo', source: 'manual', createdAt: '2026-10-02T02:00:00.000Z' }), 'dev', 'CENTRAL', 'Caja 1', at);
    caja.run('m2', JSON.stringify({ id: 'm2', type: 'float-in', amount: 15000, timestamp: at }), 'dev', 'CENTRAL', 'Caja 1', at);

    expect(migrateDb(db, TENANT_SCHEMA)).toEqual({ from: 4, to: 6, applied: ['v5 ventas-y-caja', 'v6 caja-de-venta'] });
    expect(readVersion(db)).toBe(6);

    expect(db.prepare('SELECT id, day, customer_id, ticket_date, ticket_number FROM sales ORDER BY id').all()).toEqual([
      { id: 'v1', day: '2026-10-01', customer_id: 'c1', ticket_date: '2026-10-01', ticket_number: 7 },
      { id: 'v2', day: '2026-10-02', customer_id: null, ticket_date: null, ticket_number: null },
      { id: 'v3', day: '2026-10-01', customer_id: null, ticket_date: null, ticket_number: null },
      { id: 'v4', day: '2026-10-02', customer_id: null, ticket_date: null, ticket_number: null },
    ]);

    const pagos = db.prepare('SELECT id, payload, day, receipt_date, receipt_number FROM customer_payments ORDER BY id').all() as {
      id: string; payload: string; day: string; receipt_date: string | null; receipt_number: number | null;
    }[];
    expect(pagos.map(({ id, day, receipt_date, receipt_number }) => ({ id, day, receipt_date, receipt_number }))).toEqual([
      { id: 'p1', day: '2026-10-01', receipt_date: '2026-10-01', receipt_number: 3 },
      { id: 'p2', day: '2026-10-02', receipt_date: null, receipt_number: null },
      { id: 'p3', day: '2026-10-02', receipt_date: null, receipt_number: null },
    ]);
    expect(JSON.parse(pagos[0]?.payload ?? '')).toEqual(delPos);
    expect(JSON.parse(pagos[1]?.payload ?? '')).toEqual({
      id: 'p2', customerId: 'c1', payments: [{ method: 'transfer', amount: 500, reference: 'op-1' }], total: 500, createdAt: at,
    });
    expect(JSON.parse(pagos[2]?.payload ?? '')).toEqual({
      id: 'p3', customerId: 'c1', payments: [{ method: 'cash', amount: 300 }], total: 300, createdAt: at,
    });

    expect(db.prepare('SELECT id, day FROM cash_movements ORDER BY id').all()).toEqual([
      { id: 'm1', day: '2026-10-01' },
      { id: 'm2', day: '2026-10-02' },
    ]);

    const indices = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_sales_day', 'idx_sales_customer', 'idx_customer_payments_day', 'idx_cash_movements_day') ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(indices).toEqual(['idx_cash_movements_day', 'idx_customer_payments_day', 'idx_sales_customer', 'idx_sales_day']);
  });
});
