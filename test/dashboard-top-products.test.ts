import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { DashboardService } from '../src/server/dashboard/dashboard-service.ts';
import { lineTotal, saleLineSchema } from '../src/server/dashboard/sale-lines.ts';
import { generateHistoricalDemoActivity } from '../src/server/seeds/demo-activity-generator.ts';
import { argentinaToday } from '../src/shared/argentina-day.ts';

function insertProduct(db: DatabaseSync, id: string, name: string, price: number): void {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    `SKU-${id}`,
    name,
    price,
    now,
    now,
  );
}

function insertSale(db: DatabaseSync, id: string, payload: string, total: number): void {
  db.prepare(
    `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at, day)
     VALUES (?, ?, 'pos_1', 'CENTRAL', 'Caja 1', ?, NULL, ?, ?)`,
  ).run(id, payload, total, new Date().toISOString(), argentinaToday(new Date()));
}

describe('Total de línea como el POS (#15)', () => {
  it.each([
    [{ kind: 'product', productId: 'p', qty: 2, unitPrice: 1000 }, 2000],
    [{ kind: 'product', productId: 'p', qty: 2, unitPrice: 1000, discount: { type: 'percentage', value: 10 } }, 1800],
    [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 500, discount: { type: 'amount', value: 100 } }, 400],
    [{ kind: 'product', productId: 'p', qty: -1, unitPrice: 1000, discount: { type: 'percentage', value: 10 } }, -900],
    [{ kind: 'product', productId: 'p', qty: 1, unitPrice: 100, discount: { type: 'amount', value: 500 } }, 0],
    [{ kind: 'product', productId: 'p', qty: 0.333, unitPrice: 1000 }, 333],
  ])('%j → %d', (raw, expected) => {
    expect(lineTotal(saleLineSchema.parse(raw))).toBe(expected);
  });
});

describe('Ranking de más vendidos con ventas del POS (#15)', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    initTenantDb(db);
    insertProduct(db, 'p1', 'Alfajor Triple Dulce de Leche', 950);
    insertProduct(db, 'p2', 'Gaseosa 500 ml', 1000);
  });

  it('nombres del catálogo, importes con descuento, freeform agrupadas y productos borrados', () => {
    const createdAt = new Date().toISOString();
    insertSale(
      db,
      's1',
      JSON.stringify({
        id: 's1',
        status: 'closed',
        total: 3150,
        createdAt,
        payments: [{ method: 'cash', amount: 3150 }],
        lines: [
          { kind: 'product', productId: 'p1', qty: 1, unitPrice: 950 },
          { kind: 'product', productId: 'p2', qty: 2, unitPrice: 1000, discount: { type: 'percentage', value: 10 } },
          { kind: 'freeform', description: 'Varios ', qty: 1, unitPrice: 500, discount: { type: 'amount', value: 100 } },
          { name: 'línea inventada', lineTotal: 99999 },
        ],
      }),
      3150,
    );
    insertSale(
      db,
      's2',
      JSON.stringify({
        id: 's2',
        status: 'closed',
        total: 500,
        createdAt,
        payments: [{ method: 'cash', amount: 500 }],
        lines: [
          { kind: 'freeform', description: '  VARIOS', qty: 1, unitPrice: 300 },
          { kind: 'product', productId: 'p-borrado', qty: 1, unitPrice: 200 },
        ],
      }),
      500,
    );
    insertSale(
      db,
      's3',
      JSON.stringify({
        id: 's3',
        status: 'closed',
        total: -900,
        createdAt,
        payments: [{ method: 'cash', amount: -900 }],
        lines: [{ kind: 'product', productId: 'p2', qty: -1, unitPrice: 1000, discount: { type: 'percentage', value: 10 } }],
      }),
      -900,
    );
    insertSale(db, 's4', '{no es json', 0);

    const { topProducts } = new DashboardService(db).getSummary({ period: 'today' });

    expect(topProducts).toEqual([
      { key: 'freeform:varios', kind: 'freeform', name: 'Varios', unitsSold: 2, totalRevenue: 700 },
      {
        key: 'product:p1',
        kind: 'product',
        productId: 'p1',
        name: 'Alfajor Triple Dulce de Leche',
        unitsSold: 1,
        totalRevenue: 950,
      },
      { key: 'product:p2', kind: 'product', productId: 'p2', name: 'Gaseosa 500 ml', unitsSold: 1, totalRevenue: 900 },
      {
        key: 'product:p-borrado',
        kind: 'product',
        productId: 'p-borrado',
        name: 'Producto eliminado',
        unitsSold: 1,
        totalRevenue: 200,
      },
    ]);
  });

  it('el historial simulado de las demos usa líneas y medios de pago del contrato', () => {
    insertProduct(db, 'p3', 'Yerba 1 kg', 3200);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO branches (id, name, code, created_at) VALUES ('b1', 'Central', 'CENTRAL', ?)").run(now);
    // Los clientes a los que el generador les vende (cuenta corriente y consumidor final)
    for (const [id, name] of [['cust-juan', 'Juan'], ['cust-cf', 'Consumidor Final']] as const) {
      db.prepare('INSERT INTO customers (id, name, balance, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(id, name, now, now);
    }
    generateHistoricalDemoActivity(db, 'b1');

    const rows = db.prepare('SELECT payload FROM sales').all() as Array<{ payload: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const sale = JSON.parse(row.payload) as {
        lines: Array<Record<string, unknown>>;
        payments: Array<{ method: string }>;
      };
      for (const line of sale.lines) {
        expect(saleLineSchema.safeParse(line).success).toBe(true);
        expect(line).not.toHaveProperty('name');
        expect(line).not.toHaveProperty('lineTotal');
      }
      for (const payment of sale.payments) {
        expect(['cash', 'debit', 'credit', 'transfer', 'qr', 'account']).toContain(payment.method);
      }
    }
  });
});
