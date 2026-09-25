import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { BusinessPreset, SeedProduct } from './types.ts';
import { KIOSCO_PRODUCTS } from './kiosco.ts';
import { FERRETERIA_PRODUCTS } from './ferreteria.ts';
import { ALMACEN_PRODUCTS } from './almacen.ts';
import { DEMO_CUSTOMERS } from './demo-customers.ts';
import { generateHistoricalDemoActivity } from './demo-activity-generator.ts';

export * from './types.ts';
export * from './kiosco.ts';
export * from './ferreteria.ts';
export * from './almacen.ts';
export * from './demo-customers.ts';
export * from './demo-activity-generator.ts';

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

export function applyPreset(
  db: DatabaseSync,
  preset: BusinessPreset,
): { preset: BusinessPreset; productsCreated: number; stockEntries: number } {
  const items = getPresetProducts(preset);
  const now = new Date().toISOString();
  const branches = db.prepare('SELECT id FROM branches').all() as unknown as { id: string }[];
  const defaultBranchId = branches[0]?.id;

  let productsCreated = 0;
  let stockEntries = 0;

  for (const item of items) {
    const existing = db.prepare('SELECT id FROM products WHERE sku = ?').get(item.sku);
    if (existing !== undefined) continue;

    const prodId = `prod_${randomUUID()}`;
    db.prepare(
      `INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, blocked_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0.21, ?, 1, NULL, ?, ?)`,
    ).run(prodId, item.sku, JSON.stringify(item.barcodes), item.name, item.price, item.category, now, now);

    productsCreated++;

    if (defaultBranchId !== undefined) {
      db.prepare(
        `INSERT INTO stock (product_id, branch_id, quantity, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
      ).run(prodId, defaultBranchId, item.stock, now);
      stockEntries++;
    }
  }

  return { preset, productsCreated, stockEntries };
}

export function seedDemoTenant(
  db: DatabaseSync,
  defaultBranchId: string,
  options?: { withHistory?: boolean },
): void {
  const now = new Date().toISOString();

  // 1. Productos iniciales (Preset Kiosco)
  const insertProd = db.prepare(
    'INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertStock = db.prepare(
    'INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, ?, ?)',
  );

  const initialProducts = [
    { id: 'prod-coca-500', sku: 'BEB-001', barcodes: ['779123456001'], name: 'Coca Cola 500ml', price: 1500, taxRate: 0.21, category: 'Bebidas', stock: 50 },
    { id: 'prod-agua-500', sku: 'BEB-002', barcodes: ['779123456002'], name: 'Agua Mineral 500ml', price: 1000, taxRate: 0.21, category: 'Bebidas', stock: 80 },
    { id: 'prod-yerba-1k', sku: 'ALM-001', barcodes: ['779123456003'], name: 'Yerba Mate 1kg', price: 3200, taxRate: 0.21, category: 'Almacén', stock: 25 },
    { id: 'prod-galletitas', sku: 'ALM-002', barcodes: ['779123456004'], name: 'Galletitas de Chocolate', price: 1200, taxRate: 0.21, category: 'Almacén', stock: 40 },
  ];

  for (const p of initialProducts) {
    insertProd.run(p.id, p.sku, JSON.stringify(p.barcodes), p.name, p.price, p.taxRate, p.category, 1, now, now);
    insertStock.run(p.id, defaultBranchId, p.stock, now);
  }

  // 2. Clientes iniciales
  const insertCust = db.prepare(
    'INSERT INTO customers (id, name, document, phone, credit_limit, margin, balance, unrestricted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  for (const c of DEMO_CUSTOMERS) {
    const custId = c.id ?? `cust_${randomUUID()}`;
    insertCust.run(
      custId,
      c.name,
      c.document ?? null,
      c.phone ?? null,
      c.creditLimit,
      c.margin,
      c.balance,
      c.unrestricted ? 1 : 0,
      now,
      now,
    );

    if (c.balance > 0) {
      db.prepare(
        `INSERT INTO account_movements (id, customer_id, type, amount, balance_after, description, sale_id, created_at)
         VALUES (?, ?, 'adjustment', ?, ?, 'Saldo inicial cuenta corriente', NULL, ?)`,
      ).run(`mov_init_${custId}`, custId, c.balance, c.balance, now);
    }
  }

  // 3. Generar historial de ventas y movimientos si está habilitado
  if (options?.withHistory ?? true) {
    generateHistoricalDemoActivity(db, defaultBranchId);
  }
}
