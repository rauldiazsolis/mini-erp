import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { z } from '../../shared/zod.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { isUniqueViolation, jsonValue, searchable, searchPattern } from '../db/pg/sql-helpers.ts';

export type BranchRecord = {
  id: string;
  name: string;
  code: string;
  createdAt: string;
};

export type CreateBranchInput = {
  id?: string | undefined;
  name: string;
  code: string;
};

export type UpdateBranchInput = {
  name?: string | undefined;
  code?: string | undefined;
};

export type ProductRecord = {
  id: string;
  sku: string;
  barcodes: string[];
  name: string;
  price: number;
  taxRate: number;
  category: string;
  tracksStock: boolean;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateProductInput = {
  id?: string | undefined;
  sku: string;
  barcodes?: string[] | undefined;
  name: string;
  price: number;
  taxRate?: number | undefined;
  category?: string | undefined;
  tracksStock?: boolean | undefined;
  blockedReason?: string | null | undefined;
};

export type UpdateProductInput = {
  sku?: string | undefined;
  barcodes?: string[] | undefined;
  name?: string | undefined;
  price?: number | undefined;
  taxRate?: number | undefined;
  category?: string | undefined;
  tracksStock?: boolean | undefined;
  blockedReason?: string | null | undefined;
};

export type ProductFilter = {
  search?: string | undefined;
  category?: string | undefined;
  blocked?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

const BRANCH_COLUMNS = ['id', 'name', 'code', 'created_at'] as const;

const PRODUCT_COLUMNS = [
  'id',
  'sku',
  'barcodes',
  'name',
  'price',
  'tax_rate',
  'category',
  'tracks_stock',
  'blocked_reason',
  'created_at',
  'updated_at',
] as const;

type BranchRow = {
  id: string;
  name: string;
  code: string;
  created_at: string;
};

type ProductRow = {
  id: string;
  sku: string;
  barcodes: unknown;
  name: string;
  price: number;
  tax_rate: number;
  category: string;
  tracks_stock: boolean;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
};

const barcodesSchema = z.array(z.string());

function toBranch(r: BranchRow): BranchRecord {
  return { id: r.id, name: r.name, code: r.code, createdAt: r.created_at };
}

function toProduct(r: ProductRow): ProductRecord {
  // `barcodes` es jsonb: llega ya parseado. Lo que no sea una lista de textos se lee como vacío.
  const barcodes = barcodesSchema.safeParse(r.barcodes);
  return {
    id: r.id,
    sku: r.sku,
    barcodes: barcodes.success ? barcodes.data : [],
    name: r.name,
    price: r.price,
    taxRate: r.tax_rate,
    category: r.category,
    tracksStock: r.tracks_stock,
    blockedReason: r.blocked_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Catálogo y sucursales del comercio. Servicio de tenant: recibe el Kysely ya acotado a su esquema. */
export class CatalogService {
  private db: Kysely<TenantDatabase>;

  constructor(db: Kysely<TenantDatabase>) {
    this.db = db;
  }

  // --- SUCURSALES (BRANCHES) ---

  async listBranches(): Promise<BranchRecord[]> {
    // `seq` desempata dos sucursales del mismo instante por orden de alta
    const rows = await this.db.selectFrom('branches').select(BRANCH_COLUMNS).orderBy('created_at').orderBy('seq').execute();
    return rows.map(toBranch);
  }

  async getBranch(id: string): Promise<BranchRecord | undefined> {
    const row = await this.db.selectFrom('branches').select(BRANCH_COLUMNS).where('id', '=', id).executeTakeFirst();
    return row === undefined ? undefined : toBranch(row);
  }

  async createBranch(data: CreateBranchInput): Promise<BranchRecord> {
    const id = data.id ?? `branch_${randomUUID()}`;
    const now = new Date().toISOString();

    return await this.db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('branches')
        .values({ id, name: data.name, code: data.code, created_at: now })
        .onConflict((oc) => oc.doNothing())
        .returning(BRANCH_COLUMNS)
        .executeTakeFirst();
      if (created === undefined) {
        const sameCode = await trx.selectFrom('branches').select('id').where('code', '=', data.code).executeTakeFirst();
        throw new Error(
          sameCode === undefined ? `Ya existe una sucursal con el id '${id}'` : `Ya existe una sucursal con el código '${data.code}'`,
        );
      }

      // Inicializar stock en 0 para todos los productos existentes que controlan stock
      const products = await trx.selectFrom('products').select('id').where('tracks_stock', '=', true).execute();
      if (products.length > 0) {
        await trx
          .insertInto('stock')
          .values(products.map((p) => ({ product_id: p.id, branch_id: id, quantity: 0, updated_at: now })))
          .onConflict((oc) => oc.doNothing())
          .execute();
      }

      return toBranch(created);
    });
  }

  async updateBranch(id: string, data: UpdateBranchInput): Promise<BranchRecord | undefined> {
    if (data.name === undefined && data.code === undefined) {
      return await this.getBranch(id);
    }
    try {
      const row = await this.db
        .updateTable('branches')
        .set({
          ...(data.name === undefined ? {} : { name: data.name }),
          ...(data.code === undefined ? {} : { code: data.code }),
        })
        .where('id', '=', id)
        .returning(BRANCH_COLUMNS)
        .executeTakeFirst();
      return row === undefined ? undefined : toBranch(row);
    } catch (err: unknown) {
      if (isUniqueViolation(err) && data.code !== undefined) {
        throw new Error(`Ya existe una sucursal con el código '${data.code}'`, { cause: err });
      }
      throw err;
    }
  }

  // --- PRODUCTOS (PRODUCTS) ---

  async listProducts(filter?: ProductFilter): Promise<ProductRecord[]> {
    // Por nombre; con el mismo nombre, en orden de alta (`id` desempata dos del mismo instante)
    let query = this.db.selectFrom('products').select(PRODUCT_COLUMNS).orderBy('name').orderBy('created_at').orderBy('id');

    const category = filter?.category?.trim();
    if (category !== undefined && category !== '') {
      query = query.where('category', '=', category);
    }

    if (filter?.blocked !== undefined) {
      query = query.where('blocked_reason', filter.blocked ? 'is not' : 'is', null);
    }

    const search = filter?.search?.trim();
    if (search !== undefined && search !== '') {
      const pattern = searchPattern(search);
      query = query.where((eb) => {
        // Cada código de barras del jsonb, como texto (una columna que no sea una lista no tiene ninguno)
        const barcodes = sql`jsonb_array_elements_text(case when jsonb_typeof(${eb.ref('barcodes')}) = 'array' then ${eb.ref('barcodes')} else '[]'::jsonb end)`;
        return eb.or([
          eb(searchable(eb.ref('name')), 'like', pattern),
          eb(searchable(eb.ref('sku')), 'like', pattern),
          sql<boolean>`exists (select 1 from ${barcodes} as ${sql.ref('barcode')} where ${searchable(sql.ref<string>('barcode'))} like ${pattern})`,
        ]);
      });
    }

    if (filter?.limit !== undefined && filter.limit > 0) {
      query = query.limit(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        query = query.offset(filter.offset);
      }
    }

    const rows = await query.execute();
    return rows.map(toProduct);
  }

  async getProduct(id: string): Promise<ProductRecord | undefined> {
    const row = await this.db.selectFrom('products').select(PRODUCT_COLUMNS).where('id', '=', id).executeTakeFirst();
    return row === undefined ? undefined : toProduct(row);
  }

  async getProductBySku(sku: string): Promise<ProductRecord | undefined> {
    const row = await this.db.selectFrom('products').select(PRODUCT_COLUMNS).where('sku', '=', sku).executeTakeFirst();
    return row === undefined ? undefined : toProduct(row);
  }

  async createProduct(data: CreateProductInput): Promise<ProductRecord> {
    const id = data.id ?? `prod_${randomUUID()}`;
    const tracksStock = data.tracksStock ?? true;
    const now = new Date().toISOString();

    return await this.db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('products')
        .values({
          id,
          sku: data.sku,
          barcodes: jsonValue(data.barcodes ?? []),
          name: data.name,
          price: data.price,
          tax_rate: data.taxRate ?? 0.21,
          category: data.category ?? 'General',
          tracks_stock: tracksStock,
          blocked_reason: data.blockedReason ?? null,
          created_at: now,
          updated_at: now,
        })
        .onConflict((oc) => oc.doNothing())
        .returning(PRODUCT_COLUMNS)
        .executeTakeFirst();
      if (created === undefined) {
        const sameSku = await trx.selectFrom('products').select('id').where('sku', '=', data.sku).executeTakeFirst();
        throw new Error(
          sameSku === undefined ? `Ya existe un producto con el id '${id}'` : `Ya existe un producto con el SKU '${data.sku}'`,
        );
      }

      // Inicializar stock en 0 para todas las sucursales existentes si tracksStock es true
      if (tracksStock) {
        const branches = await trx.selectFrom('branches').select('id').execute();
        if (branches.length > 0) {
          await trx
            .insertInto('stock')
            .values(branches.map((b) => ({ product_id: id, branch_id: b.id, quantity: 0, updated_at: now })))
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
      }

      return toProduct(created);
    });
  }

  /** Cambia solo los campos que vienen, en un único `UPDATE`: dos ediciones a la vez no se pisan campos. */
  async updateProduct(id: string, data: UpdateProductInput): Promise<ProductRecord | undefined> {
    try {
      const row = await this.db
        .updateTable('products')
        .set({
          ...(data.sku === undefined ? {} : { sku: data.sku }),
          ...(data.barcodes === undefined ? {} : { barcodes: jsonValue(data.barcodes) }),
          ...(data.name === undefined ? {} : { name: data.name }),
          ...(data.price === undefined ? {} : { price: data.price }),
          ...(data.taxRate === undefined ? {} : { tax_rate: data.taxRate }),
          ...(data.category === undefined ? {} : { category: data.category }),
          ...(data.tracksStock === undefined ? {} : { tracks_stock: data.tracksStock }),
          ...(data.blockedReason === undefined ? {} : { blocked_reason: data.blockedReason }),
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', id)
        .returning(PRODUCT_COLUMNS)
        .executeTakeFirst();
      return row === undefined ? undefined : toProduct(row);
    } catch (err: unknown) {
      if (isUniqueViolation(err) && data.sku !== undefined) {
        throw new Error(`Ya existe un producto con el SKU '${data.sku}'`, { cause: err });
      }
      throw err;
    }
  }

  async deleteProduct(id: string, options?: { hard?: boolean | undefined; blockedReason?: string | undefined }): Promise<ProductRecord | { deleted: boolean }> {
    if (options?.hard === true) {
      // `stock.product_id` no tiene FK: el stock se borra acá, con el producto. El kardex queda.
      await this.db.transaction().execute(async (trx) => {
        const deleted = await trx.deleteFrom('products').where('id', '=', id).returning('id').executeTakeFirst();
        if (deleted === undefined) {
          throw new Error(`Producto '${id}' no encontrado`);
        }
        await trx.deleteFrom('stock').where('product_id', '=', id).execute();
      });
      return { deleted: true };
    }

    // Por defecto, soft delete / bloqueo
    const reason = options?.blockedReason ?? 'Archivado por administración';
    const updated = await this.updateProduct(id, { blockedReason: reason });
    if (!updated) {
      throw new Error(`Producto '${id}' no encontrado`);
    }
    return updated;
  }

  async listCategories(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('products')
      .select('category')
      .distinct()
      .where('category', '!=', '')
      .orderBy('category')
      .execute();
    return rows.map((r) => r.category);
  }
}
