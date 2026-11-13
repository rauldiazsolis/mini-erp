import type { Insertable, Kysely } from 'kysely';
import { jsonValue } from '../db/pg/sql-helpers.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import type { SeedProduct } from './types.ts';
import { KIOSCO_PRODUCTS } from './kiosco.ts';
import { ALMACEN_PRODUCTS } from './almacen.ts';
import { FERRETERIA_PRODUCTS } from './ferreteria.ts';
import { insertDemoCustomers } from './demo-customers.ts';
import { generateHistoricalDemoActivity } from './demo-activity-generator.ts';
import type { DemoTemplate } from './index.ts';

/** Los comercios demo de M8 (#24): uno fijo por rubro, compartido por los visitantes. */
export const DEMO_COMMERCES: Record<DemoTemplate, { tenantId: string; name: string }> = {
  kiosco: { tenantId: 'demo-kiosco', name: 'Kiosco Demo' },
  almacen: { tenantId: 'demo-almacen', name: 'Almacén Demo' },
  ferreteria: { tenantId: 'demo-ferreteria', name: 'Ferretería Demo' },
};

export const DEMO_BRANCH_ID = 'branch-central';
export const DEMO_BRANCH_CODE = 'CENTRAL';
export const DEMO_HISTORY_DAYS = 30;

const PRESET_PRODUCTS: Record<DemoTemplate, SeedProduct[]> = {
  kiosco: KIOSCO_PRODUCTS,
  almacen: ALMACEN_PRODUCTS,
  ferreteria: FERRETERIA_PRODUCTS,
};

/** El id de un producto de la semilla: el reinicio parcial los reconoce así. */
export function demoProductId(sku: string): string {
  return `demo_${sku}`;
}

export function demoSeedProducts(template: DemoTemplate): (SeedProduct & { id: string })[] {
  return PRESET_PRODUCTS[template].map((p) => ({ ...p, id: demoProductId(p.sku) }));
}

/**
 * Siembra un comercio demo vacío (#24): sucursal, catálogo del rubro con ids deterministas, clientes
 * demo y `DEMO_HISTORY_DAYS` días de historial hasta `now` de dos cajas de la casa (sin caja de mini:
 * no cobran). Es la "foto inicial" del reinicio total. Por lotes y en una transacción: la de quien
 * llama si `db` ya es una (el reinicio total), o una nueva.
 */
export async function seedDemoCommerce(db: Kysely<TenantDatabase>, template: DemoTemplate, now: Date): Promise<void> {
  if (!db.isTransaction) {
    await db.transaction().execute(async (trx) => {
      await seedDemoCommerce(trx, template, now);
    });
    return;
  }
  const at = now.toISOString();
  await db
    .insertInto('branches')
    .values({ id: DEMO_BRANCH_ID, name: 'Sucursal Central', code: DEMO_BRANCH_CODE, created_at: at })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const products = demoSeedProducts(template);
  await db.insertInto('products').values(products.map((p) => demoProductRow(p, at))).execute();
  await db
    .insertInto('stock')
    .values(products.map((p) => ({ product_id: p.id, branch_id: DEMO_BRANCH_ID, quantity: p.stock, updated_at: at })))
    .execute();
  await insertDemoCustomers(db, at);
  for (const [index, pointOfSale] of ['Caja 1', 'Caja 2'].entries()) {
    await generateHistoricalDemoActivity(db, DEMO_BRANCH_ID, now, {
      days: DEMO_HISTORY_DAYS,
      idPrefix: index === 0 ? '' : `c${String(index + 1)}_`,
      origin: { deviceId: `pos_casa_${String(index + 1)}`, branch: DEMO_BRANCH_CODE, pointOfSale },
    });
  }
}

/** La fila de un producto de la semilla, como nace y como lo deja el reinicio parcial. */
export function demoProductRow(p: SeedProduct & { id: string }, at: string): Insertable<TenantDatabase['products']> {
  return {
    id: p.id,
    sku: p.sku,
    barcodes: jsonValue(p.barcodes),
    name: p.name,
    price: p.price,
    tax_rate: p.taxRate ?? 0.21,
    category: p.category,
    tracks_stock: true,
    blocked_reason: null,
    created_at: at,
    updated_at: at,
  };
}
