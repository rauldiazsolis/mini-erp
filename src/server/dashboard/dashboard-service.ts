import { DatabaseSync } from 'node:sqlite';

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
  productId: string;
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
  branch: string | null;
  created_at: string;
};

export class DashboardService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public getSummary(options?: { period?: DashboardPeriod; branchId?: string }): DashboardSummaryResponse {
    const period: DashboardPeriod = options?.period ?? 'today';
    const branchId = options?.branchId;

    const now = new Date();
    const { startDate, endDate, prevStartDate, prevEndDate, timelineIntervals } = this.calculateDateRanges(now, period);

    // Obtener ventas válidas (excluyendo ventas anuladas o anulaciones)
    const validSales = this.fetchValidSales(startDate.toISOString(), endDate.toISOString(), branchId);
    const prevSales = this.fetchValidSales(prevStartDate.toISOString(), prevEndDate.toISOString(), branchId);

    const totalSales = validSales.reduce((acc, s) => acc + s.total, 0);
    const salesCount = validSales.length;
    const averageTicket = salesCount > 0 ? Math.round((totalSales / salesCount) * 100) / 100 : 0;

    const previousTotalSales = prevSales.reduce((acc, s) => acc + s.total, 0);
    const changePercentage =
      previousTotalSales > 0
        ? Math.round(((totalSales - previousTotalSales) / previousTotalSales) * 1000) / 10
        : 0;

    // Calcular Timeline
    const timeline = this.buildTimeline(validSales, timelineIntervals);

    // Calcular Top Products
    const topProducts = this.calculateTopProducts(validSales);

    // Calcular Cuentas Corrientes
    const customerMetrics = this.calculateCustomerMetrics();

    // Calcular Alertas de Stock
    const stockAlerts = this.calculateStockAlerts(branchId);

    return {
      period,
      branchId,
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

  private fetchValidSales(startIso: string, endIso: string, branchId?: string): SaleRow[] {
    let sql = `
      SELECT id, payload, total, branch, created_at
      FROM sales
      WHERE voids_sale_id IS NULL
        AND id NOT IN (SELECT voids_sale_id FROM sales WHERE voids_sale_id IS NOT NULL)
        AND created_at >= ?
        AND created_at <= ?
    `;
    const params: string[] = [startIso, endIso];

    if (branchId !== undefined && branchId !== '') {
      sql += ` AND branch = ?`;
      params.push(branchId);
    }

    sql += ` ORDER BY created_at ASC`;

    return this.db.prepare(sql).all(...params) as unknown as SaleRow[];
  }

  private calculateDateRanges(
    now: Date,
    period: DashboardPeriod,
  ): {
    startDate: Date;
    endDate: Date;
    prevStartDate: Date;
    prevEndDate: Date;
    timelineIntervals: { start: Date; end: Date; label: string }[];
  } {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const endDate = now;

    if (period === 'today') {
      const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const prevStartDate = new Date(startDate.getTime() - ONE_DAY_MS);
      const prevEndDate = new Date(now.getTime() - ONE_DAY_MS);

      // Fraccionamiento por tramos horarios (cada 3 horas: 00-03, 03-06, ..., 21-24)
      const timelineIntervals: { start: Date; end: Date; label: string }[] = [];
      for (let h = 0; h < 24; h += 3) {
        const iStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), h, 0, 0, 0);
        const iEnd = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), h + 3, 0, 0, 0);
        const label = `${String(h).padStart(2, '0')}:00`;
        timelineIntervals.push({ start: iStart, end: iEnd, label });
      }

      return { startDate, endDate, prevStartDate, prevEndDate, timelineIntervals };
    }

    if (period === 'week') {
      // 7 días exactos: desde (now - 6 días a las 00:00:00) hasta now
      const startDayBase = new Date(now.getTime() - 6 * ONE_DAY_MS);
      const startDate = new Date(startDayBase.getFullYear(), startDayBase.getMonth(), startDayBase.getDate(), 0, 0, 0, 0);

      const prevStartDayBase = new Date(now.getTime() - 13 * ONE_DAY_MS);
      const prevStartDate = new Date(prevStartDayBase.getFullYear(), prevStartDayBase.getMonth(), prevStartDayBase.getDate(), 0, 0, 0, 0);
      const prevEndDate = new Date(startDate.getTime() - 1);

      const timelineIntervals: { start: Date; end: Date; label: string }[] = [];
      const weekdays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

      for (let d = 6; d >= 0; d--) {
        const dayRef = new Date(now.getTime() - d * ONE_DAY_MS);
        const iStart = new Date(dayRef.getFullYear(), dayRef.getMonth(), dayRef.getDate(), 0, 0, 0, 0);
        const iEnd = new Date(dayRef.getFullYear(), dayRef.getMonth(), dayRef.getDate(), 23, 59, 59, 999);
        const dayName = weekdays[iStart.getDay()] ?? '';
        const dayNum = String(iStart.getDate()).padStart(2, '0');
        const monthNum = String(iStart.getMonth() + 1).padStart(2, '0');
        const label = `${dayName} ${dayNum}/${monthNum}`;
        timelineIntervals.push({ start: iStart, end: iEnd, label });
      }

      return { startDate, endDate, prevStartDate, prevEndDate, timelineIntervals };
    }

    // Period === 'month' (30 días)
    const startDayBase = new Date(now.getTime() - 29 * ONE_DAY_MS);
    const startDate = new Date(startDayBase.getFullYear(), startDayBase.getMonth(), startDayBase.getDate(), 0, 0, 0, 0);

    const prevStartDayBase = new Date(now.getTime() - 59 * ONE_DAY_MS);
    const prevStartDate = new Date(prevStartDayBase.getFullYear(), prevStartDayBase.getMonth(), prevStartDayBase.getDate(), 0, 0, 0, 0);
    const prevEndDate = new Date(startDate.getTime() - 1);

    const timelineIntervals: { start: Date; end: Date; label: string }[] = [];
    for (let d = 29; d >= 0; d--) {
      const dayRef = new Date(now.getTime() - d * ONE_DAY_MS);
      const iStart = new Date(dayRef.getFullYear(), dayRef.getMonth(), dayRef.getDate(), 0, 0, 0, 0);
      const iEnd = new Date(dayRef.getFullYear(), dayRef.getMonth(), dayRef.getDate(), 23, 59, 59, 999);
      const dayNum = String(iStart.getDate()).padStart(2, '0');
      const monthNum = String(iStart.getMonth() + 1).padStart(2, '0');
      const label = `${dayNum}/${monthNum}`;
      timelineIntervals.push({ start: iStart, end: iEnd, label });
    }

    return { startDate, endDate, prevStartDate, prevEndDate, timelineIntervals };
  }

  private buildTimeline(
    sales: SaleRow[],
    intervals: { start: Date; end: Date; label: string }[],
  ): TimelinePoint[] {
    return intervals.map((interval) => {
      const startMs = interval.start.getTime();
      const endMs = interval.end.getTime();

      let total = 0;
      let count = 0;

      for (const sale of sales) {
        const saleMs = new Date(sale.created_at).getTime();
        if (saleMs >= startMs && saleMs <= endMs) {
          total += sale.total;
          count++;
        }
      }

      return {
        date: interval.start.toISOString().split('T')[0] ?? '',
        label: interval.label,
        total,
        count,
      };
    });
  }

  private calculateTopProducts(sales: SaleRow[]): TopProductItem[] {
    const productMap = new Map<string, { productId: string; name: string; unitsSold: number; totalRevenue: number }>();

    for (const sale of sales) {
      let lines: Array<{ productId?: string; name?: string; qty?: number; lineTotal?: number }> = [];
      try {
        const parsed = JSON.parse(sale.payload) as { lines?: Array<{ productId?: string; name?: string; qty?: number; lineTotal?: number }> };
        if (Array.isArray(parsed.lines)) {
          lines = parsed.lines;
        }
      } catch {
        // Ignorar payload malformado
      }

      for (const line of lines) {
        if (line.productId !== undefined && line.productId !== '') {
          const prodId = line.productId;
          const current = productMap.get(prodId) ?? {
            productId: prodId,
            name: line.name ?? 'Producto',
            unitsSold: 0,
            totalRevenue: 0,
          };
          current.unitsSold += line.qty ?? 0;
          current.totalRevenue += line.lineTotal ?? 0;
          productMap.set(prodId, current);
        }
      }
    }

    const list = Array.from(productMap.values());
    list.sort((a, b) => b.unitsSold - a.unitsSold || b.totalRevenue - a.totalRevenue);
    return list.slice(0, 5);
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
