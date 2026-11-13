import { sql, type Kysely } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { productMatchesSearch } from '../catalog/product-search.ts';
import { DomainError } from '../errors.ts';
import { roundQuantity, writeStock } from './write-stock.ts';

export type StockMatrixProduct = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  tracksStock: boolean;
  totalStock: number;
  branches: Record<string, number>;
  updatedAt: string;
};

export type StockMatrixFilter = {
  search?: string | undefined;
  category?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export type AdjustStockInput = {
  productId: string;
  branchId: string;
  type: 'set' | 'delta';
  quantity: number;
  reason: string;
  notes?: string | undefined;
};

export type AdjustStockResult = {
  productId: string;
  branchId: string;
  previousQuantity: number;
  delta: number;
  newQuantity: number;
  movementId: string;
  updatedAt: string;
};

export type KardexFilter = {
  productId?: string | undefined;
  branchId?: string | undefined;
  reason?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export type KardexMovement = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  branchId: string;
  branchName: string;
  delta: number;
  reason: string;
  notes: string | null;
  saleId: string | null;
  deviceId: string | null;
  originBranch: string | null;
  originPointOfSale: string | null;
  createdAt: string;
};

/** Un instante que llega de la URL, normalizado a ISO; si no se puede leer, `400`. */
function toInstant(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError(400, `Fecha inválida: '${value}'`);
  }
  return date.toISOString();
}

/** Stock por sucursal y kardex del comercio. Servicio de tenant: recibe el Kysely ya acotado a su esquema. */
export class StockService {
  private db: Kysely<TenantDatabase>;

  constructor(db: Kysely<TenantDatabase>) {
    this.db = db;
  }

  // --- MATRIZ DE STOCK MULTI-SUCURSAL ---

  async getStockMatrix(filter?: StockMatrixFilter): Promise<StockMatrixProduct[]> {
    // 1. Sucursales, en orden de alta (`seq` desempata dos del mismo instante)
    const branches = await this.db.selectFrom('branches').select(['id', 'name', 'code']).orderBy('created_at').orderBy('seq').execute();

    // 2. Productos con filtros, en el mismo orden que el catálogo
    let query = this.db
      .selectFrom('products')
      .select(['id', 'sku', 'name', 'category', 'tracks_stock', 'updated_at'])
      .orderBy('name')
      .orderBy('created_at')
      .orderBy('id');

    const category = filter?.category?.trim();
    if (category !== undefined && category !== '') {
      query = query.where('category', '=', category);
    }

    const search = filter?.search?.trim();
    if (search !== undefined && search !== '') {
      query = query.where((eb) => productMatchesSearch(eb, search));
    }

    if (filter?.limit !== undefined && filter.limit > 0) {
      query = query.limit(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        query = query.offset(filter.offset);
      }
    }

    const products = await query.execute();
    if (products.length === 0) {
      return [];
    }

    // 3. Stock de esos productos (los ids van como un solo array: sin tope de parámetros)
    const productIds = products.map((p) => p.id);
    const stockRows = await this.db
      .selectFrom('stock')
      .select(['product_id', 'branch_id', 'quantity', 'updated_at'])
      .where((eb) => eb('product_id', '=', sql<string>`any(${productIds}::text[])`))
      .execute();

    // Indexar stock por `${product_id}#${branch_id}`
    const stockMap = new Map<string, { quantity: number; updatedAt: string }>();
    for (const row of stockRows) {
      stockMap.set(`${row.product_id}#${row.branch_id}`, {
        quantity: row.quantity,
        updatedAt: row.updated_at,
      });
    }

    return products.map((prod) => {
      const branchQuantities: Record<string, number> = {};
      let totalStock = 0;
      let latestUpdated = prod.updated_at;

      for (const branch of branches) {
        const item = stockMap.get(`${prod.id}#${branch.id}`);
        const qty = item?.quantity ?? 0;
        branchQuantities[branch.id] = qty;
        totalStock += qty;

        if (item !== undefined && item.updatedAt > latestUpdated) {
          latestUpdated = item.updatedAt;
        }
      }

      return {
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        category: prod.category,
        tracksStock: prod.tracks_stock,
        // Las cantidades tienen 4 decimales: la suma en coma flotante no tiene que agregar ruido
        totalStock: roundQuantity(totalStock),
        branches: branchQuantities,
        updatedAt: latestUpdated,
      };
    });
  }

  // --- AJUSTE MANUAL DE STOCK (KARDEX AUDITADO) ---

  /**
   * El ajuste (kardex, stock y producto tocado) va en una transacción: la de quien llama, si pasa
   * su `trx`, o una propia.
   */
  async adjustStock(params: AdjustStockInput, db: Kysely<TenantDatabase> = this.db): Promise<AdjustStockResult> {
    if (!db.isTransaction) {
      return await db.transaction().execute(async (trx) => await this.adjustStock(params, trx));
    }

    // 1. Verificar producto
    const product = await db.selectFrom('products').select('id').where('id', '=', params.productId).executeTakeFirst();
    if (product === undefined) {
      throw new DomainError(404, `Producto '${params.productId}' no encontrado`);
    }

    // 2. Verificar sucursal
    const branch = await db.selectFrom('branches').select('id').where('id', '=', params.branchId).executeTakeFirst();
    if (branch === undefined) {
      throw new DomainError(404, `Sucursal '${params.branchId}' no encontrada`);
    }

    // 3. Movimiento en el kardex, stock y producto tocado para el pull (#22: lo comparte la importación)
    const now = new Date().toISOString();
    const written = await writeStock(db, {
      productId: params.productId,
      branchId: params.branchId,
      type: params.type,
      quantity: params.quantity,
      reason: params.reason,
      notes: params.notes,
      now,
    });

    return { productId: params.productId, branchId: params.branchId, ...written, updatedAt: now };
  }

  // --- CONSULTA DE KARDEX ---

  async getKardex(filter?: KardexFilter): Promise<KardexMovement[]> {
    // El kardex se pide por tramos (#87): el orden tiene que ser total y estable. `seq` desempata
    // dos movimientos del mismo instante por orden de llegada (lo que en SQLite no se podía).
    let query = this.db
      .selectFrom('stock_movements as sm')
      .leftJoin('products as p', 'p.id', 'sm.product_id')
      .leftJoin('branches as b', 'b.id', 'sm.branch_id')
      .select([
        'sm.id',
        'sm.product_id',
        'p.name as product_name',
        'p.sku',
        'sm.branch_id',
        'b.name as branch_name',
        'sm.delta',
        'sm.reason',
        'sm.notes',
        'sm.sale_id',
        'sm.device_id',
        'sm.branch as origin_branch',
        'sm.point_of_sale as origin_pos',
        'sm.created_at',
      ])
      .orderBy('sm.created_at', 'desc')
      .orderBy('sm.seq', 'desc');

    const productId = filter?.productId?.trim();
    if (productId !== undefined && productId !== '') {
      query = query.where('sm.product_id', '=', productId);
    }

    const branchId = filter?.branchId?.trim();
    if (branchId !== undefined && branchId !== '') {
      query = query.where('sm.branch_id', '=', branchId);
    }

    const reason = filter?.reason?.trim();
    if (reason !== undefined && reason !== '') {
      query = query.where('sm.reason', '=', reason);
    }

    const from = filter?.from?.trim();
    if (from !== undefined && from !== '') {
      query = query.where('sm.created_at', '>=', toInstant(from));
    }

    const to = filter?.to?.trim();
    if (to !== undefined && to !== '') {
      query = query.where('sm.created_at', '<=', toInstant(to));
    }

    if (filter?.limit !== undefined && filter.limit > 0) {
      query = query.limit(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        query = query.offset(filter.offset);
      }
    }

    const rows = await query.execute();

    return rows.map((r) => ({
      id: r.id,
      productId: r.product_id,
      productName: r.product_name ?? 'Producto Desconocido',
      sku: r.sku ?? '',
      branchId: r.branch_id,
      branchName: r.branch_name ?? 'Sucursal Desconocida',
      delta: r.delta,
      reason: r.reason,
      notes: r.notes,
      saleId: r.sale_id,
      deviceId: r.device_id,
      originBranch: r.origin_branch,
      originPointOfSale: r.origin_pos,
      createdAt: r.created_at,
    }));
  }
}
