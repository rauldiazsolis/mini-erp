import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type WriteStockInput = {
  productId: string;
  branchId: string;
  type: 'set' | 'delta';
  quantity: number;
  reason: string;
  notes?: string | undefined;
  now: string;
};

export type WriteStockResult = { previousQuantity: number; delta: number; newQuantity: number; movementId: string };

/**
 * Fija o suma el stock de un producto en una sucursal, con su movimiento de kardex, y toca el
 * producto para que el POS lo reciba en el pull. No valida que existan: lo hace quien llama.
 */
export function writeStock(db: DatabaseSync, p: WriteStockInput): WriteStockResult {
  const row = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND branch_id = ?').get(p.productId, p.branchId) as
    | { quantity: number }
    | undefined;
  const previousQuantity = row?.quantity ?? 0;
  const newQuantity = p.type === 'set' ? p.quantity : previousQuantity + p.quantity;
  const delta = newQuantity - previousQuantity;
  const movementId = `mov_${randomUUID()}`;

  db.prepare(
    `INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, notes, sale_id, device_id, branch, point_of_sale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
  ).run(movementId, p.productId, p.branchId, delta, p.reason, p.notes ?? null, p.now);
  db.prepare(
    `INSERT INTO stock (product_id, branch_id, quantity, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
  ).run(p.productId, p.branchId, newQuantity, p.now);
  db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(p.now, p.productId);

  return { previousQuantity, delta, newQuantity, movementId };
}
