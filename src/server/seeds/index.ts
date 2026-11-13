import type { Kysely } from 'kysely';
import { jsonValue } from '../db/pg/sql-helpers.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import type { BusinessPreset } from './types.ts';
import { applyPreset } from './apply-preset.ts';
import { insertDemoCustomers } from './demo-customers.ts';
import { generateHistoricalDemoActivity } from './demo-activity-generator.ts';

export * from './types.ts';
export * from './apply-preset.ts';
export * from './kiosco.ts';
export * from './ferreteria.ts';
export * from './almacen.ts';
export * from './demo-customers.ts';
export * from './demo-activity-generator.ts';
export * from './demo-commerce.ts';

const DEMO_TENANT_PRODUCTS = [
  { id: 'prod-coca-500', sku: 'BEB-001', barcodes: ['779123456001'], name: 'Coca Cola 500ml', price: 1500, taxRate: 0.21, category: 'Bebidas', stock: 50 },
  { id: 'prod-agua-500', sku: 'BEB-002', barcodes: ['779123456002'], name: 'Agua Mineral 500ml', price: 1000, taxRate: 0.21, category: 'Bebidas', stock: 80 },
  { id: 'prod-yerba-1k', sku: 'ALM-001', barcodes: ['779123456003'], name: 'Yerba Mate 1kg', price: 3200, taxRate: 0.21, category: 'Almacén', stock: 25 },
  { id: 'prod-galletitas', sku: 'ALM-002', barcodes: ['779123456004'], name: 'Galletitas de Chocolate', price: 1200, taxRate: 0.21, category: 'Almacén', stock: 40 },
];

/**
 * Los datos de ejemplo de un comercio (`seedDemoData`): cuatro productos con su stock, los clientes
 * demo y, salvo que se pida que no, 7 días de historial. En una transacción: la de quien llama si
 * `db` ya es una, o una nueva.
 */
export async function seedDemoTenant(
  db: Kysely<TenantDatabase>,
  defaultBranchId: string,
  options?: { withHistory?: boolean },
): Promise<void> {
  if (!db.isTransaction) {
    await db.transaction().execute(async (trx) => {
      await seedDemoTenant(trx, defaultBranchId, options);
    });
    return;
  }
  const now = new Date().toISOString();

  // 1. Productos iniciales (Preset Kiosco)
  await db
    .insertInto('products')
    .values(
      DEMO_TENANT_PRODUCTS.map((p) => ({
        id: p.id,
        sku: p.sku,
        barcodes: jsonValue(p.barcodes),
        name: p.name,
        price: p.price,
        tax_rate: p.taxRate,
        category: p.category,
        tracks_stock: true,
        created_at: now,
        updated_at: now,
      })),
    )
    .execute();
  await db
    .insertInto('stock')
    .values(DEMO_TENANT_PRODUCTS.map((p) => ({ product_id: p.id, branch_id: defaultBranchId, quantity: p.stock, updated_at: now })))
    .execute();

  // 2. Clientes iniciales
  await insertDemoCustomers(db, now);

  // 3. Generar historial de ventas y movimientos si está habilitado
  if (options?.withHistory ?? true) {
    await generateHistoricalDemoActivity(db, defaultBranchId);
  }
}

/** Templates de `POST /demo-sessions` (#9): son los presets del mini-erp. */
export const DEMO_TEMPLATES = ['kiosco', 'almacen', 'ferreteria'] as const satisfies readonly BusinessPreset[];
export type DemoTemplate = (typeof DEMO_TEMPLATES)[number];
export const DEFAULT_DEMO_TEMPLATE: DemoTemplate = 'kiosco';

export function isDemoTemplate(value: string): value is DemoTemplate {
  return (DEMO_TEMPLATES as readonly string[]).includes(value);
}

/** Datos de una demo: el catálogo del preset y los clientes demo, sin historial (el POS no lo ve). */
export async function seedDemoSession(db: Kysely<TenantDatabase>, template: DemoTemplate): Promise<void> {
  if (!db.isTransaction) {
    await db.transaction().execute(async (trx) => {
      await seedDemoSession(trx, template);
    });
    return;
  }
  await applyPreset(db, template);
  await insertDemoCustomers(db, new Date().toISOString());
}
