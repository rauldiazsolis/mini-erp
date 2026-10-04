import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type LedgerMovement = {
  type: 'sale' | 'payment' | 'payment-void' | 'adjustment' | 'interest' | 'opening';
  /** Positivo sube la deuda, negativo la baja. */
  delta: number;
  description: string;
  saleId?: string | undefined;
};

/**
 * Mueve el saldo de un cliente y escribe el extracto (cuenta corriente). Devuelve `false` si el
 * cliente no existe, sin tocar nada: el que llama decide qué hacer (#2, discrepancias).
 */
export function applyToBalance(db: DatabaseSync, customerId: string, movement: LedgerMovement, now: string): boolean {
  const row = db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId) as { balance: number | null } | undefined;
  if (row === undefined) {
    return false;
  }
  const balance = Math.round(((row.balance ?? 0) + movement.delta) * 100) / 100;
  db.prepare('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?').run(balance, now, customerId);
  db.prepare(
    `INSERT INTO account_movements (id, customer_id, type, amount, balance_after, description, sale_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`mov_${randomUUID()}`, customerId, movement.type, movement.delta, balance, movement.description, movement.saleId ?? null, now);
  return true;
}
