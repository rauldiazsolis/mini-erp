import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { jsonValue } from '../db/pg/sql-helpers.ts';
import type { BusinessPreset, SeedProduct } from './types.ts';
import { KIOSCO_PRODUCTS } from './kiosco.ts';
import { FERRETERIA_PRODUCTS } from './ferreteria.ts';
import { ALMACEN_PRODUCTS } from './almacen.ts';

export function getPresetProducts(preset: BusinessPreset): SeedProduct[] {
  switch (preset) {
    case 'kiosco':
      return KIOSCO_PRODUCTS;
    case 'ferreteria':
      return FERRETERIA_PRODUCTS;
    case 'almacen':
      return ALMACEN_PRODUCTS;
  }
}

const PRESET_TAX = 0.21;

/**
 * Carga el catálogo de un rubro con su stock en la primera sucursal. Idempotente: un SKU que ya
 * existe se saltea (también si otro pedido lo cargó a la vez). Todo en una transacción: la de
 * quien llama si `db` ya es una, o una nueva.
 */
export async function applyPreset(
  db: Kysely<TenantDatabase>,
  preset: BusinessPreset,
): Promise<{ preset: BusinessPreset; productsCreated: number; stockEntries: number }> {
  if (!db.isTransaction) {
    return await db.transaction().execute(async (trx) => await applyPreset(trx, preset));
  }
  const items = getPresetProducts(preset);
  const now = new Date().toISOString();
  const branch = await db.selectFrom('branches').select('id').orderBy('seq').limit(1).executeTakeFirst();

  let productsCreated = 0;
  let stockEntries = 0;

  for (const item of items) {
    const created = await db
      .insertInto('products')
      .values({
        id: `prod_${randomUUID()}`,
        sku: item.sku,
        barcodes: jsonValue(item.barcodes),
        name: item.name,
        price: item.price,
        tax_rate: PRESET_TAX,
        category: item.category,
        tracks_stock: true,
        blocked_reason: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) => oc.column('sku').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (created === undefined) continue;
    productsCreated++;

    if (branch !== undefined) {
      await db
        .insertInto('stock')
        .values({ product_id: created.id, branch_id: branch.id, quantity: item.stock, updated_at: now })
        .onConflict((oc) => oc.columns(['product_id', 'branch_id']).doUpdateSet({ quantity: item.stock, updated_at: now }))
        .execute();
      stockEntries++;
    }
  }

  return { preset, productsCreated, stockEntries };
}
