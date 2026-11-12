import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';

export type LedgerMovement = {
  type: 'sale' | 'payment' | 'payment-void' | 'adjustment' | 'interest' | 'opening';
  /** Positivo sube la deuda, negativo la baja. */
  delta: number;
  description: string;
  saleId?: string | undefined;
};

export type PostedMovement = {
  movementId: string;
  /** El importe como quedó guardado: redondeado al centavo. */
  amount: number;
  previousBalance: number;
  balanceAfter: number;
};

/** Redondea al centavo, para restar dos importes que ya tienen 2 decimales sin ruido de coma flotante. */
export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Mueve el saldo de un cliente y escribe el extracto (cuenta corriente). Devuelve `undefined` si el
 * cliente no existe, sin tocar nada.
 *
 * La suma se hace en SQL, sobre `numeric` (nunca leer, sumar y escribir en JS): el importe se
 * redondea al centavo, igual que en la columna, y `balance_after` es el saldo que devuelve la base,
 * así el extracto cuadra con la suma de los importes guardados. Todo en una transacción: la de quien
 * llama si `db` ya es una (el push, la importación, el alta de un cliente) o una nueva.
 */
export async function postToBalance(
  db: Kysely<TenantDatabase>,
  customerId: string,
  movement: LedgerMovement,
  now: string,
): Promise<PostedMovement | undefined> {
  if (!db.isTransaction) {
    return await db.transaction().execute(async (trx) => await postToBalance(trx, customerId, movement, now));
  }

  const amount = sql<number>`round(${movement.delta}::numeric, 2)`;
  const updated = await db
    .updateTable('customers')
    .set((eb) => ({
      balance: sql<number>`coalesce(${eb.ref('customers.balance')}, 0) + ${amount}`,
      updated_at: now,
    }))
    .where('id', '=', customerId)
    .returning(['balance', amount.as('amount')])
    .executeTakeFirst();
  if (updated === undefined) {
    return undefined;
  }

  const balanceAfter = updated.balance ?? 0;
  const movementId = `mov_${randomUUID()}`;
  await db
    .insertInto('account_movements')
    .values({
      id: movementId,
      customer_id: customerId,
      type: movement.type,
      amount: updated.amount,
      balance_after: balanceAfter,
      description: movement.description,
      sale_id: movement.saleId ?? null,
      created_at: now,
    })
    .execute();

  return { movementId, amount: updated.amount, previousBalance: roundMoney(balanceAfter - updated.amount), balanceAfter };
}

/**
 * Lo mismo, para quien solo necesita saber si se aplicó: `false` si el cliente no existe, y el que
 * llama decide qué hacer (#2, discrepancias).
 */
export async function applyToBalance(db: Kysely<TenantDatabase>, customerId: string, movement: LedgerMovement, now: string): Promise<boolean> {
  return (await postToBalance(db, customerId, movement, now)) !== undefined;
}
