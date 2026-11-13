import type { Insertable, Kysely } from 'kysely';
import { isRealDay, pickDay } from '../../shared/argentina-day.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { inChunks, jsonValue } from '../db/pg/sql-helpers.ts';

/**
 * Escritura de ventas, cobranzas y movimientos de caja (#20): el payload completo y las columnas
 * derivadas (día argentino, cliente y números) en un solo lugar. Lo usan el push, la cobranza del
 * admin y la semilla. El `payload` queda como llegó; las
 * columnas redondean (`total`, al centavo).
 */

/**
 * De dónde viene un documento: el equipo y la caja (sucursal + punto de venta del `origin`). El push
 * suma la caja de la key y a qué equipo se cobra la venta (#21: `''` = la caja, si no el equipo
 * ajeno); la cobranza del admin y la semilla no tienen caja.
 */
export type DocumentOrigin = {
  deviceId: string | null;
  branch: string | null;
  pointOfSale: string | null;
  registerId?: string | null | undefined;
  chargeDevice?: string | null | undefined;
};

type Numbered = { date: string; number: number };

export type SaleRecord = {
  id: string;
  total: number;
  customerId?: string | undefined;
  voidsSaleId?: string | undefined;
  ticket?: Numbered | undefined;
  createdAt?: string | undefined;
  [key: string]: unknown;
};

export type CustomerPaymentRecord = {
  id: string;
  customerId: string;
  total: number;
  voidsPaymentId?: string | undefined;
  receipt?: Numbered | undefined;
  createdAt?: string | undefined;
  [key: string]: unknown;
};

export type CashMovementRecord = { id: string; createdAt?: string | undefined; [key: string]: unknown };

/** La fecha numerada de un ticket o un recibo, solo si es un día que existe: es lo que entra en `date`. */
function numberedDay(numbered: Numbered | undefined): string | null {
  return isRealDay(numbered?.date) ? numbered.date : null;
}

/** El número de un ticket o un recibo, solo si es un entero: es lo que entra en `bigint`. */
function numberedNumber(numbered: Numbered | undefined): number | null {
  return Number.isSafeInteger(numbered?.number) ? (numbered?.number ?? null) : null;
}

/** Un instante que llega de afuera, normalizado como lo guarda `timestamptz` (ISO en UTC). */
function instant(iso: string): string {
  return new Date(iso).toISOString();
}

/** Un documento con su caja y el `created_at` de su fila: lo que reciben las escrituras en lote. */
export type Stamped<T> = { record: T; origin: DocumentOrigin; receivedAt: string };

/**
 * La fila de una venta: el payload y sus columnas derivadas. `receivedAt` es el `created_at` de la
 * fila: el `createdAt` del evento o, sin él, el momento del push.
 */
function saleRow(sale: SaleRecord, origin: DocumentOrigin, receivedAt: string): Insertable<TenantDatabase['sales']> {
  const ticketDate = numberedDay(sale.ticket);
  return {
    id: sale.id,
    payload: jsonValue(sale),
    device_id: origin.deviceId,
    branch: origin.branch,
    point_of_sale: origin.pointOfSale,
    total: sale.total,
    voids_sale_id: sale.voidsSaleId ?? null,
    created_at: instant(receivedAt),
    day: pickDay(ticketDate, [sale.createdAt, receivedAt]),
    customer_id: sale.customerId ?? null,
    ticket_date: ticketDate,
    ticket_number: numberedNumber(sale.ticket),
    register_id: origin.registerId ?? null,
    charge_device: origin.chargeDevice ?? null,
  };
}

function customerPaymentRow(
  payment: CustomerPaymentRecord,
  origin: DocumentOrigin,
  receivedAt: string,
): Insertable<TenantDatabase['customer_payments']> {
  const receiptDate = numberedDay(payment.receipt);
  return {
    id: payment.id,
    customer_id: payment.customerId,
    payload: jsonValue(payment),
    device_id: origin.deviceId,
    branch: origin.branch,
    point_of_sale: origin.pointOfSale,
    voids_payment_id: payment.voidsPaymentId ?? null,
    created_at: instant(receivedAt),
    day: pickDay(receiptDate, [payment.createdAt, receivedAt]),
    receipt_date: receiptDate,
    receipt_number: numberedNumber(payment.receipt),
  };
}

function cashMovementRow(movement: CashMovementRecord, origin: DocumentOrigin, receivedAt: string): Insertable<TenantDatabase['cash_movements']> {
  return {
    id: movement.id,
    payload: jsonValue(movement),
    device_id: origin.deviceId,
    branch: origin.branch,
    point_of_sale: origin.pointOfSale,
    created_at: instant(receivedAt),
    day: pickDay(undefined, [movement.createdAt, receivedAt]),
  };
}

/** Reenviar una venta no le cambia la caja ni el equipo cobrado. */
async function upsertSales(db: Kysely<TenantDatabase>, rows: Insertable<TenantDatabase['sales']>[]): Promise<void> {
  await db
    .insertInto('sales')
    .values(rows)
    .onConflict((oc) =>
      oc.column('id').doUpdateSet((eb) => ({
        payload: eb.ref('excluded.payload'),
        day: eb.ref('excluded.day'),
        customer_id: eb.ref('excluded.customer_id'),
        ticket_date: eb.ref('excluded.ticket_date'),
        ticket_number: eb.ref('excluded.ticket_number'),
        register_id: eb.fn.coalesce('sales.register_id', 'excluded.register_id'),
        charge_device: eb.fn.coalesce('sales.charge_device', 'excluded.charge_device'),
      })),
    )
    .execute();
}

/** Devuelve el día de la venta (el que se cobra, #21). */
export async function saveSale(db: Kysely<TenantDatabase>, sale: SaleRecord, origin: DocumentOrigin, receivedAt: string): Promise<string | null> {
  const row = saleRow(sale, origin, receivedAt);
  await upsertSales(db, [row]);
  return row.day ?? null;
}

/**
 * Muchas ventas de una vez (las semillas): las mismas filas que `saveSale`, en inserts de varias
 * filas. Los ids no se repiten dentro de la lista.
 */
export async function saveSales(db: Kysely<TenantDatabase>, sales: Stamped<SaleRecord>[]): Promise<void> {
  for (const chunk of inChunks(sales)) {
    await upsertSales(db, chunk.map((s) => saleRow(s.record, s.origin, s.receivedAt)));
  }
}

/** Una cobranza nunca se reescribe: devuelve `false` si ya estaba. */
export async function saveCustomerPayment(
  db: Kysely<TenantDatabase>,
  payment: CustomerPaymentRecord,
  origin: DocumentOrigin,
  receivedAt: string,
): Promise<boolean> {
  const inserted = await db
    .insertInto('customer_payments')
    .values(customerPaymentRow(payment, origin, receivedAt))
    .onConflict((oc) => oc.column('id').doNothing())
    .returning('id')
    .executeTakeFirst();
  return inserted !== undefined;
}

/** Muchas cobranzas de una vez (las semillas); las que ya estaban no se tocan. */
export async function saveCustomerPayments(db: Kysely<TenantDatabase>, payments: Stamped<CustomerPaymentRecord>[]): Promise<void> {
  for (const chunk of inChunks(payments)) {
    await db
      .insertInto('customer_payments')
      .values(chunk.map((p) => customerPaymentRow(p.record, p.origin, p.receivedAt)))
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }
}

async function upsertCashMovements(db: Kysely<TenantDatabase>, rows: Insertable<TenantDatabase['cash_movements']>[]): Promise<void> {
  await db
    .insertInto('cash_movements')
    .values(rows)
    .onConflict((oc) =>
      oc.column('id').doUpdateSet((eb) => ({ payload: eb.ref('excluded.payload'), day: eb.ref('excluded.day') })),
    )
    .execute();
}

export async function saveCashMovement(
  db: Kysely<TenantDatabase>,
  movement: CashMovementRecord,
  origin: DocumentOrigin,
  receivedAt: string,
): Promise<void> {
  await upsertCashMovements(db, [cashMovementRow(movement, origin, receivedAt)]);
}

/** Muchos movimientos de caja de una vez (las semillas). Los ids no se repiten dentro de la lista. */
export async function saveCashMovements(db: Kysely<TenantDatabase>, movements: Stamped<CashMovementRecord>[]): Promise<void> {
  for (const chunk of inChunks(movements)) {
    await upsertCashMovements(db, chunk.map((m) => cashMovementRow(m.record, m.origin, m.receivedAt)));
  }
}
