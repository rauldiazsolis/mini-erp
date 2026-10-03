import type { DatabaseSync } from 'node:sqlite';
import { pickDay } from '../../shared/argentina-day.ts';

/**
 * Escritura de ventas, cobranzas y movimientos de caja (#20): el payload completo y las columnas
 * derivadas (día argentino, cliente y números) en un solo lugar. Lo usan el push, la cobranza del
 * admin y la semilla. La migración v5 aplica las mismas reglas en SQL.
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

/**
 * `receivedAt` es el `created_at` de la fila: el `createdAt` del evento o, sin él, el momento del push.
 * Devuelve el día de la venta (el que se cobra, #21). Reenviarla no le cambia la caja ni el equipo cobrado.
 */
export function saveSale(db: DatabaseSync, sale: SaleRecord, origin: DocumentOrigin, receivedAt: string): string | null {
  const day = pickDay(sale.ticket?.date, [sale.createdAt, receivedAt]);
  db.prepare(
    `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at, day, customer_id, ticket_date, ticket_number, register_id, charge_device)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       day = excluded.day,
       customer_id = excluded.customer_id,
       ticket_date = excluded.ticket_date,
       ticket_number = excluded.ticket_number,
       register_id = COALESCE(sales.register_id, excluded.register_id),
       charge_device = COALESCE(sales.charge_device, excluded.charge_device)`,
  ).run(
    sale.id,
    JSON.stringify(sale),
    origin.deviceId,
    origin.branch,
    origin.pointOfSale,
    sale.total,
    sale.voidsSaleId ?? null,
    receivedAt,
    day,
    sale.customerId ?? null,
    sale.ticket?.date ?? null,
    sale.ticket?.number ?? null,
    origin.registerId ?? null,
    origin.chargeDevice ?? null,
  );
  return day;
}

/** Una cobranza nunca se reescribe: devuelve `false` si ya estaba. */
export function saveCustomerPayment(
  db: DatabaseSync,
  payment: CustomerPaymentRecord,
  origin: DocumentOrigin,
  receivedAt: string,
): boolean {
  const result = db
    .prepare(
      `INSERT INTO customer_payments (id, customer_id, payload, device_id, branch, point_of_sale, voids_payment_id, created_at, day, receipt_date, receipt_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(
      payment.id,
      payment.customerId,
      JSON.stringify(payment),
      origin.deviceId,
      origin.branch,
      origin.pointOfSale,
      payment.voidsPaymentId ?? null,
      receivedAt,
      pickDay(payment.receipt?.date, [payment.createdAt, receivedAt]),
      payment.receipt?.date ?? null,
      payment.receipt?.number ?? null,
    );
  return result.changes > 0;
}

export function saveCashMovement(
  db: DatabaseSync,
  movement: CashMovementRecord,
  origin: DocumentOrigin,
  receivedAt: string,
): void {
  db.prepare(
    `INSERT INTO cash_movements (id, payload, device_id, branch, point_of_sale, created_at, day)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, day = excluded.day`,
  ).run(
    movement.id,
    JSON.stringify(movement),
    origin.deviceId,
    origin.branch,
    origin.pointOfSale,
    receivedAt,
    pickDay(undefined, [movement.createdAt, receivedAt]),
  );
}
