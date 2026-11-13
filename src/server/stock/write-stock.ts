import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { inChunks } from '../db/pg/sql-helpers.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';

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

/** Una cantidad con los 4 decimales de `numeric(14,4)`: saca el ruido de coma flotante de una resta. */
export function roundQuantity(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Fija o suma el stock de un producto en una sucursal, con su movimiento de kardex, y toca el
 * producto para que el POS lo reciba en el pull. No valida que existan: lo hace quien llama (la
 * sucursal tiene FK; el producto, no).
 *
 * Todo en una transacción: la propia de quien llama si `db` ya es una (el push, la importación, el
 * reinicio de una demo) o una nueva. La fila de stock queda bloqueada desde que se lee el valor
 * anterior y la suma se hace en SQL: dos ajustes a la vez no se pisan y el kardex cuadra.
 */
export async function writeStock(db: Kysely<TenantDatabase>, p: WriteStockInput): Promise<WriteStockResult> {
  if (!db.isTransaction) {
    return await db.transaction().execute(async (trx) => await writeStock(trx, p));
  }

  // La fila tiene que existir para poder bloquearla
  await db
    .insertInto('stock')
    .values({ product_id: p.productId, branch_id: p.branchId, quantity: 0, updated_at: p.now })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const previous = await db
    .selectFrom('stock')
    .select('quantity')
    .where('product_id', '=', p.productId)
    .where('branch_id', '=', p.branchId)
    .forUpdate()
    .executeTakeFirstOrThrow();

  // La columna redondea a 4 decimales: lo que vale es lo que devuelve la base
  const updated = await db
    .updateTable('stock')
    .set((eb) => ({
      quantity: p.type === 'set' ? p.quantity : eb('stock.quantity', '+', p.quantity),
      updated_at: p.now,
    }))
    .where('product_id', '=', p.productId)
    .where('branch_id', '=', p.branchId)
    .returning('quantity')
    .executeTakeFirstOrThrow();

  const previousQuantity = previous.quantity;
  const newQuantity = updated.quantity;
  const delta = roundQuantity(newQuantity - previousQuantity);
  const movementId = `mov_${randomUUID()}`;

  await db
    .insertInto('stock_movements')
    .values({
      id: movementId,
      product_id: p.productId,
      branch_id: p.branchId,
      delta,
      reason: p.reason,
      notes: p.notes ?? null,
      created_at: p.now,
    })
    .execute();
  await db.updateTable('products').set({ updated_at: p.now }).where('id', '=', p.productId).execute();

  return { previousQuantity, delta, newQuantity, movementId };
}

export type SetStockManyInput = {
  branchId: string;
  items: { productId: string; quantity: number }[];
  reason: string;
  notes?: string | undefined;
  now: string;
};

/**
 * Fija el stock de varios productos en una sucursal, de una vez (los reinicios de las demos): lo
 * mismo que un `writeStock` de tipo `set` por producto (la fila bloqueada, un movimiento de kardex
 * por producto aunque no cambie y el producto tocado), en una sentencia por tabla. Los productos no
 * se repiten dentro de la lista.
 */
export async function setStockMany(db: Kysely<TenantDatabase>, p: SetStockManyInput): Promise<void> {
  if (!db.isTransaction) {
    await db.transaction().execute(async (trx) => {
      await setStockMany(trx, p);
    });
    return;
  }
  for (const items of inChunks(p.items)) {
    const productIds = items.map((item) => item.productId);
    await db
      .insertInto('stock')
      .values(productIds.map((id) => ({ product_id: id, branch_id: p.branchId, quantity: 0, updated_at: p.now })))
      .onConflict((oc) => oc.doNothing())
      .execute();
    // En orden, para que dos lotes a la vez no se bloqueen cruzados
    const previous = await db
      .selectFrom('stock')
      .select(['product_id', 'quantity'])
      .where('branch_id', '=', p.branchId)
      .where('product_id', 'in', productIds)
      .orderBy('product_id')
      .forUpdate()
      .execute();
    const before = new Map(previous.map((row) => [row.product_id, row.quantity]));
    // La columna redondea a 4 decimales: lo que vale es lo que devuelve la base
    const updated = await db
      .insertInto('stock')
      .values(items.map((item) => ({ product_id: item.productId, branch_id: p.branchId, quantity: item.quantity, updated_at: p.now })))
      .onConflict((oc) =>
        oc.columns(['product_id', 'branch_id']).doUpdateSet((eb) => ({ quantity: eb.ref('excluded.quantity'), updated_at: eb.ref('excluded.updated_at') })),
      )
      .returning(['product_id', 'quantity'])
      .execute();
    const after = new Map(updated.map((row) => [row.product_id, row.quantity]));
    await db
      .insertInto('stock_movements')
      .values(
        items.map((item) => ({
          id: `mov_${randomUUID()}`,
          product_id: item.productId,
          branch_id: p.branchId,
          delta: roundQuantity((after.get(item.productId) ?? item.quantity) - (before.get(item.productId) ?? 0)),
          reason: p.reason,
          notes: p.notes ?? null,
          created_at: p.now,
        })),
      )
      .execute();
    await db.updateTable('products').set({ updated_at: p.now }).where('id', 'in', productIds).execute();
  }
}
