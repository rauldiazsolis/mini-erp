import type { DatabaseSync } from 'node:sqlite';
import { argentinaDay, daysBetween } from '../../shared/argentina-day.ts';
import { PAYMENT_METHODS } from '../../shared/payment-methods.ts';
import type {
  CashMovementItem, CustomerPaymentItem, DocStatus, ListResult, RegisterItem, SaleDetail, SaleDetailLine, SaleKind,
  SaleListItem,
} from '../../shared/sales-types.ts';
import { lineTotal, roundAmount } from '../dashboard/sale-lines.ts';
import { DomainError } from '../errors.ts';
import { readCashMovement, readCustomerPayment, readSale } from './stored-documents.ts';

export type RegisterFilter = { branch?: string | undefined; pointOfSale?: string | undefined };
export type DayRange = { from: string; to: string };
export type Paging = { page: number; pageSize: number };
export type SalesFilter = DayRange & RegisterFilter & {
  method?: string | undefined;
  customerId?: string | undefined;
  productId?: string | undefined;
  kind?: SaleKind | undefined;
  status?: DocStatus | undefined;
};
export type PaymentsFilter = DayRange & RegisterFilter & {
  method?: string | undefined;
  customerId?: string | undefined;
  status?: DocStatus | undefined;
};
export type MovementsFilter = DayRange & RegisterFilter & {
  direction?: 'in' | 'out' | undefined;
  source?: 'manual' | 'count-adjustment' | undefined;
};

type Params = Array<string | number>;
type Where = { clauses: string[]; params: Params };

type SaleRow = {
  id: string;
  payload: string;
  branch: string | null;
  point_of_sale: string | null;
  total: number;
  voids_sale_id: string | null;
  created_at: string;
  day: string | null;
  customer_id: string | null;
  customer_name: string | null;
  voided_by: string | null;
};

type PaymentRow = {
  id: string;
  payload: string;
  branch: string | null;
  point_of_sale: string | null;
  customer_id: string;
  customer_name: string | null;
  voids_payment_id: string | null;
  created_at: string;
  day: string | null;
  total: number;
  voided_by: string | null;
};

type MovementRow = { id: string; payload: string; branch: string | null; point_of_sale: string | null; created_at: string; day: string | null };

/** El payload, o `{}` si no es JSON: así `json_each` nunca tira "malformed JSON". */
export const safePayload = (alias: string): string => `CASE WHEN json_valid(${alias}.payload) THEN ${alias}.payload ELSE '{}' END`;

const PAYMENT_COLUMNS = `cp.id, cp.payload, cp.branch, cp.point_of_sale, cp.customer_id, c.name AS customer_name, cp.voids_payment_id,
  cp.created_at, cp.day, COALESCE(json_extract(${safePayload('cp')}, '$.total'), 0) AS total,
  (SELECT v.id FROM customer_payments v WHERE v.voids_payment_id = cp.id ORDER BY v.created_at LIMIT 1) AS voided_by`;

/** El importe con signo de un movimiento de caja: ingreso suma, egreso resta. */
const signedAmount = (alias: string): string =>
  `CASE json_extract(${safePayload(alias)}, '$.direction')
     WHEN 'in' THEN json_extract(${safePayload(alias)}, '$.amount')
     WHEN 'out' THEN -json_extract(${safePayload(alias)}, '$.amount')
     ELSE 0 END`;

/** `LIMIT`/`OFFSET` de una página; sin página, todas las filas (para los resúmenes). */
function paged(paging: Paging | undefined, params: Params): { limit: string; params: Params } {
  return paging === undefined
    ? { limit: '', params }
    : { limit: ' LIMIT ? OFFSET ?', params: [...params, paging.pageSize, (paging.page - 1) * paging.pageSize] };
}

const KNOWN_METHODS = PAYMENT_METHODS.map((method) => `'${method}'`).join(', ');

/** Rango de días y caja. Un `branch` o `pointOfSale` vacío filtra los que no tienen. */
export function rangeAndRegister(alias: string, filter: DayRange & RegisterFilter): Where {
  const where: Where = { clauses: [`${alias}.day BETWEEN ? AND ?`], params: [filter.from, filter.to] };
  const columns: Array<[string, string | undefined]> = [['branch', filter.branch], ['point_of_sale', filter.pointOfSale]];
  for (const [column, value] of columns) {
    if (value === undefined) continue;
    if (value === '') {
      where.clauses.push(`(${alias}.${column} IS NULL OR ${alias}.${column} = '')`);
    } else {
      where.clauses.push(`${alias}.${column} = ?`);
      where.params.push(value);
    }
  }
  return where;
}

/** Algún pago con ese medio; `other` es cualquiera fuera del contrato. */
export function addMethod(where: Where, alias: string, method: string): void {
  const condition = method === 'other'
    ? `json_extract(p.value, '$.method') NOT IN (${KNOWN_METHODS})`
    : `json_extract(p.value, '$.method') = ?`;
  where.clauses.push(`EXISTS (SELECT 1 FROM json_each(${safePayload(alias)}, '$.payments') p WHERE ${condition})`);
  if (method !== 'other') where.params.push(method);
}

/** Valida el rango: hasta 366 días, `from` no posterior a `to`. */
export function assertRange(range: DayRange): void {
  const days = daysBetween(range.from, range.to);
  if (Number.isNaN(days) || days < 0) {
    throw new DomainError(400, 'La fecha "desde" no puede ser posterior a "hasta"');
  }
  if (days > 365) {
    throw new DomainError(400, 'El rango puede tener hasta 366 días');
  }
}

function saleKind(row: { voids_sale_id: string | null; total: number }): SaleKind {
  if (row.voids_sale_id !== null) return 'void';
  return row.total < 0 ? 'return' : 'sale';
}

const SALE_COLUMNS = `s.id, s.payload, s.branch, s.point_of_sale, s.total, s.voids_sale_id, s.created_at, s.day, s.customer_id,
  c.name AS customer_name,
  (SELECT v.id FROM sales v WHERE v.voids_sale_id = s.id ORDER BY v.created_at LIMIT 1) AS voided_by`;

/**
 * Consultas de Ventas & Caja (#20), de un comercio. Los tres roles las ven. La caja es siempre un
 * filtro, así la vista "mi caja" del portal (M10) llama a los mismos métodos con la caja fija.
 */
export class SalesQueryService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  registers(): RegisterItem[] {
    const rows = this.db
      .prepare(
        `SELECT branch, point_of_sale FROM sales
         UNION SELECT branch, point_of_sale FROM customer_payments
         UNION SELECT branch, point_of_sale FROM cash_movements
         ORDER BY 1, 2`,
      )
      .all() as { branch: string | null; point_of_sale: string | null }[];
    return rows.map((r) => ({ branch: r.branch, pointOfSale: r.point_of_sale }));
  }

  listSales(filter: SalesFilter, paging: Paging): ListResult<SaleListItem> {
    assertRange(filter);
    const where = this.salesWhere(filter);
    const sql = where.clauses.join(' AND ');
    const totals = this.db
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(s.total), 0) AS net FROM sales s WHERE ${sql}`)
      .get(...where.params) as { count: number; net: number };
    return {
      items: this.saleRows(filter, paging).map((row) => this.toSaleItem(row)),
      count: totals.count,
      page: paging.page,
      pageSize: paging.pageSize,
      netTotal: roundAmount(totals.net),
    };
  }

  getSale(id: string): SaleDetail {
    const row = this.db
      .prepare(`SELECT ${SALE_COLUMNS} FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`)
      .get(id) as SaleRow | undefined;
    if (row === undefined) {
      throw new DomainError(404, 'Venta no encontrada');
    }
    const stored = readSale(row.payload);
    const names = this.productNames(stored.lines.flatMap((l) => (l.kind === 'product' ? [l.productId] : [])));
    const lines: SaleDetailLine[] = stored.lines.map((line) => ({
      kind: line.kind,
      ...(line.kind === 'product' ? { productId: line.productId } : {}),
      name: line.kind === 'product' ? (names.get(line.productId) ?? 'Producto eliminado') : line.description,
      qty: line.qty,
      unitPrice: line.unitPrice,
      ...(line.discount === undefined ? {} : { discount: line.discount }),
      total: lineTotal(line),
    }));
    const subtotal = roundAmount(lines.reduce((sum, line) => sum + line.total, 0));
    return {
      ...this.toSaleItem(row),
      lines,
      subtotal,
      globalAdjustment: roundAmount(row.total - subtotal),
      payments: stored.payments,
      ...(stored.voidReason === undefined ? {} : { voidReason: stored.voidReason }),
    };
  }

  /** Las filas del filtro; sin `paging`, todas (para los resúmenes). */
  protected saleRows(filter: SalesFilter, paging?: Paging): SaleRow[] {
    const where = this.salesWhere(filter);
    const page = paged(paging, where.params);
    return this.db
      .prepare(
        `SELECT ${SALE_COLUMNS} FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE ${where.clauses.join(' AND ')}
         ORDER BY s.day DESC, s.created_at DESC, s.id DESC${page.limit}`,
      )
      .all(...page.params) as unknown as SaleRow[];
  }

  protected toSaleItem(row: SaleRow): SaleListItem {
    const stored = readSale(row.payload);
    const createdAt = stored.createdAt ?? row.created_at;
    return {
      id: row.id,
      day: row.day ?? argentinaDay(createdAt) ?? '',
      createdAt,
      ...(stored.ticket === undefined ? {} : { ticket: stored.ticket }),
      branch: row.branch,
      pointOfSale: row.point_of_sale,
      ...(row.customer_id === null
        ? {}
        : { customer: { id: row.customer_id, ...(row.customer_name === null ? {} : { name: row.customer_name }) } }),
      methods: [...new Set(stored.payments.map((p) => p.method))],
      total: row.total,
      kind: saleKind(row),
      voided: row.voided_by !== null,
      ...(row.voided_by === null ? {} : { voidedBy: row.voided_by }),
      ...(row.voids_sale_id === null ? {} : { voidsSaleId: row.voids_sale_id }),
    };
  }

  listCustomerPayments(filter: PaymentsFilter, paging: Paging): ListResult<CustomerPaymentItem> {
    assertRange(filter);
    const where = this.paymentsWhere(filter);
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(json_extract(${safePayload('cp')}, '$.total')), 0) AS net
         FROM customer_payments cp WHERE ${where.clauses.join(' AND ')}`,
      )
      .get(...where.params) as { count: number; net: number };
    return {
      items: this.paymentRows(filter, paging).map((row) => this.toPaymentItem(row)),
      count: totals.count,
      page: paging.page,
      pageSize: paging.pageSize,
      netTotal: roundAmount(totals.net),
    };
  }

  listCashMovements(filter: MovementsFilter, paging: Paging): ListResult<CashMovementItem> {
    assertRange(filter);
    const where = this.movementsWhere(filter);
    const totals = this.db
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(${signedAmount('m')}), 0) AS net FROM cash_movements m WHERE ${where.clauses.join(' AND ')}`)
      .get(...where.params) as { count: number; net: number };
    return {
      items: this.movementRows(filter, paging).map((row) => this.toMovementItem(row)),
      count: totals.count,
      page: paging.page,
      pageSize: paging.pageSize,
      netTotal: roundAmount(totals.net),
    };
  }

  protected paymentRows(filter: PaymentsFilter, paging?: Paging): PaymentRow[] {
    const where = this.paymentsWhere(filter);
    const page = paged(paging, where.params);
    return this.db
      .prepare(
        `SELECT ${PAYMENT_COLUMNS} FROM customer_payments cp LEFT JOIN customers c ON c.id = cp.customer_id
         WHERE ${where.clauses.join(' AND ')}
         ORDER BY cp.day DESC, cp.created_at DESC, cp.id DESC${page.limit}`,
      )
      .all(...page.params) as unknown as PaymentRow[];
  }

  protected toPaymentItem(row: PaymentRow): CustomerPaymentItem {
    const stored = readCustomerPayment(row.payload);
    const createdAt = stored.createdAt ?? row.created_at;
    return {
      id: row.id,
      day: row.day ?? argentinaDay(createdAt) ?? '',
      createdAt,
      ...(stored.receipt === undefined ? {} : { receipt: stored.receipt }),
      branch: row.branch,
      pointOfSale: row.point_of_sale,
      customer: { id: row.customer_id, ...(row.customer_name === null ? {} : { name: row.customer_name }) },
      payments: stored.payments,
      total: row.total,
      voided: row.voided_by !== null,
      ...(row.voided_by === null ? {} : { voidedBy: row.voided_by }),
      ...(row.voids_payment_id === null ? {} : { voidsPaymentId: row.voids_payment_id }),
    };
  }

  protected movementRows(filter: MovementsFilter, paging?: Paging): MovementRow[] {
    const where = this.movementsWhere(filter);
    const page = paged(paging, where.params);
    return this.db
      .prepare(
        `SELECT m.id, m.payload, m.branch, m.point_of_sale, m.created_at, m.day FROM cash_movements m
         WHERE ${where.clauses.join(' AND ')}
         ORDER BY m.day DESC, m.created_at DESC, m.id DESC${page.limit}`,
      )
      .all(...page.params) as unknown as MovementRow[];
  }

  protected toMovementItem(row: MovementRow): CashMovementItem {
    const { createdAt: storedAt, ...movement } = readCashMovement(row.payload);
    const createdAt = storedAt ?? row.created_at;
    return {
      id: row.id,
      day: row.day ?? argentinaDay(createdAt) ?? '',
      createdAt,
      branch: row.branch,
      pointOfSale: row.point_of_sale,
      ...movement,
    };
  }

  private paymentsWhere(filter: PaymentsFilter): Where {
    const where = rangeAndRegister('cp', filter);
    if (filter.method !== undefined) addMethod(where, 'cp', filter.method);
    if (filter.customerId !== undefined) {
      where.clauses.push('cp.customer_id = ?');
      where.params.push(filter.customerId);
    }
    const voided = 'EXISTS (SELECT 1 FROM customer_payments v WHERE v.voids_payment_id = cp.id)';
    if (filter.status === 'voided') where.clauses.push(voided);
    if (filter.status === 'valid') where.clauses.push(`cp.voids_payment_id IS NULL AND NOT ${voided}`);
    return where;
  }

  private movementsWhere(filter: MovementsFilter): Where {
    const where = rangeAndRegister('m', filter);
    if (filter.direction !== undefined) {
      where.clauses.push(`json_extract(${safePayload('m')}, '$.direction') = ?`);
      where.params.push(filter.direction);
    }
    if (filter.source !== undefined) {
      where.clauses.push(`json_extract(${safePayload('m')}, '$.source') = ?`);
      where.params.push(filter.source);
    }
    return where;
  }

  private salesWhere(filter: SalesFilter): Where {
    const where = rangeAndRegister('s', filter);
    if (filter.method !== undefined) addMethod(where, 's', filter.method);
    if (filter.customerId !== undefined) {
      where.clauses.push('s.customer_id = ?');
      where.params.push(filter.customerId);
    }
    if (filter.productId !== undefined) {
      where.clauses.push(
        `EXISTS (SELECT 1 FROM json_each(${safePayload('s')}, '$.lines') l
          WHERE json_extract(l.value, '$.kind') = 'product' AND json_extract(l.value, '$.productId') = ?)`,
      );
      where.params.push(filter.productId);
    }
    if (filter.kind === 'void') where.clauses.push('s.voids_sale_id IS NOT NULL');
    if (filter.kind === 'return') where.clauses.push('s.voids_sale_id IS NULL AND s.total < 0');
    if (filter.kind === 'sale') where.clauses.push('s.voids_sale_id IS NULL AND s.total >= 0');
    const voided = 'EXISTS (SELECT 1 FROM sales v WHERE v.voids_sale_id = s.id)';
    if (filter.status === 'voided') where.clauses.push(voided);
    if (filter.status === 'valid') where.clauses.push(`s.voids_sale_id IS NULL AND NOT ${voided}`);
    return where;
  }

  private productNames(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map();
    const rows = this.db
      .prepare(`SELECT id, name FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids) as unknown as { id: string; name: string }[];
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
