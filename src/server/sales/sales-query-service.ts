import { sql, type Expression, type Kysely, type RawBuilder, type SelectQueryBuilder, type SqlBool } from 'kysely';
import { argentinaDay, daysBetween, isRealDay } from '../../shared/argentina-day.ts';
import { PAYMENT_METHODS } from '../../shared/payment-methods.ts';
import type {
  CashMovementItem, CashSummaryResult, CashSummaryRow, CashSummaryTotals, CustomerPaymentItem, DayEntry, DaySummary,
  DaySummaryResult, DocStatus, ListResult, RegisterItem, SaleDetail, SaleDetailLine, SaleKind, SaleListItem,
} from '../../shared/sales-types.ts';
import { lineTotal, roundAmount } from '../dashboard/sale-lines.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { DomainError } from '../errors.ts';
import { calculateDaySummary, type SummaryCollection, type SummaryMovement, type SummarySale } from './day-summary.ts';
import { readCashMovement, readCustomerPayment, readSale } from './stored-documents.ts';

export type RegisterFilter = { branch?: string | undefined; pointOfSale?: string | undefined };
export type DayRange = { from: string; to: string };
/** `after` (#87): el cursor de la última fila del tramo anterior; con él, `page` no cuenta. */
export type Paging = { page: number; pageSize: number; after?: string | undefined };
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

type Cond = Expression<SqlBool>;

type SaleRow = {
  id: string;
  payload: unknown;
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
  payload: unknown;
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

type MovementRow = { id: string; payload: unknown; branch: string | null; point_of_sale: string | null; created_at: string; day: string | null };

/** Una columna de la tabla con ese alias (`s.day`). */
const col = (alias: string, column: string): RawBuilder<unknown> => sql.ref(`${alias}.${column}`);

/** Un número del payload; si falta o no es un número, 0: un payload raro nunca tira un error de conversión. */
function payloadNumber(alias: string, key: string): RawBuilder<number> {
  const value = sql`${col(alias, 'payload')} -> ${sql.lit(key)}`;
  return sql<number>`CASE WHEN jsonb_typeof(${value}) = 'number' THEN (${value})::numeric ELSE 0 END`;
}

/** El importe con signo de un movimiento de caja: ingreso suma, egreso resta. */
function signedAmount(alias: string): RawBuilder<number> {
  const amount = payloadNumber(alias, 'amount');
  return sql<number>`CASE ${col(alias, 'payload')} ->> 'direction' WHEN 'in' THEN ${amount} WHEN 'out' THEN -${amount} ELSE 0 END`;
}

type Documents = { sales: SaleRow[]; payments: PaymentRow[]; movements: MovementRow[] };

function emptyTotals(): CashSummaryTotals {
  return { totalSold: 0, ticketCount: 0, voidedCount: 0, collectionsTotal: 0, cashIncome: 0, cashExpense: 0, cashCountAdjustments: 0, cashNet: 0 };
}

function addTotals(a: CashSummaryTotals, b: CashSummaryTotals): CashSummaryTotals {
  return {
    totalSold: roundAmount(a.totalSold + b.totalSold),
    ticketCount: a.ticketCount + b.ticketCount,
    voidedCount: a.voidedCount + b.voidedCount,
    collectionsTotal: roundAmount(a.collectionsTotal + b.collectionsTotal),
    cashIncome: roundAmount(a.cashIncome + b.cashIncome),
    cashExpense: roundAmount(a.cashExpense + b.cashExpense),
    cashCountAdjustments: roundAmount(a.cashCountAdjustments + b.cashCountAdjustments),
    cashNet: roundAmount(a.cashNet + b.cashNet),
  };
}

/** Orden de las filas: día descendente; dentro del día, la caja ascendente (sin dato primero). */
function compareRows(a: CashSummaryRow, b: CashSummaryRow): number {
  return (
    b.day.localeCompare(a.day) ||
    (a.branch ?? '').localeCompare(b.branch ?? '') ||
    (a.pointOfSale ?? '').localeCompare(b.pointOfSale ?? '')
  );
}

type CursorRow = { day: string | null; created_at: string; id: string };

/** El cursor de una fila: su lugar en el orden de las listas (día, `created_at` e id, de mayor a menor). */
function encodeCursor(row: CursorRow): string {
  return Buffer.from(JSON.stringify([row.day, row.created_at, row.id])).toString('base64url');
}

function decodeCursor(cursor: string): [string, string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const parts: unknown[] = Array.isArray(value) ? value : [];
    if (parts.length === 3) {
      const [day, createdAt, id] = parts;
      // Un día que existe y un instante legible: lo que PostgreSQL puede comparar con `date` y `timestamptz`
      if (isRealDay(day) && typeof createdAt === 'string' && !Number.isNaN(Date.parse(createdAt)) && typeof id === 'string') {
        return [day, new Date(createdAt).toISOString(), id];
      }
    }
  } catch {
    // cae al error de abajo
  }
  throw new DomainError(400, 'El cursor de la lista no es válido');
}

/**
 * El orden de las listas (día, `created_at` e id, de mayor a menor: total y estable) y un tramo: con
 * cursor, las filas que siguen a esa (no se corre si entra una venta nueva, #87); sin él, la página.
 * Pide una fila de más para saber si hay otro tramo. Sin `paging`, todas.
 */
function paged<DB, TB extends keyof DB, O>(query: SelectQueryBuilder<DB, TB, O>, alias: string, paging: Paging | undefined): SelectQueryBuilder<DB, TB, O> {
  const ordered = query.orderBy(col(alias, 'day'), 'desc').orderBy(col(alias, 'created_at'), 'desc').orderBy(col(alias, 'id'), 'desc');
  if (paging === undefined) return ordered;
  if (paging.after !== undefined) {
    const [day, createdAt, id] = decodeCursor(paging.after);
    return ordered
      .where(sql<SqlBool>`(${col(alias, 'day')}, ${col(alias, 'created_at')}, ${col(alias, 'id')}) < (${day}::date, ${createdAt}::timestamptz, ${id}::text)`)
      .limit(paging.pageSize + 1);
  }
  return ordered.limit(paging.pageSize + 1).offset((paging.page - 1) * paging.pageSize);
}

/** Separa la fila de más que pidió `paged` y arma el cursor del tramo siguiente. */
function cut<T extends CursorRow>(rows: T[], pageSize: number): { rows: T[]; nextCursor: string | null } {
  const last = rows[pageSize - 1];
  return rows.length > pageSize && last !== undefined ? { rows: rows.slice(0, pageSize), nextCursor: encodeCursor(last) } : { rows, nextCursor: null };
}

/** Rango de días y caja. Un `branch` o `pointOfSale` vacío filtra los que no tienen. */
function rangeAndRegister(alias: string, filter: DayRange & RegisterFilter): Cond[] {
  const conds: Cond[] = [sql<SqlBool>`${col(alias, 'day')} BETWEEN ${filter.from}::date AND ${filter.to}::date`];
  const columns: Array<[string, string | undefined]> = [['branch', filter.branch], ['point_of_sale', filter.pointOfSale]];
  for (const [column, value] of columns) {
    if (value === undefined) continue;
    const ref = col(alias, column);
    conds.push(value === '' ? sql<SqlBool>`(${ref} IS NULL OR ${ref} = '')` : sql<SqlBool>`${ref} = ${value}::text`);
  }
  return conds;
}

/** Algún pago con ese medio; `other` es cualquiera fuera del contrato. */
function hasMethod(alias: string, method: string): Cond {
  const payments = sql`${col(alias, 'payload')} -> 'payments'`;
  // `jsonb_array_elements` tira un error con lo que no es un array: un payload raro no tiene pagos
  const list = sql`CASE WHEN jsonb_typeof(${payments}) = 'array' THEN ${payments} ELSE '[]'::jsonb END`;
  const condition = method === 'other'
    ? sql`p.value ->> 'method' NOT IN (${sql.join(PAYMENT_METHODS.map((known) => sql.lit(known)))})`
    : sql`p.value -> 'method' = to_jsonb(${method}::text)`;
  return sql<SqlBool>`EXISTS (SELECT 1 FROM jsonb_array_elements(${list}) AS p(value) WHERE ${condition})`;
}

/** Alguna línea de ese producto. */
function hasProduct(alias: string, productId: string): Cond {
  const lines = sql`${col(alias, 'payload')} -> 'lines'`;
  const list = sql`CASE WHEN jsonb_typeof(${lines}) = 'array' THEN ${lines} ELSE '[]'::jsonb END`;
  return sql<SqlBool>`EXISTS (SELECT 1 FROM jsonb_array_elements(${list}) AS l(value)
    WHERE l.value ->> 'kind' = 'product' AND l.value -> 'productId' = to_jsonb(${productId}::text))`;
}

/** Valida el rango: hasta 366 días, `from` no posterior a `to`. */
function assertRange(range: DayRange): void {
  if (!isRealDay(range.from) || !isRealDay(range.to)) {
    throw new DomainError(400, 'La fecha tiene que ser AAAA-MM-DD');
  }
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

/**
 * Consultas de Ventas & Caja (#20), de un comercio. Los tres roles las ven. La caja es siempre un
 * filtro, así la vista "mi caja" del portal (M10) llama a los mismos métodos con la caja fija.
 */
export class SalesQueryService {
  private db: Kysely<TenantDatabase>;

  constructor(db: Kysely<TenantDatabase>) {
    this.db = db;
  }

  async registers(): Promise<RegisterItem[]> {
    // Sin dato primero, como las ordenaba SQLite (PostgreSQL pone los NULL al final)
    const rows = await this.db
      .selectFrom('sales')
      .select(['branch', 'point_of_sale'])
      .union(this.db.selectFrom('customer_payments').select(['branch', 'point_of_sale']))
      .union(this.db.selectFrom('cash_movements').select(['branch', 'point_of_sale']))
      .orderBy('branch', (ob) => ob.asc().nullsFirst())
      .orderBy('point_of_sale', (ob) => ob.asc().nullsFirst())
      .execute();
    return rows.map((r) => ({ branch: r.branch, pointOfSale: r.point_of_sale }));
  }

  async listSales(filter: SalesFilter, paging: Paging): Promise<ListResult<SaleListItem>> {
    assertRange(filter);
    const totals = await this.db
      .selectFrom('sales as s')
      .where((eb) => eb.and(this.salesWhere(filter)))
      .select((eb) => [eb.fn.countAll<number>().as('count'), eb.fn.coalesce(eb.fn.sum<number>('s.total'), sql.lit(0)).as('net')])
      .executeTakeFirstOrThrow();
    const { rows, nextCursor } = cut(await this.saleRows(filter, paging), paging.pageSize);
    return {
      items: rows.map((row) => this.toSaleItem(row)),
      nextCursor,
      count: totals.count,
      page: paging.page,
      pageSize: paging.pageSize,
      netTotal: roundAmount(totals.net),
    };
  }

  async getSale(id: string): Promise<SaleDetail> {
    const row = await this.salesQuery([sql<SqlBool>`${col('s', 'id')} = ${id}::text`]).executeTakeFirst();
    if (row === undefined) {
      throw new DomainError(404, 'Venta no encontrada');
    }
    const stored = readSale(row.payload);
    const names = await this.productNames(stored.lines.flatMap((l) => (l.kind === 'product' ? [l.productId] : [])));
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

  /** Las ventas que cumplen `conds`, con el cliente y la anulación que las anuló (la primera, si hay más de una). */
  private salesQuery(conds: Cond[]) {
    return this.db
      .selectFrom('sales as s')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .where((eb) => eb.and(conds))
      .select(['s.id', 's.payload', 's.branch', 's.point_of_sale', 's.total', 's.voids_sale_id', 's.created_at', 's.day', 's.customer_id', 'c.name as customer_name'])
      .select((eb) =>
        eb
          .selectFrom('sales as v')
          .select('v.id')
          .whereRef('v.voids_sale_id', '=', 's.id')
          .orderBy('v.created_at')
          .orderBy('v.id')
          .limit(1)
          .as('voided_by'),
      );
  }

  /** Las filas del filtro; sin `paging`, todas (para los resúmenes). */
  protected async saleRows(filter: SalesFilter, paging?: Paging): Promise<SaleRow[]> {
    return paged(this.salesQuery(this.salesWhere(filter)), 's', paging).execute();
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

  async listCustomerPayments(filter: PaymentsFilter, paging: Paging): Promise<ListResult<CustomerPaymentItem>> {
    assertRange(filter);
    const totals = await this.db
      .selectFrom('customer_payments as cp')
      .where((eb) => eb.and(this.paymentsWhere(filter)))
      .select((eb) => [eb.fn.countAll<number>().as('count'), eb.fn.coalesce(eb.fn.sum<number>(payloadNumber('cp', 'total')), sql.lit(0)).as('net')])
      .executeTakeFirstOrThrow();
    const { rows, nextCursor } = cut(await this.paymentRows(filter, paging), paging.pageSize);
    return {
      items: rows.map((row) => this.toPaymentItem(row)),
      nextCursor,
      count: totals.count,
      page: paging.page,
      pageSize: paging.pageSize,
      netTotal: roundAmount(totals.net),
    };
  }

  async listCashMovements(filter: MovementsFilter, paging: Paging): Promise<ListResult<CashMovementItem>> {
    assertRange(filter);
    const totals = await this.db
      .selectFrom('cash_movements as m')
      .where((eb) => eb.and(this.movementsWhere(filter)))
      .select((eb) => [eb.fn.countAll<number>().as('count'), eb.fn.coalesce(eb.fn.sum<number>(signedAmount('m')), sql.lit(0)).as('net')])
      .executeTakeFirstOrThrow();
    const { rows, nextCursor } = cut(await this.movementRows(filter, paging), paging.pageSize);
    return {
      items: rows.map((row) => this.toMovementItem(row)),
      nextCursor,
      count: totals.count,
      page: paging.page,
      pageSize: paging.pageSize,
      netTotal: roundAmount(totals.net),
    };
  }

  /** Una fila por día y caja, con los números del `/RESUMEN` de esa caja ese día, y los totales. */
  async cashSummary(filter: DayRange & RegisterFilter): Promise<CashSummaryResult> {
    assertRange(filter);
    const docs = await this.documents(filter);
    type Group = { day: string; branch: string | null; pointOfSale: string | null } & Documents;
    const groups = new Map<string, Group>();
    const groupOf = (day: string | null, branch: string | null, pointOfSale: string | null): Group => {
      const key = JSON.stringify([day, branch, pointOfSale]);
      const existing = groups.get(key);
      if (existing !== undefined) return existing;
      const fresh: Group = { day: day ?? '', branch, pointOfSale, sales: [], payments: [], movements: [] };
      groups.set(key, fresh);
      return fresh;
    };
    for (const row of docs.sales) groupOf(row.day, row.branch, row.point_of_sale).sales.push(row);
    for (const row of docs.payments) groupOf(row.day, row.branch, row.point_of_sale).payments.push(row);
    for (const row of docs.movements) groupOf(row.day, row.branch, row.point_of_sale).movements.push(row);

    const rows = [...groups.values()]
      .map((group): CashSummaryRow => ({ day: group.day, branch: group.branch, pointOfSale: group.pointOfSale, ...this.rowTotals(group) }))
      .sort(compareRows);
    const totals = rows.reduce<CashSummaryTotals>((sum, row) => addTotals(sum, row), emptyTotals());
    return { rows, totals };
  }

  /** El `/RESUMEN` de un día (de una caja, si se filtra) y sus movimientos, lo más nuevo primero. */
  async daySummary(filter: { day: string } & RegisterFilter): Promise<DaySummaryResult> {
    const range = { from: filter.day, to: filter.day, branch: filter.branch, pointOfSale: filter.pointOfSale };
    assertRange(range);
    const docs = await this.documents(range);
    const entries: DayEntry[] = [
      ...docs.sales.map((row): DayEntry => {
        const sale = this.toSaleItem(row);
        return { kind: 'sale', at: sale.createdAt, sale };
      }),
      ...docs.movements.map((row): DayEntry => {
        const movement = this.toMovementItem(row);
        return { kind: 'movement', at: movement.createdAt, movement };
      }),
      ...docs.payments.map((row): DayEntry => {
        const payment = this.toPaymentItem(row);
        return { kind: 'collection', at: payment.createdAt, payment };
      }),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return { day: filter.day, summary: this.summaryOf(docs), entries };
  }

  private async documents(filter: DayRange & RegisterFilter): Promise<Documents> {
    return { sales: await this.saleRows(filter), payments: await this.paymentRows(filter), movements: await this.movementRows(filter) };
  }

  private summaryOf(docs: Documents): DaySummary {
    const sales: SummarySale[] = docs.sales.map((row) => {
      const stored = readSale(row.payload);
      return { id: row.id, total: row.total, lines: stored.lines, payments: stored.payments };
    });
    const movements: SummaryMovement[] = docs.movements.map((row) => {
      const stored = readCashMovement(row.payload);
      return { direction: stored.direction, amount: stored.amount, source: stored.source };
    });
    const collections: SummaryCollection[] = docs.payments.map((row) => ({
      id: row.id,
      total: row.total,
      payments: readCustomerPayment(row.payload).payments,
    }));
    // La anulación se busca en toda la tabla: una venta anulada otro día cuenta como anulada en el suyo
    return calculateDaySummary({
      sales,
      movements,
      collections,
      voidedSaleIds: new Set(docs.sales.flatMap((row) => (row.voided_by === null ? [] : [row.id]))),
      voidedPaymentIds: new Set(docs.payments.flatMap((row) => (row.voided_by === null ? [] : [row.id]))),
    });
  }

  private rowTotals(docs: Documents): CashSummaryTotals {
    const s = this.summaryOf(docs);
    return {
      totalSold: s.totalSold,
      ticketCount: s.ticketCount,
      voidedCount: s.voidedCount,
      collectionsTotal: s.collections.total,
      cashIncome: s.cash.income,
      cashExpense: s.cash.expense,
      cashCountAdjustments: s.cash.countAdjustments,
      cashNet: roundAmount(s.cash.sales + s.cash.income - s.cash.expense + s.cash.countAdjustments + s.cash.collections),
    };
  }

  protected async paymentRows(filter: PaymentsFilter, paging?: Paging): Promise<PaymentRow[]> {
    const query = this.db
      .selectFrom('customer_payments as cp')
      .leftJoin('customers as c', 'c.id', 'cp.customer_id')
      .where((eb) => eb.and(this.paymentsWhere(filter)))
      .select(['cp.id', 'cp.payload', 'cp.branch', 'cp.point_of_sale', 'cp.customer_id', 'c.name as customer_name', 'cp.voids_payment_id', 'cp.created_at', 'cp.day'])
      .select(payloadNumber('cp', 'total').as('total'))
      .select((eb) =>
        eb
          .selectFrom('customer_payments as v')
          .select('v.id')
          .whereRef('v.voids_payment_id', '=', 'cp.id')
          .orderBy('v.created_at')
          .orderBy('v.id')
          .limit(1)
          .as('voided_by'),
      );
    return paged(query, 'cp', paging).execute();
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

  protected async movementRows(filter: MovementsFilter, paging?: Paging): Promise<MovementRow[]> {
    const query = this.db
      .selectFrom('cash_movements as m')
      .where((eb) => eb.and(this.movementsWhere(filter)))
      .select(['m.id', 'm.payload', 'm.branch', 'm.point_of_sale', 'm.created_at', 'm.day']);
    return paged(query, 'm', paging).execute();
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

  /** Si otra cobranza la anula. */
  private paymentVoided(): Cond {
    return sql<SqlBool>`EXISTS ${this.db.selectFrom('customer_payments as v').select(sql.lit(1).as('one')).where(sql<SqlBool>`${col('v', 'voids_payment_id')} = ${col('cp', 'id')}`)}`;
  }

  private paymentsWhere(filter: PaymentsFilter): Cond[] {
    const conds = rangeAndRegister('cp', filter);
    if (filter.method !== undefined) conds.push(hasMethod('cp', filter.method));
    if (filter.customerId !== undefined) conds.push(sql<SqlBool>`${col('cp', 'customer_id')} = ${filter.customerId}::text`);
    if (filter.status === 'voided') conds.push(this.paymentVoided());
    if (filter.status === 'valid') conds.push(sql<SqlBool>`(${col('cp', 'voids_payment_id')} IS NULL AND NOT ${this.paymentVoided()})`);
    return conds;
  }

  private movementsWhere(filter: MovementsFilter): Cond[] {
    const conds = rangeAndRegister('m', filter);
    if (filter.direction !== undefined) conds.push(sql<SqlBool>`${col('m', 'payload')} ->> 'direction' = ${filter.direction}::text`);
    if (filter.source !== undefined) conds.push(sql<SqlBool>`${col('m', 'payload')} ->> 'source' = ${filter.source}::text`);
    return conds;
  }

  /** Si otra venta la anula. */
  private saleVoided(): Cond {
    return sql<SqlBool>`EXISTS ${this.db.selectFrom('sales as v').select(sql.lit(1).as('one')).where(sql<SqlBool>`${col('v', 'voids_sale_id')} = ${col('s', 'id')}`)}`;
  }

  private salesWhere(filter: SalesFilter): Cond[] {
    const conds = rangeAndRegister('s', filter);
    if (filter.method !== undefined) conds.push(hasMethod('s', filter.method));
    if (filter.customerId !== undefined) conds.push(sql<SqlBool>`${col('s', 'customer_id')} = ${filter.customerId}::text`);
    if (filter.productId !== undefined) conds.push(hasProduct('s', filter.productId));
    if (filter.kind === 'void') conds.push(sql<SqlBool>`${col('s', 'voids_sale_id')} IS NOT NULL`);
    if (filter.kind === 'return') conds.push(sql<SqlBool>`(${col('s', 'voids_sale_id')} IS NULL AND ${col('s', 'total')} < 0)`);
    if (filter.kind === 'sale') conds.push(sql<SqlBool>`(${col('s', 'voids_sale_id')} IS NULL AND ${col('s', 'total')} >= 0)`);
    if (filter.status === 'voided') conds.push(this.saleVoided());
    if (filter.status === 'valid') conds.push(sql<SqlBool>`(${col('s', 'voids_sale_id')} IS NULL AND NOT ${this.saleVoided()})`);
    return conds;
  }

  private async productNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.selectFrom('products').select(['id', 'name']).where('id', 'in', ids).execute();
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
