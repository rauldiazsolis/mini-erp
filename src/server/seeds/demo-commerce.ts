import type { DatabaseSync } from 'node:sqlite';
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
 * no cobran). Es la "foto inicial" del reinicio total. No abre transacción.
 */
export function seedDemoCommerce(db: DatabaseSync, template: DemoTemplate, now: Date): void {
  const at = now.toISOString();
  db.prepare('INSERT OR IGNORE INTO branches (id, name, code, created_at) VALUES (?, ?, ?, ?)').run(
    DEMO_BRANCH_ID,
    'Sucursal Central',
    DEMO_BRANCH_CODE,
    at,
  );
  const product = db.prepare(
    `INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, blocked_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
  );
  const stock = db.prepare('INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, ?, ?)');
  for (const p of demoSeedProducts(template)) {
    product.run(p.id, p.sku, JSON.stringify(p.barcodes), p.name, p.price, p.taxRate ?? 0.21, p.category, at, at);
    stock.run(p.id, DEMO_BRANCH_ID, p.stock, at);
  }
  insertDemoCustomers(db, at);
  ['Caja 1', 'Caja 2'].forEach((pointOfSale, index) => {
    generateHistoricalDemoActivity(db, DEMO_BRANCH_ID, now, {
      days: DEMO_HISTORY_DAYS,
      idPrefix: index === 0 ? '' : `c${String(index + 1)}_`,
      origin: { deviceId: `pos_casa_${String(index + 1)}`, branch: DEMO_BRANCH_CODE, pointOfSale },
    });
  });
}
