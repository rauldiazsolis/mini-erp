import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { jsonValue } from '../src/server/db/pg/sql-helpers.ts';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { DashboardService } from '../src/server/dashboard/dashboard-service.ts';
import { lineTotal, saleLineSchema } from '../src/server/dashboard/sale-lines.ts';
import { generateHistoricalDemoActivity } from '../src/server/seeds/demo-activity-generator.ts';
import { argentinaToday } from '../src/shared/argentina-day.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

async function insertProduct(db: Kysely<TenantDatabase>, id: string, name: string, price: number): Promise<void> {
  const now = new Date().toISOString();
  await db.insertInto('products').values({ id, sku: `SKU-${id}`, name, price, created_at: now, updated_at: now }).execute();
}

/** `payload` es lo que queda en la columna `jsonb`: un objeto o, para el caso roto, cualquier otra cosa. */
async function insertSale(db: Kysely<TenantDatabase>, id: string, payload: unknown, total: number): Promise<void> {
  await db
    .insertInto('sales')
    .values({
      id,
      payload: jsonValue(payload),
      device_id: 'pos_1',
      branch: 'CENTRAL',
      point_of_sale: 'Caja 1',
      total,
      voids_sale_id: null,
      created_at: new Date().toISOString(),
      day: argentinaToday(new Date()),
    })
    .execute();
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
  let db: Kysely<TenantDatabase>;

  beforeEach(async () => {
    await new TenantManager(pgDb(), { inMemory: true }).createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco' });
    db = pgDb().forTenant('kiosco');
    await insertProduct(db, 'p1', 'Alfajor Triple Dulce de Leche', 950);
    await insertProduct(db, 'p2', 'Gaseosa 500 ml', 1000);
  });

  it('nombres del catálogo, importes con descuento, freeform agrupadas y productos borrados', async () => {
    const createdAt = new Date().toISOString();
    await insertSale(
      db,
      's1',
      {
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
      },
      3150,
    );
    await insertSale(
      db,
      's2',
      {
        id: 's2',
        status: 'closed',
        total: 500,
        createdAt,
        payments: [{ method: 'cash', amount: 500 }],
        lines: [
          { kind: 'freeform', description: '  VARIOS', qty: 1, unitPrice: 300 },
          { kind: 'product', productId: 'p-borrado', qty: 1, unitPrice: 200 },
        ],
      },
      500,
    );
    await insertSale(
      db,
      's3',
      {
        id: 's3',
        status: 'closed',
        total: -900,
        createdAt,
        payments: [{ method: 'cash', amount: -900 }],
        lines: [{ kind: 'product', productId: 'p2', qty: -1, unitPrice: 1000, discount: { type: 'percentage', value: 10 } }],
      },
      -900,
    );
    // Un payload que no es un objeto de venta (en `jsonb` no entra un JSON roto): se saltea
    await insertSale(db, 's4', '{no es json', 0);

    const { topProducts } = await new DashboardService(db).getSummary({ period: 'today' });

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

  it('el historial simulado de las demos usa líneas y medios de pago del contrato', async () => {
    // El generador es de las semillas, que todavía escriben SQLite
    const db = new DatabaseSync(':memory:');
    initTenantDb(db);
    const now = new Date().toISOString();
    for (const [id, name, price] of [['p1', 'Alfajor Triple Dulce de Leche', 950], ['p2', 'Gaseosa 500 ml', 1000], ['p3', 'Yerba 1 kg', 3200]] as const) {
      db.prepare('INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, `SKU-${id}`, name, price, now, now);
    }
    db.prepare("INSERT INTO branches (id, name, code, created_at) VALUES ('b1', 'Central', 'CENTRAL', ?)").run(now);
    // Los clientes a los que el generador les vende (cuenta corriente y consumidor final)
    for (const [id, name] of [['cust-juan', 'Juan'], ['cust-cf', 'Consumidor Final']] as const) {
      db.prepare('INSERT INTO customers (id, name, balance, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(id, name, now, now);
    }
    await generateHistoricalDemoActivity(db, 'b1');

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
