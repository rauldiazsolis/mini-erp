import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { applyPreset } from '../seeds/index.ts';

export type EntityType = 'products' | 'customers' | 'stock';

export type ImportIssue = {
  row: number;
  identifier?: string;
  message: string;
};

export type ImportResult = {
  dryRun: boolean;
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  failedCount: number;
  errors: ImportIssue[];
};

export type BusinessPresetResult = {
  preset: 'kiosco' | 'ferreteria' | 'almacen';
  productsCreated: number;
  stockEntries: number;
};

const importProductRowSchema = z.object({
  id: z.string().optional(),
  sku: z.string().min(1, 'El SKU es requerido'),
  name: z.string().min(1, 'El nombre es requerido'),
  price: z.coerce.number().nonnegative('El precio no puede ser negativo'),
  taxRate: z.coerce.number().min(0).max(1).optional().default(0.21),
  category: z.string().optional().default('General'),
  barcodes: z.union([z.array(z.string()), z.string()]).optional().default([]),
  tracksStock: z.union([z.boolean(), z.string(), z.number()]).optional().default(true),
  blockedReason: z.string().nullable().optional(),
});

const importCustomerRowSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'El nombre es requerido'),
  document: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  creditLimit: z.coerce.number().nonnegative().optional().default(0),
  margin: z.coerce.number().nonnegative().optional().default(0),
  balance: z.coerce.number().optional().default(0),
  unrestricted: z.union([z.boolean(), z.string(), z.number()]).optional().default(false),
  blockedReason: z.string().nullable().optional(),
});

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

  // --- IMPORTACIÓN ---

  importProducts(input: {
    items?: unknown[];
    csv?: string;
    updateExisting?: boolean;
    dryRun?: boolean;
  }): ImportResult {
    const rawList = this.normalizeInputRows(input.items, input.csv);
    const updateExisting = input.updateExisting ?? true;
    const isDryRun = input.dryRun ?? false;
    const now = new Date().toISOString();

    const branches = this.db.prepare('SELECT id FROM branches').all() as unknown as { id: string }[];
    const errors: ImportIssue[] = [];
    let importedCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < rawList.length; i++) {
      const rawRow = rawList[i];
      const rowNum = i + 1;

      const parseResult = importProductRowSchema.safeParse(rawRow);
      if (!parseResult.success) {
        errors.push({
          row: rowNum,
          identifier: typeof rawRow === 'object' && rawRow !== null && 'sku' in rawRow ? String((rawRow as Record<string, unknown>)['sku']) : undefined,
          message: parseResult.error.errors[0]?.message ?? 'Fila inválida',
        });
        continue;
      }

      const data = parseResult.data;
      const sku = data.sku.trim();

      // Normalizar barcodes
      let barcodesArr: string[] = [];
      if (Array.isArray(data.barcodes)) {
        barcodesArr = data.barcodes.map(String).map((b) => b.trim()).filter((b) => b !== '');
      } else if (typeof data.barcodes === 'string' && data.barcodes.trim() !== '') {
        barcodesArr = data.barcodes.split(/[;,]/).map((b) => b.trim()).filter((b) => b !== '');
      }

      const tracksStockBool = data.tracksStock === true || data.tracksStock === 'true' || data.tracksStock === 1;

      // Comprobar si existe por SKU
      const existing = this.db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as { id: string } | undefined;

      if (existing !== undefined) {
        if (updateExisting) {
          if (!isDryRun) {
            this.db
              .prepare(
                `UPDATE products
                 SET name = ?, price = ?, tax_rate = ?, category = ?, barcodes = ?, tracks_stock = ?, blocked_reason = ?, updated_at = ?
                 WHERE id = ?`,
              )
              .run(
                data.name,
                data.price,
                data.taxRate,
                data.category,
                JSON.stringify(barcodesArr),
                tracksStockBool ? 1 : 0,
                data.blockedReason ?? null,
                now,
                existing.id,
              );
          }
          updatedCount++;
        } else {
          errors.push({
            row: rowNum,
            identifier: sku,
            message: `El producto con SKU '${sku}' ya existe`,
          });
        }
      } else {
        const id = data.id ?? `prod_${randomUUID()}`;
        if (!isDryRun) {
          this.db
            .prepare(
              `INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, blocked_reason, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              sku,
              JSON.stringify(barcodesArr),
              data.name,
              data.price,
              data.taxRate,
              data.category,
              tracksStockBool ? 1 : 0,
              data.blockedReason ?? null,
              now,
              now,
            );

          if (tracksStockBool) {
            const insertStock = this.db.prepare(
              'INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT DO NOTHING',
            );
            for (const b of branches) {
              insertStock.run(id, b.id, now);
            }
          }
        }
        importedCount++;
      }
    }

    return {
      dryRun: isDryRun,
      totalRows: rawList.length,
      importedCount,
      updatedCount,
      failedCount: errors.length,
      errors,
    };
  }

  importCustomers(input: {
    items?: unknown[];
    csv?: string;
    updateExisting?: boolean;
    dryRun?: boolean;
  }): ImportResult {
    const rawList = this.normalizeInputRows(input.items, input.csv);
    const updateExisting = input.updateExisting ?? true;
    const isDryRun = input.dryRun ?? false;
    const now = new Date().toISOString();

    const errors: ImportIssue[] = [];
    let importedCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < rawList.length; i++) {
      const rawRow = rawList[i];
      const rowNum = i + 1;

      const parseResult = importCustomerRowSchema.safeParse(rawRow);
      if (!parseResult.success) {
        errors.push({
          row: rowNum,
          identifier: typeof rawRow === 'object' && rawRow !== null && 'document' in rawRow ? String((rawRow as Record<string, unknown>)['document']) : undefined,
          message: parseResult.error.errors[0]?.message ?? 'Fila de cliente inválida',
        });
        continue;
      }

      const data = parseResult.data;
      const document = data.document ? data.document.trim() : null;
      const unrestrictedBool = data.unrestricted === true || data.unrestricted === 'true' || data.unrestricted === 1;

      // Buscar duplicado por documento o por ID
      let existing: { id: string } | undefined;
      if (document) {
        existing = this.db.prepare('SELECT id FROM customers WHERE document = ?').get(document) as { id: string } | undefined;
      }

      if (existing !== undefined) {
        if (updateExisting) {
          if (!isDryRun) {
            this.db
              .prepare(
                `UPDATE customers
                 SET name = ?, phone = ?, credit_limit = ?, margin = ?, unrestricted = ?, blocked_reason = ?, updated_at = ?
                 WHERE id = ?`,
              )
              .run(
                data.name,
                data.phone ?? null,
                data.creditLimit,
                data.margin,
                unrestrictedBool ? 1 : 0,
                data.blockedReason ?? null,
                now,
                existing.id,
              );
          }
          updatedCount++;
        } else {
          errors.push({
            row: rowNum,
            identifier: document ?? undefined,
            message: `El cliente con documento '${document ?? ''}' ya existe`,
          });
        }
      } else {
        const id = data.id ?? `cust_${randomUUID()}`;
        if (!isDryRun) {
          this.db
            .prepare(
              `INSERT INTO customers (id, name, document, phone, credit_limit, margin, balance, unrestricted, blocked_reason, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              data.name,
              document,
              data.phone ?? null,
              data.creditLimit,
              data.margin,
              data.balance,
              unrestrictedBool ? 1 : 0,
              data.blockedReason ?? null,
              now,
              now,
            );
        }
        importedCount++;
      }
    }

    return {
      dryRun: isDryRun,
      totalRows: rawList.length,
      importedCount,
      updatedCount,
      failedCount: errors.length,
      errors,
    };
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

  private parseCsv(text: string): Record<string, string>[] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return [];

    const parseLine = (line: string): string[] => {
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === undefined) break;
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++; // saltar quote escapada
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          cells.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current);
      return cells.map((c) => c.trim());
    };

    const headerLine = lines[0];
    if (!headerLine) return [];
    const headers = parseLine(headerLine);
    const results: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const values = parseLine(line);
      const row: Record<string, string> = {};
      for (let h = 0; h < headers.length; h++) {
        const headerKey = headers[h];
        if (headerKey) {
          row[headerKey] = values[h] ?? '';
        }
      }
      results.push(row);
    }

    return results;
  }

  private normalizeInputRows(items?: unknown[], csv?: string): unknown[] {
    if (Array.isArray(items)) {
      return items;
    }
    if (typeof csv === 'string' && csv.trim() !== '') {
      return this.parseCsv(csv);
    }
    return [];
  }
}
