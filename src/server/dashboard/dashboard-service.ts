import { DatabaseSync } from 'node:sqlite';
import { lineTotal, parseSaleLines, roundAmount } from './sale-lines.ts';
import { argentinaHour, argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import { readSale } from '../sales/stored-documents.ts';

export type DashboardPeriod = 'today' | 'week' | 'month';

export type DashboardSummaryMetrics = {
  totalSales: number;
  salesCount: number;
  averageTicket: number;
  previousTotalSales: number;
  changePercentage: number;
  totalReceivables: number;
  debtorCount: number;
  totalCustomers: number;
};

export type TimelinePoint = {
  date: string;
  label: string;
  total: number;
  count: number;
};

export type TopProductItem = {
  key: string;
  kind: 'product' | 'freeform';
  productId?: string;
  name: string;
  unitsSold: number;
  totalRevenue: number;
};

export type LowStockItem = {
  id: string;
  sku: string;
  name: string;
  stock: number;
};

export type DashboardSummaryResponse = {
  period: DashboardPeriod;
  branchId?: string;
  summary: DashboardSummaryMetrics;
  timeline: TimelinePoint[];
  topProducts: TopProductItem[];
  stockAlerts: {
    criticalCount: number;
    lowStockProducts: LowStockItem[];
  };
};

type SaleRow = {
  id: string;
  payload: string;
  total: number;
  created_at: string;
  day: string;
  voids_sale_id: string | null;
  voided: number;
};

const PERIOD_DAYS: Record<DashboardPeriod, number> = { today: 1, week: 7, month: 30 };
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Vigente: ni anulación ni anulada (#20). La cantidad de tickets y el promedio cuentan solo estos. */
function isValid(sale: SaleRow): boolean {
  return sale.voids_sale_id === null && sale.voided === 0;
}

function dayLabel(day: string, withWeekday: boolean): string {
  const [, month = '', date = ''] = day.split('-');
  const weekday = WEEKDAYS[new Date(`${day}T12:00:00.000Z`).getUTCDay()] ?? '';
  return withWeekday ? `${weekday} ${date}/${month}` : `${date}/${month}`;
}

export class DashboardService {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  public getSummary(options?: { period?: DashboardPeriod | undefined; branchId?: string | undefined }): DashboardSummaryResponse {
    const period: DashboardPeriod = options?.period ?? 'today';
    const branchId = options?.branchId;

    // Días argentinos (#20): hoy, y el bloque de la misma cantidad de días justo antes
    const days = PERIOD_DAYS[period];
    const today = argentinaToday(this.now());
    const from = shiftDay(today, -(days - 1));
    const sales = this.fetchSales(from, today, branchId);
    const prevSales = this.fetchSales(shiftDay(from, -days), shiftDay(from, -1), branchId);

    // Como el POS: el total es el neto de todos los tickets; cantidad y promedio, de los vigentes
    const valid = sales.filter(isValid);
    const totalSales = roundAmount(sales.reduce((acc, s) => acc + s.total, 0));
    const salesCount = valid.length;
    const averageTicket = salesCount > 0 ? roundAmount(valid.reduce((acc, s) => acc + s.total, 0) / salesCount) : 0;
    const previousTotalSales = roundAmount(prevSales.reduce((acc, s) => acc + s.total, 0));
    const changePercentage =
      previousTotalSales !== 0
        ? Math.round(((totalSales - previousTotalSales) / Math.abs(previousTotalSales)) * 1000) / 10
        : 0;

    const timeline = period === 'today' ? this.hourlyTimeline(sales, today) : this.dailyTimeline(sales, from, days, period === 'week');
    const topProducts = this.calculateTopProducts(sales);
    const customerMetrics = this.calculateCustomerMetrics();
    const stockAlerts = this.calculateStockAlerts(branchId);

    return {
      period,
      ...(branchId === undefined ? {} : { branchId }),
      summary: {
        totalSales,
        salesCount,
        averageTicket,
        previousTotalSales,
        changePercentage,
        totalReceivables: customerMetrics.totalReceivables,
        debtorCount: customerMetrics.debtorCount,
        totalCustomers: customerMetrics.totalCustomers,
      },
      timeline,
      topProducts,
      stockAlerts,
    };
  }

  private fetchSales(from: string, to: string, branchId?: string): SaleRow[] {
    let sql = `
      SELECT s.id, s.payload, s.total, s.created_at, s.day, s.voids_sale_id,
        EXISTS (SELECT 1 FROM sales v WHERE v.voids_sale_id = s.id) AS voided
      FROM sales s
      WHERE s.day BETWEEN ? AND ?`;
    const params: string[] = [from, to];
    if (branchId !== undefined && branchId !== '') {
      sql += ' AND s.branch = ?';
      params.push(branchId);
    }
    return this.db.prepare(`${sql} ORDER BY s.created_at ASC`).all(...params) as unknown as SaleRow[];
  }

  /** "Hoy": tramos de 3 horas argentinas, sobre el `createdAt` de cada venta. */
  private hourlyTimeline(sales: SaleRow[], today: string): TimelinePoint[] {
    const points: TimelinePoint[] = [];
    for (let h = 0; h < 24; h += 3) {
      const inSlot = sales.filter((s) => {
        const hour = argentinaHour(readSale(s.payload).createdAt ?? s.created_at);
        return hour !== null && hour >= h && hour < h + 3;
      });
      points.push({
        date: today,
        label: `${String(h).padStart(2, '0')}:00`,
        total: roundAmount(inSlot.reduce((acc, s) => acc + s.total, 0)),
        count: inSlot.filter(isValid).length,
      });
    }
    return points;
  }

  private dailyTimeline(sales: SaleRow[], from: string, days: number, withWeekday: boolean): TimelinePoint[] {
    return Array.from({ length: days }, (_, i) => {
      const day = shiftDay(from, i);
      const inDay = sales.filter((s) => s.day === day);
      return {
        date: day,
        label: dayLabel(day, withWeekday),
        total: roundAmount(inDay.reduce((acc, s) => acc + s.total, 0)),
        count: inDay.filter(isValid).length,
      };
    });
  }

  /**
   * Top 5 por unidades (#15): productos por `productId`, con el nombre del catálogo; líneas
   * `freeform` agrupadas por descripción normalizada. Importes con la fórmula del POS.
   */
  private calculateTopProducts(sales: SaleRow[]): TopProductItem[] {
    type Entry = {
      key: string;
      kind: 'product' | 'freeform';
      productId?: string;
      label: string;
      units: number;
      revenue: number;
    };
    const entries = new Map<string, Entry>();

    for (const sale of sales) {
      for (const line of parseSaleLines(sale.payload)) {
        let fresh: Entry;
        if (line.kind === 'product') {
          fresh = { key: `product:${line.productId}`, kind: 'product', productId: line.productId, label: '', units: 0, revenue: 0 };
        } else {
          const label = line.description.trim().replace(/\s+/g, ' ');
          if (label === '') continue;
          fresh = { key: `freeform:${label.toLowerCase()}`, kind: 'freeform', label, units: 0, revenue: 0 };
        }
        const entry = entries.get(fresh.key) ?? fresh;
        entry.units += line.qty;
        entry.revenue += lineTotal(line);
        entries.set(entry.key, entry);
      }
    }

    // Neto de anulaciones (#20): un producto con unidades netas no positivas no entra al ranking
    const top = Array.from(entries.values())
      .filter((e) => e.units > 0)
      .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
      .slice(0, 5);
    const names = this.productNames(top.flatMap((e) => (e.productId === undefined ? [] : [e.productId])));

    return top.map((e) => ({
      key: e.key,
      kind: e.kind,
      ...(e.productId === undefined ? {} : { productId: e.productId }),
      name: e.productId === undefined ? e.label : (names.get(e.productId) ?? 'Producto eliminado'),
      unitsSold: Math.round(e.units * 1000) / 1000,
      totalRevenue: roundAmount(e.revenue),
    }));
  }

  private productNames(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map();
    const rows = this.db
      .prepare(`SELECT id, name FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids) as unknown as Array<{ id: string; name: string }>;
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private calculateCustomerMetrics(): { totalReceivables: number; debtorCount: number; totalCustomers: number } {
    const receivablesRow = this.db
      .prepare('SELECT COALESCE(SUM(balance), 0) as total, COUNT(*) as count FROM customers WHERE balance > 0')
      .get() as { total: number; count: number };

    const totalCustomersRow = this.db.prepare('SELECT COUNT(*) as count FROM customers').get() as { count: number };

    return {
      totalReceivables: receivablesRow.total,
      debtorCount: receivablesRow.count,
      totalCustomers: totalCustomersRow.count,
    };
  }

  private calculateStockAlerts(branchId?: string): { criticalCount: number; lowStockProducts: LowStockItem[] } {
    let sql = `
      SELECT p.id, p.sku, p.name, COALESCE(SUM(s.quantity), 0) as stock
      FROM products p
      LEFT JOIN stock s ON p.id = s.product_id
    `;
    const params: string[] = [];

    if (branchId !== undefined && branchId !== '') {
      sql += ` AND s.branch_id = ?`;
      params.push(branchId);
    }

    sql += `
      WHERE p.tracks_stock = 1
      GROUP BY p.id
      HAVING stock <= 5
      ORDER BY stock ASC
      LIMIT 10
    `;

    const rows = this.db.prepare(sql).all(...params) as unknown as LowStockItem[];

    let criticalSql = `
      SELECT COUNT(*) as count FROM (
        SELECT p.id, COALESCE(SUM(s.quantity), 0) as stock
        FROM products p
        LEFT JOIN stock s ON p.id = s.product_id
    `;
    const critParams: string[] = [];
    if (branchId !== undefined && branchId !== '') {
      criticalSql += ` AND s.branch_id = ?`;
      critParams.push(branchId);
    }
    criticalSql += `
        WHERE p.tracks_stock = 1
        GROUP BY p.id
        HAVING stock <= 0
      )
    `;

    const criticalRow = this.db.prepare(criticalSql).get(...critParams) as { count: number };

    return {
      criticalCount: criticalRow.count,
      lowStockProducts: rows,
    };
  }
}
