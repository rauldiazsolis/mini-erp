import type { Kysely } from 'kysely';
import type { Database } from './pg/database.ts';
import { createTenantSchema, dropTenantSchema } from './pg/migrations/migrate.ts';
import type { SystemDatabase } from './pg/system-schema.ts';
import type { TenantDatabase } from './pg/tenant-schema.ts';
import { seedDemoTenant } from '../seeds/index.ts';
import { isBusinessType, type BusinessType } from '../../shared/business-type.ts';

export type TenantRecord = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'maintenance' | 'suspended';
  created_at: string;
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

export const DEFAULT_BRANCH_ID = 'branch-central';

/**
 * Los comercios: sus filas de sistema (`tenants`, la membresía del owner) y el esquema de cada uno
 * (`tenant_<id>`), en PostgreSQL.
 */
export class TenantManager {
  private database: Database;
  private db: Kysely<SystemDatabase>;

  constructor(database: Database) {
    this.database = database;
    this.db = database.system;
  }

  /**
   * Los datos de un comercio, acotados a su esquema: para los servicios de sistema que los necesitan
   * (demos, reconciliación, semillas). Un pedido los recibe de su scope (`tenantDbDef`).
   */
  forTenant(tenantId: string): Kysely<TenantDatabase> {
    return this.database.forTenant(tenantId);
  }

  async tenantExists(id: string, db: Kysely<SystemDatabase> = this.db): Promise<boolean> {
    const row = await db
      .selectFrom('tenants')
      .select('id')
      .where((eb) => eb.or([eb('id', '=', id), eb('slug', '=', id)]))
      .executeTakeFirst();
    return row !== undefined;
  }

  async resolveAvailableSlug(baseSlug: string, db: Kysely<SystemDatabase> = this.db): Promise<string> {
    let candidate = baseSlug;
    let counter = 2;
    while (await this.tenantExists(candidate, db)) {
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

  /** Crea el comercio entero: sus filas de sistema (en su transacción) y después su base. */
  async createTenant(params: CreateTenantParams): Promise<TenantRecord> {
    const record = await this.db.transaction().execute(async (trx) => await this.createTenantRecord(params, trx));
    // El esquema del comercio se crea fuera de la transacción (una migración puede no ser transaccional)
    try {
      await this.initTenantStorage(record.id, { seedDemoData: params.seedDemoData === true, now: record.created_at });
    } catch (err: unknown) {
      await this.deleteTenant(record.id);
      throw err;
    }
    return record;
  }

  /**
   * Las filas de sistema de un comercio nuevo (`tenants` y la membresía del owner), con el executor
   * de quien llama: el alta lo hace dentro de su transacción y crea el esquema después
   * (`initTenantStorage`), compensando con `deleteTenant` si falla.
   */
  async createTenantRecord(params: CreateTenantParams, db: Kysely<SystemDatabase> = this.db): Promise<TenantRecord> {
    const now = new Date().toISOString();
    const status: TenantRecord['status'] = 'active';

    // Desambiguar silenciosamente sólo si ya existe uno anterior
    let finalId = params.id;
    let finalSlug = params.slug;
    if ((await this.tenantExists(finalId, db)) || (await this.tenantExists(finalSlug, db))) {
      finalId = await this.resolveAvailableSlug(params.id, db);
      finalSlug = finalId;
    }

    const ownerUserId = params.ownerUserId;
    await db
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
      await db.insertInto('memberships').values({ user_id: ownerUserId, tenant_id: finalId, role: 'owner', created_at: now }).execute();
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
   * El esquema de un comercio recién creado (`createTenantSchema`, fuera de cualquier transacción),
   * con la sucursal por defecto y, si se pide, la semilla. Si algo falla después de crear el esquema,
   * lo borra; las filas de sistema las deshace quien llama (`deleteTenant`).
   */
  async initTenantStorage(tenantId: string, options: { seedDemoData?: boolean; now?: string } = {}): Promise<void> {
    const now = options.now ?? new Date().toISOString();
    await createTenantSchema(this.database.root, tenantId);
    try {
      // La sucursal por defecto y la semilla, juntas
      await this.forTenant(tenantId)
        .transaction()
        .execute(async (trx) => {
          await trx.insertInto('branches').values({ id: DEFAULT_BRANCH_ID, name: 'Sucursal Central', code: 'CENTRAL', created_at: now }).execute();
          if (options.seedDemoData === true) {
            await seedDemoTenant(trx, DEFAULT_BRANCH_ID);
          }
        });
    } catch (err: unknown) {
      await dropTenantSchema(this.database.root, tenantId);
      throw err;
    }
  }

  /**
   * Borra un comercio entero: su fila de sistema y su esquema. Lo usa el alta para deshacer un
   * comercio a medio crear. Sus cajas (con sus equipos), keys, membresías, invitaciones,
   * suspensiones, pedidos de ayuda y bonos se van con la fila (`ON DELETE CASCADE`).
   */
  async deleteTenant(id: string): Promise<void> {
    await this.db.deleteFrom('tenants').where('id', '=', id).execute();
    await dropTenantSchema(this.database.root, id);
  }
}
