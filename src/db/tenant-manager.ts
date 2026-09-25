import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb, openTenantDb } from './tenant-db.js';

export type TenantRecord = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'maintenance' | 'suspended';
  created_at: string;
};

export type ConsolidatedStockItem = {
  productId: string;
  quantity: number;
  updatedAt: string;
};

export type CreateTenantParams = {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string;
  seedDemoData?: boolean;
};

export class TenantManager {
  private cache = new Map<string, DatabaseSync>();
  private baseDir: string;
  private inMemory: boolean;

  constructor(
    private systemDb: DatabaseSync,
    options?: { baseDir?: string; inMemory?: boolean },
  ) {
    this.baseDir = options?.baseDir ?? join(process.cwd(), 'data', 'tenants');
    this.inMemory = options?.inMemory ?? false;
  }

  getTenantDb(tenantId: string): DatabaseSync {
    const existing = this.cache.get(tenantId);
    if (existing !== undefined) {
      return existing;
    }

    let db: DatabaseSync;
    if (this.inMemory) {
      db = new DatabaseSync(':memory:');
      initTenantDb(db);
    } else {
      const filePath = join(this.baseDir, `${tenantId}.sqlite`);
      db = openTenantDb(filePath);
    }

    this.cache.set(tenantId, db);
    return db;
  }

  createTenant(params: CreateTenantParams): TenantRecord {
    const now = new Date().toISOString();
    const status: TenantRecord['status'] = 'active';

    this.systemDb
      .prepare(
        'INSERT INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(params.id, params.slug, params.name, status, now);

    this.systemDb
      .prepare(
        'INSERT INTO memberships (user_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(params.ownerUserId, params.id, 'owner', now);

    const tenantDb = this.getTenantDb(params.id);

    // Sucursal por defecto
    const defaultBranchId = 'branch-central';
    tenantDb
      .prepare('INSERT INTO branches (id, name, code, created_at) VALUES (?, ?, ?, ?)')
      .run(defaultBranchId, 'Sucursal Central', 'CENTRAL', now);

    if (params.seedDemoData === true) {
      this.seedDemoData(tenantDb, defaultBranchId, now);
    }

    return {
      id: params.id,
      slug: params.slug,
      name: params.name,
      status,
      created_at: now,
    };
  }

  private seedDemoData(tenantDb: DatabaseSync, defaultBranchId: string, now: string): void {
    const products = [
      { id: 'prod-coca-500', sku: 'BEB-001', barcodes: ['779123456001'], name: 'Coca Cola 500ml', price: 1500, taxRate: 0.21, category: 'Bebidas', stock: 50 },
      { id: 'prod-agua-500', sku: 'BEB-002', barcodes: ['779123456002'], name: 'Agua Mineral 500ml', price: 1000, taxRate: 0.21, category: 'Bebidas', stock: 80 },
      { id: 'prod-yerba-1k', sku: 'ALM-001', barcodes: ['779123456003'], name: 'Yerba Mate 1kg', price: 3200, taxRate: 0.21, category: 'Almacén', stock: 25 },
      { id: 'prod-galletitas', sku: 'ALM-002', barcodes: ['779123456004'], name: 'Galletitas de Chocolate', price: 1200, taxRate: 0.21, category: 'Almacén', stock: 40 },
    ];

    const insertProd = tenantDb.prepare(
      'INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertStock = tenantDb.prepare(
      'INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, ?, ?)',
    );

    for (const p of products) {
      insertProd.run(p.id, p.sku, JSON.stringify(p.barcodes), p.name, p.price, p.taxRate, p.category, 1, now, now);
      insertStock.run(p.id, defaultBranchId, p.stock, now);
    }

    const customers = [
      { id: 'cust-cf', name: 'Consumidor Final', document: null, phone: null, creditLimit: 0, margin: 0, balance: 0 },
      { id: 'cust-juan', name: 'Juan Pérez', document: '20-12345678-9', phone: '11-4567-8901', creditLimit: 50000, margin: 10000, balance: 12500 },
      { id: 'cust-maria', name: 'María Gómez', document: '27-98765432-1', phone: '11-9876-5432', creditLimit: 30000, margin: 5000, balance: 0 },
    ];

    const insertCust = tenantDb.prepare(
      'INSERT INTO customers (id, name, document, phone, credit_limit, margin, balance, unrestricted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );

    for (const c of customers) {
      insertCust.run(c.id, c.name, c.document, c.phone, c.creditLimit, c.margin, c.balance, 0, now, now);
    }
  }

  getConsolidatedStock(tenantDb: DatabaseSync): ConsolidatedStockItem[] {
    const rows = tenantDb
      .prepare(
        'SELECT product_id, SUM(quantity) as quantity, MAX(updated_at) as updated_at FROM stock GROUP BY product_id',
      )
      .all() as { product_id: string; quantity: number | null; updated_at: string }[];

    return rows.map((r) => ({
      productId: r.product_id,
      quantity: r.quantity ?? 0,
      updatedAt: r.updated_at,
    }));
  }

  closeAll(): void {
    for (const db of this.cache.values()) {
      try {
        db.close();
      } catch {
        // Ignorar si ya estaba cerrada
      }
    }
    this.cache.clear();
  }
}
