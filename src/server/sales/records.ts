import type { Kysely } from 'kysely';
import { isRealDay, pickDay } from '../../shared/argentina-day.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { jsonValue } from '../db/pg/sql-helpers.ts';

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

/**
 * `receivedAt` es el `created_at` de la fila: el `createdAt` del evento o, sin él, el momento del push.
 * Devuelve el día de la venta (el que se cobra, #21). Reenviarla no le cambia la caja ni el equipo cobrado.
 */
export async function saveSale(db: Kysely<TenantDatabase>, sale: SaleRecord, origin: DocumentOrigin, receivedAt: string): Promise<string | null> {
  const ticketDate = numberedDay(sale.ticket);
  const day = pickDay(ticketDate, [sale.createdAt, receivedAt]);
  await db
    .insertInto('sales')
    .values({
      id: sale.id,
      payload: jsonValue(sale),
      device_id: origin.deviceId,
      branch: origin.branch,
      point_of_sale: origin.pointOfSale,
      total: sale.total,
      voids_sale_id: sale.voidsSaleId ?? null,
      created_at: instant(receivedAt),
      day,
      customer_id: sale.customerId ?? null,
      ticket_date: ticketDate,
      ticket_number: numberedNumber(sale.ticket),
      register_id: origin.registerId ?? null,
      charge_device: origin.chargeDevice ?? null,
    })
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
  return day;
}

/** Una cobranza nunca se reescribe: devuelve `false` si ya estaba. */
export async function saveCustomerPayment(
  db: Kysely<TenantDatabase>,
  payment: CustomerPaymentRecord,
  origin: DocumentOrigin,
  receivedAt: string,
): Promise<boolean> {
  const receiptDate = numberedDay(payment.receipt);
  const inserted = await db
    .insertInto('customer_payments')
    .values({
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
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .returning('id')
    .executeTakeFirst();
  return inserted !== undefined;
}

export async function saveCashMovement(
  db: Kysely<TenantDatabase>,
  movement: CashMovementRecord,
  origin: DocumentOrigin,
  receivedAt: string,
): Promise<void> {
  await db
    .insertInto('cash_movements')
    .values({
      id: movement.id,
      payload: jsonValue(movement),
      device_id: origin.deviceId,
      branch: origin.branch,
      point_of_sale: origin.pointOfSale,
      created_at: instant(receivedAt),
      day: pickDay(undefined, [movement.createdAt, receivedAt]),
    })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet((eb) => ({ payload: eb.ref('excluded.payload'), day: eb.ref('excluded.day') })),
    )
    .execute();
}
