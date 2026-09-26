import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb, openTenantDb } from './tenant-db.ts';
import { seedDemoTenant } from '../seeds/index.ts';

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
  private systemDb: DatabaseSync;
  private cache = new Map<string, DatabaseSync>();
  private baseDir: string;
  private inMemory: boolean;

  constructor(
    systemDb: DatabaseSync,
    options?: { baseDir?: string; inMemory?: boolean },
  ) {
    this.systemDb = systemDb;
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

  tenantExists(id: string): boolean {
    const row = this.systemDb
      .prepare('SELECT id FROM tenants WHERE id = ? OR slug = ?')
      .get(id, id);
    return row !== undefined;
  }

  resolveAvailableSlug(baseSlug: string): string {
    let candidate = baseSlug;
    let counter = 2;
    while (this.tenantExists(candidate)) {
      candidate = `${baseSlug}-${counter}`;
      counter++;
    }
    return candidate;
  }

  createTenant(params: CreateTenantParams): TenantRecord {
    const now = new Date().toISOString();
    const status: TenantRecord['status'] = 'active';

    // Desambiguar silenciosamente sólo si ya existe uno anterior
    let finalId = params.id;
    let finalSlug = params.slug;
    if (this.tenantExists(finalId) || this.tenantExists(finalSlug)) {
      finalId = this.resolveAvailableSlug(params.id);
      finalSlug = finalId;
    }

    this.systemDb
      .prepare(
        'INSERT INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(finalId, finalSlug, params.name, status, now);

    this.systemDb
      .prepare(
        'INSERT INTO memberships (user_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(params.ownerUserId, finalId, 'owner', now);

    const tenantDb = this.getTenantDb(finalId);

    // Sucursal por defecto
    const defaultBranchId = 'branch-central';
    tenantDb
      .prepare('INSERT INTO branches (id, name, code, created_at) VALUES (?, ?, ?, ?)')
      .run(defaultBranchId, 'Sucursal Central', 'CENTRAL', now);

    if (params.seedDemoData === true) {
      seedDemoTenant(tenantDb, defaultBranchId);
    }

    return {
      id: finalId,
      slug: finalSlug,
      name: params.name,
      status,
      created_at: now,
    };
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
