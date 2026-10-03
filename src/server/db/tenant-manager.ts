import { rmSync } from 'node:fs';
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
  /** Sin dueño (una demo, #9) no se crea membresía. */
  ownerUserId?: string | undefined;
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
      candidate = `${baseSlug}-${String(counter)}`;
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

    if (params.ownerUserId !== undefined) {
      this.systemDb
        .prepare(
          'INSERT INTO memberships (user_id, tenant_id, role, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(params.ownerUserId, finalId, 'owner', now);
    }

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

  /**
   * Borra un tenant entero: cierra su base, borra sus filas de sistema y su archivo. Lo usa el
   * barrido de demos vencidas (#9). No depende de `PRAGMA foreign_keys`.
   */
  deleteTenant(id: string): void {
    const db = this.cache.get(id);
    if (db !== undefined) {
      try {
        db.close();
      } catch {
        // Ignorar si ya estaba cerrada
      }
      this.cache.delete(id);
    }

    this.systemDb.exec('BEGIN');
    try {
      this.systemDb.prepare('DELETE FROM register_devices WHERE register_id IN (SELECT id FROM registers WHERE tenant_id = ?)').run(id);
      this.systemDb.prepare('DELETE FROM registers WHERE tenant_id = ?').run(id);
      this.systemDb.prepare('DELETE FROM tenant_api_keys WHERE tenant_id = ?').run(id);
      this.systemDb.prepare('DELETE FROM memberships WHERE tenant_id = ?').run(id);
      this.systemDb.prepare('DELETE FROM demo_sessions WHERE tenant_id = ?').run(id);
      this.systemDb.prepare('DELETE FROM tenants WHERE id = ?').run(id);
      this.systemDb.exec('COMMIT');
    } catch (err: unknown) {
      this.systemDb.exec('ROLLBACK');
      throw err;
    }

    if (!this.inMemory) {
      const file = join(this.baseDir, `${id}.sqlite`);
      for (const path of [file, `${file}-wal`, `${file}-shm`]) {
        rmSync(path, { force: true });
      }
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
