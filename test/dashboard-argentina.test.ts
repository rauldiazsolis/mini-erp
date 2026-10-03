import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { DashboardService } from '../src/server/dashboard/dashboard-service.ts';
import { saveSale } from '../src/server/sales/records.ts';

const caja = { deviceId: 'dev', branch: 'CENTRAL', pointOfSale: 'Caja 1' };
// 22:30 del 1/10 en Argentina; en UTC ya es el 2/10
const now = new Date('2026-10-02T01:30:00.000Z');

function sale(db: DatabaseSync, id: string, createdAt: string, total: number, lines: unknown[], extra: Record<string, unknown> = {}): void {
  saveSale(db, { id, status: 'closed', createdAt, total, lines, payments: [{ method: 'cash', amount: total }], ...extra }, caja, createdAt);
}

describe('dashboard con día argentino y anulaciones como el POS (#20)', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    initTenantDb(db);
    const at = now.toISOString();
    db.prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p1', 'S1', 'Alfajor', 1000, ?, ?)").run(at, at);
    db.prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p2', 'S2', 'Gaseosa', 500, ?, ?)").run(at, at);
    // Ayer: c, anulada hoy por d
    sale(db, 'c', '2026-09-30T15:00:00.000Z', 2000, [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 1000 }]);
    // Hoy (argentino): d anula c a las 19:00; a a las 20:00; b a las 21:30 (en UTC, 2/10)
    sale(db, 'd', '2026-10-01T22:00:00.000Z', -2000, [{ kind: 'product', productId: 'p1', qty: -2, unitPrice: 1000 }], { voidsSaleId: 'c' });
    sale(db, 'a', '2026-10-01T23:00:00.000Z', 1000, [{ kind: 'product', productId: 'p2', qty: 2, unitPrice: 500 }]);
    sale(db, 'b', '2026-10-02T00:30:00.000Z', 500, [{ kind: 'product', productId: 'p2', qty: 1, unitPrice: 500 }]);
  });

  it('hoy: neto de todos los tickets, vigentes para cantidad y promedio, ayer completo para comparar', () => {
    const res = new DashboardService(db, () => now).getSummary({ period: 'today' });
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

  it('el ranking netea las anulaciones y muestra solo unidades positivas', () => {
    const res = new DashboardService(db, () => now).getSummary({ period: 'today' });
    expect(res.topProducts.map((p) => [p.productId, p.unitsSold])).toEqual([['p2', 3]]);
  });

  it('7 días: un punto por día argentino, el último es hoy', () => {
    const res = new DashboardService(db, () => now).getSummary({ period: 'week' });
    expect(res.timeline.map((p) => p.date)).toEqual([
      '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01',
    ]);
    expect(res.summary.totalSales).toBe(1500);
    expect(res.summary.salesCount).toBe(2);
    expect(res.timeline.at(-2)).toMatchObject({ total: 2000, count: 0 });
  });
});
