import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { DashboardService } from '../src/server/dashboard/dashboard-service.ts';
import { saveSale } from '../src/server/sales/records.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

const caja = { deviceId: 'dev', branch: 'CENTRAL', pointOfSale: 'Caja 1' };
// 22:30 del 1/10 en Argentina; en UTC ya es el 2/10
const now = new Date('2026-10-02T01:30:00.000Z');

async function sale(db: Kysely<TenantDatabase>, id: string, createdAt: string, total: number, lines: unknown[], extra: Record<string, unknown> = {}): Promise<void> {
  await saveSale(db, { id, status: 'closed', createdAt, total, lines, payments: [{ method: 'cash', amount: total }], ...extra }, caja, createdAt);
}

describe('dashboard con día argentino y anulaciones como el POS (#20)', () => {
  let db: Kysely<TenantDatabase>;

  beforeEach(async () => {
    await new TenantManager(pgDb()).createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco' });
    db = pgDb().forTenant('kiosco');
    const at = now.toISOString();
    await db
      .insertInto('products')
      .values([
        { id: 'p1', sku: 'S1', name: 'Alfajor', price: 1000, created_at: at, updated_at: at },
        { id: 'p2', sku: 'S2', name: 'Gaseosa', price: 500, created_at: at, updated_at: at },
      ])
      .execute();
    // Ayer: c, anulada hoy por d
    await sale(db, 'c', '2026-09-30T15:00:00.000Z', 2000, [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 1000 }]);
    // Hoy (argentino): d anula c a las 19:00; a a las 20:00; b a las 21:30 (en UTC, 2/10)
    await sale(db, 'd', '2026-10-01T22:00:00.000Z', -2000, [{ kind: 'product', productId: 'p1', qty: -2, unitPrice: 1000 }], { voidsSaleId: 'c' });
    await sale(db, 'a', '2026-10-01T23:00:00.000Z', 1000, [{ kind: 'product', productId: 'p2', qty: 2, unitPrice: 500 }]);
    await sale(db, 'b', '2026-10-02T00:30:00.000Z', 500, [{ kind: 'product', productId: 'p2', qty: 1, unitPrice: 500 }]);
  });

  it('hoy: neto de todos los tickets, vigentes para cantidad y promedio, ayer completo para comparar', async () => {
    const res = await new DashboardService(db, () => now).getSummary({ period: 'today' });
    expect(res.summary).toMatchObject({
      totalSales: -500,
      salesCount: 2,
      averageTicket: 750,
      previousTotalSales: 2000,
      changePercentage: -125,
    });
    expect(res.timeline).toHaveLength(8);
    expect(res.timeline.every((p) => p.date === '2026-10-01')).toBe(true);
    expect(res.timeline.find((p) => p.label === '18:00')).toMatchObject({ total: -1000, count: 1 });
    expect(res.timeline.find((p) => p.label === '21:00')).toMatchObject({ total: 500, count: 1 });
  });

  it('el ranking netea las anulaciones y muestra solo unidades positivas', async () => {
    const res = await new DashboardService(db, () => now).getSummary({ period: 'today' });
    expect(res.topProducts.map((p) => [p.productId, p.unitsSold])).toEqual([['p2', 3]]);
  });

  it('7 días: un punto por día argentino, el último es hoy', async () => {
    const res = await new DashboardService(db, () => now).getSummary({ period: 'week' });
    expect(res.timeline.map((p) => p.date)).toEqual([
      '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01',
    ]);
    expect(res.summary.totalSales).toBe(1500);
    expect(res.summary.salesCount).toBe(2);
    expect(res.timeline.at(-2)).toMatchObject({ total: 2000, count: 0 });
  });
});
