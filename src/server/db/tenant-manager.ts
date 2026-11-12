import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from './pg/system-schema.ts';
import { initTenantDb, openTenantDb } from './tenant-db.ts';
import { seedDemoTenant } from '../seeds/index.ts';
import { isBusinessType, type BusinessType } from '../../shared/business-type.ts';

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
  /** El rubro (#22); las demos no lo guardan. */
  businessType?: BusinessType | undefined;
};

/**
 * Los comercios: sus filas de sistema (`tenants`, la membresía del owner) en PostgreSQL y la base de
 * cada uno, todavía en SQLite (un `.sqlite` por comercio o en memoria, para los tests).
 */
export class TenantManager {
  private db: Kysely<SystemDatabase>;
  private cache = new Map<string, DatabaseSync>();
  private baseDir: string;
  private inMemory: boolean;

  constructor(
    db: Kysely<SystemDatabase>,
    options?: { baseDir?: string; inMemory?: boolean },
  ) {
    this.db = db;
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

  async tenantExists(id: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('tenants')
      .select('id')
      .where((eb) => eb.or([eb('id', '=', id), eb('slug', '=', id)]))
      .executeTakeFirst();
    return row !== undefined;
  }

  async resolveAvailableSlug(baseSlug: string): Promise<string> {
    let candidate = baseSlug;
    let counter = 2;
    while (await this.tenantExists(candidate)) {
      candidate = `${baseSlug}-${String(counter)}`;
      counter++;
    }
    return candidate;
  }

  /** El nombre del comercio, el que se ve en el admin (#58); `null` si no existe. */
  async getTenantName(tenantId: string): Promise<string | null> {
    const row = await this.db.selectFrom('tenants').select('name').where('id', '=', tenantId).executeTakeFirst();
    return row?.name ?? null;
  }

  /** El rubro del comercio (#22); `null` si no tiene (comercios de antes de M6, demos). */
  async getBusinessType(tenantId: string): Promise<BusinessType | null> {
    const row = await this.db.selectFrom('tenants').select('business_type').where('id', '=', tenantId).executeTakeFirst();
    const value = row?.business_type ?? null;
    return value !== null && isBusinessType(value) ? value : null;
  }

  async createTenant(params: CreateTenantParams): Promise<TenantRecord> {
    const now = new Date().toISOString();
    const status: TenantRecord['status'] = 'active';

    // Desambiguar silenciosamente sólo si ya existe uno anterior
    let finalId = params.id;
    let finalSlug = params.slug;
    if ((await this.tenantExists(finalId)) || (await this.tenantExists(finalSlug))) {
      finalId = await this.resolveAvailableSlug(params.id);
      finalSlug = finalId;
    }

    const ownerUserId = params.ownerUserId;
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('tenants')
        .values({
          id: finalId,
          slug: finalSlug,
          name: params.name,
          status,
          created_at: now,
          // El owner que lo crea es el titular de la cuenta pagada (#21); una demo no tiene
          holder_user_id: ownerUserId ?? null,
          business_type: params.businessType ?? null,
        })
        .execute();
      if (ownerUserId !== undefined) {
        await trx.insertInto('memberships').values({ user_id: ownerUserId, tenant_id: finalId, role: 'owner', created_at: now }).execute();
      }
    });

    // La base del comercio sigue en SQLite: no hay transacción común con la de sistema
    const tenantDb = this.getTenantDb(finalId);

    // Sucursal por defecto
    const defaultBranchId = 'branch-central';
    tenantDb
      .prepare('INSERT INTO branches (id, name, code, created_at) VALUES (?, ?, ?, ?)')
      .run(defaultBranchId, 'Sucursal Central', 'CENTRAL', now);

    if (params.seedDemoData === true) {
      await seedDemoTenant(tenantDb, defaultBranchId);
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
   * Borra un comercio entero: cierra su base, borra su fila de sistema y su archivo. Lo usa el alta
   * para deshacer un comercio a medio crear. Sus cajas (con sus equipos), keys, membresías,
   * invitaciones, suspensiones y pedidos de ayuda se van con la fila (`ON DELETE CASCADE`).
   */
  async deleteTenant(id: string): Promise<void> {
    const db = this.cache.get(id);
    if (db !== undefined) {
      try {
        db.close();
      } catch {
        // Ignorar si ya estaba cerrada
      }
      this.cache.delete(id);
    }

    await this.db.deleteFrom('tenants').where('id', '=', id).execute();

    if (!this.inMemory) {
      const file = join(this.baseDir, `${id}.sqlite`);
      for (const path of [file, `${file}-wal`, `${file}-shm`]) {
        rmSync(path, { force: true });
      }
    }
  }

  async getConsolidatedStock(tenantDb: DatabaseSync): Promise<ConsolidatedStockItem[]> {
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
