import { DatabaseSync } from 'node:sqlite';
import { applyPreset } from '../seeds/index.ts';

export type EntityType = 'products' | 'customers' | 'stock';

export type BusinessPresetResult = {
  preset: 'kiosco' | 'ferreteria' | 'almacen';
  productsCreated: number;
  stockEntries: number;
};

interface RawProductRecord {
  id: string;
  sku: string;
  barcodes: string;
  name: string;
  price: number;
  tax_rate: number;
  category: string;
  tracks_stock: number;
  blocked_reason: string | null;
}

interface RawCustomerRecord {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  credit_limit: number | null;
  margin: number | null;
  balance: number | null;
  unrestricted: number;
  blocked_reason: string | null;
}

interface RawStockRecord {
  product_id: string;
  sku: string;
  product_name: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  quantity: number;
}

export class ImportExportService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // --- EXPORTACIÓN ---

  exportProducts(format: 'json' | 'csv'): { content: string | unknown[]; isCsv: boolean } {
    const rows = this.db.prepare('SELECT * FROM products ORDER BY name ASC').all() as unknown as RawProductRecord[];
    const items = rows.map((r) => {
      let barcodes: string[];
      try {
        barcodes = JSON.parse(r.barcodes) as string[];
      } catch {
        barcodes = [];
      }
      return {
        id: r.id,
        sku: r.sku,
        name: r.name,
        price: r.price,
        taxRate: r.tax_rate,
        category: r.category,
        barcodes,
        tracksStock: r.tracks_stock === 1,
        blockedReason: r.blocked_reason,
      };
    });

    if (format === 'csv') {
      const headers = ['id', 'sku', 'name', 'price', 'taxRate', 'category', 'barcodes', 'tracksStock', 'blockedReason'];
      const csvRows = items.map((i) => ({
        id: i.id,
        sku: i.sku,
        name: i.name,
        price: i.price,
        taxRate: i.taxRate,
        category: i.category,
        barcodes: i.barcodes.join(';'),
        tracksStock: i.tracksStock ? 'true' : 'false',
        blockedReason: i.blockedReason ?? '',
      }));
      return { content: this.serializeCsv(headers, csvRows), isCsv: true };
    }

    return { content: items, isCsv: false };
  }

  exportCustomers(format: 'json' | 'csv'): { content: string | unknown[]; isCsv: boolean } {
    const rows = this.db.prepare('SELECT * FROM customers ORDER BY name ASC').all() as unknown as RawCustomerRecord[];
    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      document: r.document,
      phone: r.phone,
      creditLimit: r.credit_limit ?? 0,
      margin: r.margin ?? 0,
      balance: r.balance ?? 0,
      unrestricted: r.unrestricted === 1,
      blockedReason: r.blocked_reason,
    }));

    if (format === 'csv') {
      const headers = ['id', 'name', 'document', 'phone', 'creditLimit', 'margin', 'balance', 'unrestricted', 'blockedReason'];
      const csvRows = items.map((i) => ({
        id: i.id,
        name: i.name,
        document: i.document ?? '',
        phone: i.phone ?? '',
        creditLimit: i.creditLimit,
        margin: i.margin,
        balance: i.balance,
        unrestricted: i.unrestricted ? 'true' : 'false',
        blockedReason: i.blockedReason ?? '',
      }));
      return { content: this.serializeCsv(headers, csvRows), isCsv: true };
    }

    return { content: items, isCsv: false };
  }

  exportStock(format: 'json' | 'csv'): { content: string | unknown[]; isCsv: boolean } {
    const rows = this.db
      .prepare(
        `SELECT s.product_id, p.sku, p.name as product_name, s.branch_id, b.code as branch_code, b.name as branch_name, s.quantity
         FROM stock s
         JOIN products p ON s.product_id = p.id
         JOIN branches b ON s.branch_id = b.id
         ORDER BY p.name ASC, b.name ASC`,
      )
      .all() as unknown as RawStockRecord[];

    const items = rows.map((r) => ({
      productId: r.product_id,
      sku: r.sku,
      productName: r.product_name,
      branchId: r.branch_id,
      branchCode: r.branch_code,
      branchName: r.branch_name,
      quantity: r.quantity,
    }));

    if (format === 'csv') {
      const headers = ['productId', 'sku', 'productName', 'branchId', 'branchCode', 'branchName', 'quantity'];
      return { content: this.serializeCsv(headers, items), isCsv: true };
    }

    return { content: items, isCsv: false };
  }

  // --- SEMILLAS DE NEGOCIO ---

  applyBusinessPreset(preset: 'kiosco' | 'ferreteria' | 'almacen'): BusinessPresetResult {
    return applyPreset(this.db, preset);
  }

  // --- HELPERS CSV RFC 4180 ---

  private serializeCsv(headers: string[], rows: Record<string, unknown>[]): string {
    const escapeCell = (val: unknown): string => {
      if (val === null || val === undefined) return '';
      let str: string;
      if (typeof val === 'string') {
        str = val;
      } else if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
        str = String(val);
      } else {
        str = JSON.stringify(val);
      }
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headerLine = headers.map(escapeCell).join(',');
    const bodyLines = rows.map((row) => headers.map((h) => escapeCell(row[h])).join(','));

    return [headerLine, ...bodyLines].join('\n');
  }
}
