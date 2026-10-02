import type { DatabaseSync } from 'node:sqlite';
import { argentinaDay, daysBetween } from '../../shared/argentina-day.ts';
import { PAYMENT_METHODS } from '../../shared/payment-methods.ts';
import type {
  DocStatus, ListResult, RegisterItem, SaleDetail, SaleDetailLine, SaleKind, SaleListItem,
} from '../../shared/sales-types.ts';
import { lineTotal, roundAmount } from '../dashboard/sale-lines.ts';
import { DomainError } from '../errors.ts';
import { readSale } from './stored-documents.ts';

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

/** El payload, o `{}` si no es JSON: así `json_each` nunca tira "malformed JSON". */
export const safePayload = (alias: string): string => `CASE WHEN json_valid(${alias}.payload) THEN ${alias}.payload ELSE '{}' END`;

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
    const limit = paging === undefined ? '' : ' LIMIT ? OFFSET ?';
    const params = paging === undefined ? where.params : [...where.params, paging.pageSize, (paging.page - 1) * paging.pageSize];
    return this.db
      .prepare(
        `SELECT ${SALE_COLUMNS} FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE ${where.clauses.join(' AND ')}
         ORDER BY s.day DESC, s.created_at DESC, s.id DESC${limit}`,
      )
      .all(...params) as unknown as SaleRow[];
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
