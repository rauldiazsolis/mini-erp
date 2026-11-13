import { sql, type Kysely } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
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
  payload: unknown;
  total: number;
  created_at: string;
  day: string | null;
  voids_sale_id: string | null;
  voided: boolean;
};

const PERIOD_DAYS: Record<DashboardPeriod, number> = { today: 1, week: 7, month: 30 };
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Vigente: ni anulación ni anulada (#20). La cantidad de tickets y el promedio cuentan solo estos. */
function isValid(sale: SaleRow): boolean {
  return sale.voids_sale_id === null && !sale.voided;
}

function dayLabel(day: string, withWeekday: boolean): string {
  const [, month = '', date = ''] = day.split('-');
  const weekday = WEEKDAYS[new Date(`${day}T12:00:00.000Z`).getUTCDay()] ?? '';
  return withWeekday ? `${weekday} ${date}/${month}` : `${date}/${month}`;
}

export class DashboardService {
  private db: Kysely<TenantDatabase>;
  private now: () => Date;

  constructor(db: Kysely<TenantDatabase>, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  public async getSummary(options?: { period?: DashboardPeriod | undefined; branchId?: string | undefined }): Promise<DashboardSummaryResponse> {
    const period: DashboardPeriod = options?.period ?? 'today';
    const branchId = options?.branchId;

    // Días argentinos (#20): hoy, y el bloque de la misma cantidad de días justo antes
    const days = PERIOD_DAYS[period];
    const today = argentinaToday(this.now());
    const from = shiftDay(today, -(days - 1));
    const sales = await this.fetchSales(from, today, branchId);
    const prevSales = await this.fetchSales(shiftDay(from, -days), shiftDay(from, -1), branchId);

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
    const topProducts = await this.calculateTopProducts(sales);
    const customerMetrics = await this.calculateCustomerMetrics();
    const stockAlerts = await this.calculateStockAlerts(await this.branchIdByCode(branchId));

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

  private async fetchSales(from: string, to: string, branchId?: string): Promise<SaleRow[]> {
    let query = this.db
      .selectFrom('sales as s')
      .select(['s.id', 's.payload', 's.total', 's.created_at', 's.day', 's.voids_sale_id'])
      .select((eb) => eb.exists(eb.selectFrom('sales as v').select(sql.lit(1).as('one')).whereRef('v.voids_sale_id', '=', 's.id')).$castTo<boolean>().as('voided'))
      .where('s.day', '>=', from)
      .where('s.day', '<=', to);
    if (branchId !== undefined && branchId !== '') {
      query = query.where('s.branch', '=', branchId);
    }
    return query.orderBy('s.created_at', 'asc').orderBy('s.id', 'asc').execute();
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
  private async calculateTopProducts(sales: SaleRow[]): Promise<TopProductItem[]> {
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
    const names = await this.productNames(top.flatMap((e) => (e.productId === undefined ? [] : [e.productId])));

    return top.map((e) => ({
      key: e.key,
      kind: e.kind,
      ...(e.productId === undefined ? {} : { productId: e.productId }),
      name: e.productId === undefined ? e.label : (names.get(e.productId) ?? 'Producto eliminado'),
      unitsSold: Math.round(e.units * 1000) / 1000,
      totalRevenue: roundAmount(e.revenue),
    }));
  }

  private async productNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.selectFrom('products').select(['id', 'name']).where('id', 'in', ids).execute();
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async calculateCustomerMetrics(): Promise<{ totalReceivables: number; debtorCount: number; totalCustomers: number }> {
    const receivables = await this.db
      .selectFrom('customers')
      .select((eb) => [eb.fn.coalesce(eb.fn.sum<number>('balance'), sql.lit(0)).as('total'), eb.fn.countAll<number>().as('count')])
      .where('balance', '>', 0)
      .executeTakeFirstOrThrow();
    const customers = await this.db
      .selectFrom('customers')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();

    return {
      totalReceivables: receivables.total,
      debtorCount: receivables.count,
      totalCustomers: customers.count,
    };
  }

  /**
   * El filtro de sucursal es su código, como `sales.branch` (lo que manda el POS); el stock va por
   * el id de la sucursal. Un código desconocido no encuentra stock: no cae en "todas".
   */
  private async branchIdByCode(code: string | undefined): Promise<string | undefined> {
    if (code === undefined || code === '') return undefined;
    const row = await this.db.selectFrom('branches').select('id').where('code', '=', code).orderBy('seq').executeTakeFirst();
    return row?.id ?? `sin-sucursal:${code}`;
  }

  /** El stock de cada producto que lo controla (de una sucursal, o la suma de todas); sin filas de stock, 0. */
  private stockByProduct(branchId: string | undefined) {
    return this.db
      .selectFrom('products as p')
      .leftJoin('stock as s', (join) => {
        const on = join.onRef('s.product_id', '=', 'p.id');
        return branchId !== undefined && branchId !== '' ? on.on('s.branch_id', '=', branchId) : on;
      })
      .where('p.tracks_stock', '=', true)
      .groupBy('p.id')
      .select((eb) => ['p.id', 'p.sku', 'p.name', eb.fn.coalesce(eb.fn.sum<number>('s.quantity'), sql.lit(0)).as('stock')]);
  }

  private async calculateStockAlerts(branchId?: string): Promise<{ criticalCount: number; lowStockProducts: LowStockItem[] }> {
    const lowStockProducts = await this.db
      .selectFrom(this.stockByProduct(branchId).as('totals'))
      .select(['totals.id', 'totals.sku', 'totals.name', 'totals.stock'])
      .where('totals.stock', '<=', 5)
      .orderBy('totals.stock', 'asc')
      .orderBy('totals.id', 'asc')
      .limit(10)
      .execute();
    const critical = await this.db
      .selectFrom(this.stockByProduct(branchId).as('totals'))
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('totals.stock', '<=', 0)
      .executeTakeFirstOrThrow();

    return { criticalCount: critical.count, lowStockProducts };
  }
}
