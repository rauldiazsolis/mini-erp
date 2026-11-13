import type { Kysely } from 'kysely';
import { z } from '../../shared/zod.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { applyPreset } from '../seeds/apply-preset.ts';

export type EntityType = 'products' | 'customers' | 'stock';

export type BusinessPresetResult = {
  preset: 'kiosco' | 'ferreteria' | 'almacen';
  productsCreated: number;
  stockEntries: number;
};

const barcodesSchema = z.array(z.string());

export class ImportExportService {
  private db: Kysely<TenantDatabase>;

  constructor(db: Kysely<TenantDatabase>) {
    this.db = db;
  }

  // --- EXPORTACIÓN ---

  async exportProducts(format: 'json' | 'csv'): Promise<{ content: string | unknown[]; isCsv: boolean }> {
    const rows = await this.db
      .selectFrom('products')
      .select(['id', 'sku', 'barcodes', 'name', 'price', 'tax_rate', 'category', 'tracks_stock', 'blocked_reason'])
      .orderBy('name')
      .orderBy('id')
      .execute();
    const items = rows.map((r) => {
      // `barcodes` es jsonb: llega ya parseado. Lo que no sea una lista de textos se exporta vacío.
      const barcodes = barcodesSchema.safeParse(r.barcodes);
      return {
        id: r.id,
        sku: r.sku,
        name: r.name,
        price: r.price,
        taxRate: r.tax_rate,
        category: r.category,
        barcodes: barcodes.success ? barcodes.data : [],
        tracksStock: r.tracks_stock,
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

  async exportCustomers(format: 'json' | 'csv'): Promise<{ content: string | unknown[]; isCsv: boolean }> {
    const rows = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'document', 'phone', 'credit_limit', 'margin', 'balance', 'unrestricted', 'blocked_reason'])
      .orderBy('name')
      .orderBy('id')
      .execute();
    const items = rows.map((r) => ({
      id: r.id,
      name: r.name,
      document: r.document,
      phone: r.phone,
      creditLimit: r.credit_limit ?? 0,
      margin: r.margin ?? 0,
      balance: r.balance ?? 0,
      unrestricted: r.unrestricted,
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

  async exportStock(format: 'json' | 'csv'): Promise<{ content: string | unknown[]; isCsv: boolean }> {
    const rows = await this.db
      .selectFrom('stock as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .innerJoin('branches as b', 'b.id', 's.branch_id')
      .select(['s.product_id', 'p.sku', 'p.name as product_name', 's.branch_id', 'b.code as branch_code', 'b.name as branch_name', 's.quantity'])
      .orderBy('p.name')
      .orderBy('b.name')
      .orderBy('p.id')
      .orderBy('b.id')
      .execute();

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

  async countProducts(): Promise<number> {
    const row = await this.db
      .selectFrom('products')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    return row.n;
  }

  async applyBusinessPreset(preset: 'kiosco' | 'ferreteria' | 'almacen'): Promise<BusinessPresetResult> {
    return await applyPreset(this.db, preset);
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
