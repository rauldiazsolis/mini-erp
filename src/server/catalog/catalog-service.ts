import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type BranchRecord = {
  id: string;
  name: string;
  code: string;
  createdAt: string;
};

export type CreateBranchInput = {
  id?: string;
  name: string;
  code: string;
};

export type UpdateBranchInput = {
  name?: string;
  code?: string;
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
  id?: string;
  sku: string;
  barcodes?: string[];
  name: string;
  price: number;
  taxRate?: number;
  category?: string;
  tracksStock?: boolean;
  blockedReason?: string | null;
};

export type UpdateProductInput = {
  sku?: string;
  barcodes?: string[];
  name?: string;
  price?: number;
  taxRate?: number;
  category?: string;
  tracksStock?: boolean;
  blockedReason?: string | null;
};

export type ProductFilter = {
  search?: string;
  category?: string;
  blocked?: boolean;
  limit?: number;
  offset?: number;
};

interface RawProductRow {
  id: string;
  sku: string;
  barcodes: string;
  name: string;
  price: number;
  tax_rate: number;
  category: string;
  tracks_stock: number;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface RawBranchRow {
  id: string;
  name: string;
  code: string;
  created_at: string;
}

export class CatalogService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // --- SUCURSALES (BRANCHES) ---

  listBranches(): BranchRecord[] {
    const rows = this.db.prepare('SELECT id, name, code, created_at FROM branches ORDER BY created_at ASC').all() as unknown as RawBranchRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      createdAt: r.created_at,
    }));
  }

  getBranch(id: string): BranchRecord | undefined {
    const row = this.db.prepare('SELECT id, name, code, created_at FROM branches WHERE id = ?').get(id) as unknown as RawBranchRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      createdAt: row.created_at,
    };
  }

  createBranch(data: CreateBranchInput): BranchRecord {
    const existing = this.db.prepare('SELECT id FROM branches WHERE code = ?').get(data.code);
    if (existing !== undefined) {
      throw new Error(`Ya existe una sucursal con el código '${data.code}'`);
    }

    const id = data.id ?? `branch_${randomUUID()}`;
    const now = new Date().toISOString();

    this.db
      .prepare('INSERT INTO branches (id, name, code, created_at) VALUES (?, ?, ?, ?)')
      .run(id, data.name, data.code, now);

    // Inicializar stock en 0 para todos los productos existentes que controlan stock
    const products = this.db.prepare('SELECT id FROM products WHERE tracks_stock = 1').all() as unknown as { id: string }[];
    const insertStock = this.db.prepare(
      'INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT DO NOTHING',
    );
    for (const p of products) {
      insertStock.run(p.id, id, now);
    }

    return {
      id,
      name: data.name,
      code: data.code,
      createdAt: now,
    };
  }

  updateBranch(id: string, data: UpdateBranchInput): BranchRecord | undefined {
    const current = this.getBranch(id);
    if (!current) return undefined;

    if (data.code !== undefined && data.code !== current.code) {
      const existing = this.db.prepare('SELECT id FROM branches WHERE code = ? AND id != ?').get(data.code, id);
      if (existing !== undefined) {
        throw new Error(`Ya existe una sucursal con el código '${data.code}'`);
      }
    }

    const name = data.name ?? current.name;
    const code = data.code ?? current.code;

    this.db.prepare('UPDATE branches SET name = ?, code = ? WHERE id = ?').run(name, code, id);

    return {
      id,
      name,
      code,
      createdAt: current.createdAt,
    };
  }

  // --- PRODUCTOS (PRODUCTS) ---

  listProducts(filter?: ProductFilter): ProductRecord[] {
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter?.category !== undefined && filter.category.trim() !== '') {
      sql += ' AND category = ?';
      params.push(filter.category.trim());
    }

    if (filter?.blocked !== undefined) {
      if (filter.blocked) {
        sql += ' AND blocked_reason IS NOT NULL';
      } else {
        sql += ' AND blocked_reason IS NULL';
      }
    }

    if (filter?.search !== undefined && filter.search.trim() !== '') {
      const term = `%${filter.search.trim()}%`;
      sql += ' AND (name LIKE ? OR sku LIKE ? OR barcodes LIKE ?)';
      params.push(term, term, term);
    }

    sql += ' ORDER BY name ASC';

    if (filter?.limit !== undefined && filter.limit > 0) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        sql += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as unknown as RawProductRow[];
    return rows.map((r) => this.mapProductRow(r));
  }

  getProduct(id: string): ProductRecord | undefined {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as unknown as RawProductRow | undefined;
    if (!row) return undefined;
    return this.mapProductRow(row);
  }

  getProductBySku(sku: string): ProductRecord | undefined {
    const row = this.db.prepare('SELECT * FROM products WHERE sku = ?').get(sku) as unknown as RawProductRow | undefined;
    if (!row) return undefined;
    return this.mapProductRow(row);
  }

  createProduct(data: CreateProductInput): ProductRecord {
    const existingSku = this.db.prepare('SELECT id FROM products WHERE sku = ?').get(data.sku);
    if (existingSku !== undefined) {
      throw new Error(`Ya existe un producto con el SKU '${data.sku}'`);
    }

    const id = data.id ?? `prod_${randomUUID()}`;
    const barcodes = data.barcodes ?? [];
    const taxRate = data.taxRate ?? 0.21;
    const category = data.category ?? 'General';
    const tracksStock = data.tracksStock ?? true;
    const blockedReason = data.blockedReason ?? null;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.sku,
        JSON.stringify(barcodes),
        data.name,
        data.price,
        taxRate,
        category,
        tracksStock ? 1 : 0,
        blockedReason,
        now,
        now,
      );

    // Inicializar stock en 0 para todas las sucursales existentes si tracksStock es true
    if (tracksStock) {
      const branches = this.db.prepare('SELECT id FROM branches').all() as unknown as { id: string }[];
      const insertStock = this.db.prepare(
        'INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT DO NOTHING',
      );
      for (const b of branches) {
        insertStock.run(id, b.id, now);
      }
    }

    return {
      id,
      sku: data.sku,
      barcodes,
      name: data.name,
      price: data.price,
      taxRate,
      category,
      tracksStock,
      blockedReason,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateProduct(id: string, data: UpdateProductInput): ProductRecord | undefined {
    const current = this.getProduct(id);
    if (!current) return undefined;

    if (data.sku !== undefined && data.sku !== current.sku) {
      const existingSku = this.db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(data.sku, id);
      if (existingSku !== undefined) {
        throw new Error(`Ya existe un producto con el SKU '${data.sku}'`);
      }
    }

    const now = new Date().toISOString();
    const sku = data.sku ?? current.sku;
    const barcodes = data.barcodes ?? current.barcodes;
    const name = data.name ?? current.name;
    const price = data.price ?? current.price;
    const taxRate = data.taxRate ?? current.taxRate;
    const category = data.category ?? current.category;
    const tracksStock = data.tracksStock ?? current.tracksStock;
    const blockedReason = data.blockedReason !== undefined ? data.blockedReason : current.blockedReason;

    this.db
      .prepare(
        `UPDATE products
         SET sku = ?, barcodes = ?, name = ?, price = ?, tax_rate = ?, category = ?, tracks_stock = ?, blocked_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        sku,
        JSON.stringify(barcodes),
        name,
        price,
        taxRate,
        category,
        tracksStock ? 1 : 0,
        blockedReason,
        now,
        id,
      );

    return {
      id,
      sku,
      barcodes,
      name,
      price,
      taxRate,
      category,
      tracksStock,
      blockedReason,
      createdAt: current.createdAt,
      updatedAt: now,
    };
  }

  deleteProduct(id: string, options?: { hard?: boolean; blockedReason?: string }): ProductRecord | { deleted: boolean } {
    const current = this.getProduct(id);
    if (!current) {
      throw new Error(`Producto '${id}' no encontrado`);
    }

    if (options?.hard === true) {
      this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
      return { deleted: true };
    }

    // Por defecto, soft delete / bloqueo
    const reason = options?.blockedReason ?? 'Archivado por administración';
    const updated = this.updateProduct(id, { blockedReason: reason });
    if (!updated) {
      throw new Error(`No se pudo actualizar el producto '${id}'`);
    }
    return updated;
  }

  listCategories(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != '' ORDER BY category ASC")
      .all() as unknown as { category: string }[];
    return rows.map((r) => r.category);
  }

  private mapProductRow(r: RawProductRow): ProductRecord {
    let parsedBarcodes: string[] = [];
    try {
      parsedBarcodes = JSON.parse(r.barcodes) as string[];
    } catch {
      parsedBarcodes = [];
    }

    return {
      id: r.id,
      sku: r.sku,
      barcodes: parsedBarcodes,
      name: r.name,
      price: r.price,
      taxRate: r.tax_rate,
      category: r.category,
      tracksStock: r.tracks_stock === 1,
      blockedReason: r.blocked_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
