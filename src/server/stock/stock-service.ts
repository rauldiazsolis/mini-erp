import { DatabaseSync } from 'node:sqlite';
import { writeStock } from './write-stock.ts';

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

interface RawStockMatrixProductRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  tracks_stock: number;
  updated_at: string;
}

interface RawBranchRow {
  id: string;
  name: string;
  code: string;
}

interface RawStockRow {
  product_id: string;
  branch_id: string;
  quantity: number;
  updated_at: string;
}

interface RawKardexRow {
  id: string;
  product_id: string;
  product_name: string | null;
  sku: string | null;
  branch_id: string;
  branch_name: string | null;
  delta: number;
  reason: string;
  notes: string | null;
  sale_id: string | null;
  device_id: string | null;
  origin_branch: string | null;
  origin_pos: string | null;
  created_at: string;
}

export class StockService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // --- MATRIZ DE STOCK MULTI-SUCURSAL ---

  getStockMatrix(filter?: StockMatrixFilter): StockMatrixProduct[] {
    // 1. Obtener todas las sucursales
    const branches = this.db.prepare('SELECT id, name, code FROM branches ORDER BY created_at ASC').all() as unknown as RawBranchRow[];

    // 2. Obtener productos con filtros
    let prodSql = 'SELECT id, sku, name, category, tracks_stock, updated_at FROM products WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter?.category !== undefined && filter.category.trim() !== '') {
      prodSql += ' AND category = ?';
      params.push(filter.category.trim());
    }

    if (filter?.search !== undefined && filter.search.trim() !== '') {
      const term = `%${filter.search.trim()}%`;
      prodSql += ' AND (name LIKE ? OR sku LIKE ? OR barcodes LIKE ?)';
      params.push(term, term, term);
    }

    prodSql += ' ORDER BY name ASC';

    if (filter?.limit !== undefined && filter.limit > 0) {
      prodSql += ' LIMIT ?';
      params.push(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        prodSql += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const products = this.db.prepare(prodSql).all(...params) as unknown as RawStockMatrixProductRow[];
    if (products.length === 0) {
      return [];
    }

    // 3. Obtener stock de todos los productos
    const stockRows = this.db.prepare('SELECT product_id, branch_id, quantity, updated_at FROM stock').all() as unknown as RawStockRow[];

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

        if (item?.updatedAt && item.updatedAt > latestUpdated) {
          latestUpdated = item.updatedAt;
        }
      }

      return {
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        category: prod.category,
        tracksStock: prod.tracks_stock === 1,
        totalStock,
        branches: branchQuantities,
        updatedAt: latestUpdated,
      };
    });
  }

  // --- AJUSTE MANUAL DE STOCK (KARDEX AUDITADO) ---

  adjustStock(params: AdjustStockInput): AdjustStockResult {
    // 1. Verificar producto
    const prodRow = this.db.prepare('SELECT id, name FROM products WHERE id = ?').get(params.productId) as { id: string; name: string } | undefined;
    if (!prodRow) {
      const err = new Error(`Producto '${params.productId}' no encontrado`);
      (err as unknown as { statusCode: number }).statusCode = 404;
      throw err;
    }

    // 2. Verificar sucursal
    const branchRow = this.db.prepare('SELECT id, name FROM branches WHERE id = ?').get(params.branchId) as { id: string; name: string } | undefined;
    if (!branchRow) {
      const err = new Error(`Sucursal '${params.branchId}' no encontrada`);
      (err as unknown as { statusCode: number }).statusCode = 404;
      throw err;
    }

    // 3. Movimiento en el kardex, stock y producto tocado para el pull (#22: lo comparte la importación)
    const now = new Date().toISOString();
    const written = writeStock(this.db, {
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

  getKardex(filter?: KardexFilter): KardexMovement[] {
    let sql = `
      SELECT
        sm.id,
        sm.product_id,
        p.name as product_name,
        p.sku as sku,
        sm.branch_id,
        b.name as branch_name,
        sm.delta,
        sm.reason,
        sm.notes,
        sm.sale_id,
        sm.device_id,
        sm.branch as origin_branch,
        sm.point_of_sale as origin_pos,
        sm.created_at
      FROM stock_movements sm
      LEFT JOIN products p ON sm.product_id = p.id
      LEFT JOIN branches b ON sm.branch_id = b.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (filter?.productId !== undefined && filter.productId.trim() !== '') {
      sql += ' AND sm.product_id = ?';
      params.push(filter.productId.trim());
    }

    if (filter?.branchId !== undefined && filter.branchId.trim() !== '') {
      sql += ' AND sm.branch_id = ?';
      params.push(filter.branchId.trim());
    }

    if (filter?.reason !== undefined && filter.reason.trim() !== '') {
      sql += ' AND sm.reason = ?';
      params.push(filter.reason.trim());
    }

    if (filter?.from !== undefined && filter.from.trim() !== '') {
      sql += ' AND sm.created_at >= ?';
      params.push(filter.from.trim());
    }

    if (filter?.to !== undefined && filter.to.trim() !== '') {
      sql += ' AND sm.created_at <= ?';
      params.push(filter.to.trim());
    }

    sql += ' ORDER BY sm.created_at DESC';

    if (filter?.limit !== undefined && filter.limit > 0) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        sql += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as unknown as RawKardexRow[];

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
