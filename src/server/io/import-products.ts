import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeHeader, parseAmount, parseBool, type DecimalMode } from './csv.ts';
import { writeStock } from '../stock/write-stock.ts';
import type { RowContext } from './import-service.ts';
import { stockField, type ImportBranch, type ImportRowResult } from '../../shared/import-fields.ts';

type ProductRow = {
  id: string;
  sku: string;
  barcodes: string;
  name: string;
  price: number;
  tax_rate: number;
  category: string;
  tracks_stock: number;
};

/** Lo que trae la fila, ya convertido; un campo ausente no se toca. */
type Parsed = {
  sku?: string;
  barcodes: string[];
  name?: string;
  price?: number;
  taxRate?: number;
  category?: string;
  tracksStock?: boolean;
  stock: { branchId: string; quantity: number }[];
};

const DEFAULT_TAX = 0.21;
const DEFAULT_CATEGORY = 'General';
const STOCK_NOTE = 'Importación';

const text = (v: string | undefined): string | undefined => (v === undefined || v === '' ? undefined : v);

/** `21`, `21%`, `10,5` o `0,21` → fracción (0.21, 0.105); `undefined` si no es un número. */
function parseTax(raw: string, decimal: DecimalMode): number | undefined {
  const n = parseAmount(raw.replace('%', ''), decimal);
  if (n === undefined) return undefined;
  return n > 1 ? Math.round(n * 10) / 1000 : n;
}

function parseRow(row: RowContext, branches: readonly ImportBranch[]): { data: Parsed; errors: string[] } {
  const errors: string[] = [];
  const sku = text(row.get('sku'));
  const name = text(row.get('name'));
  const category = text(row.get('category'));
  const barcodes = [...new Set((row.get('barcodes') ?? '').split(/[|;,]/).map((b) => b.trim()).filter((b) => b !== ''))];
  const rawPrice = text(row.get('price'));
  const price = rawPrice === undefined ? undefined : parseAmount(rawPrice, row.decimal);
  if (rawPrice !== undefined && price === undefined) errors.push('Precio: no es un número');
  if (price !== undefined && price < 0) errors.push('Precio: no puede ser negativo');
  const rawTax = text(row.get('taxRate'));
  const taxRate = rawTax === undefined ? undefined : parseTax(rawTax, row.decimal);
  if (rawTax !== undefined && taxRate === undefined) errors.push('IVA: no es un número');
  if (taxRate !== undefined && (taxRate < 0 || taxRate > 1)) errors.push('IVA: tiene que estar entre 0 y 100 %');
  const rawTracks = text(row.get('tracksStock'));
  const tracksStock = rawTracks === undefined ? undefined : parseBool(rawTracks);
  if (rawTracks !== undefined && tracksStock === undefined) errors.push('Controla stock: tiene que ser sí o no');
  const stock: Parsed['stock'] = [];
  for (const b of branches) {
    const raw = text(row.get(stockField(b.id)));
    if (raw === undefined) continue;
    const quantity = parseAmount(raw, row.decimal);
    if (quantity === undefined) errors.push(`Stock · ${b.name}: no es un número`);
    else stock.push({ branchId: b.id, quantity });
  }
  return {
    data: {
      barcodes,
      stock,
      ...(sku === undefined ? {} : { sku }),
      ...(name === undefined ? {} : { name }),
      ...(price === undefined ? {} : { price }),
      ...(taxRate === undefined ? {} : { taxRate }),
      ...(category === undefined ? {} : { category }),
      ...(tracksStock === undefined ? {} : { tracksStock }),
    },
    errors,
  };
}

/**
 * Productos y stock (#22): se reconocen por código de barras o SKU y, sin ninguno de los dos, por
 * nombre normalizado. Al actualizar solo se tocan los campos mapeados (los códigos de barras nuevos
 * se suman); el stock se fija por sucursal con un movimiento `inventory_count`.
 */
export function importProducts(db: DatabaseSync, rows: RowContext[], branches: readonly ImportBranch[], now: string): ImportRowResult[] {
  const bySku = db.prepare('SELECT id FROM products WHERE sku = ?');
  const byBarcode = db.prepare('SELECT DISTINCT p.id FROM products p, json_each(p.barcodes) j WHERE j.value = ?');
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const currentStock = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND branch_id = ?');
  const insertZeroStock = db.prepare(
    'INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT DO NOTHING',
  );
  const byName = new Map<string, string[]>();
  const rememberName = (name: string, id: string): void => {
    const key = normalizeHeader(name);
    byName.set(key, [...(byName.get(key) ?? []), id]);
  };
  for (const p of db.prepare('SELECT id, name FROM products').all() as { id: string; name: string }[]) rememberName(p.name, p.id);
  const nextSku = (): string => {
    const used = db.prepare("SELECT sku FROM products WHERE sku LIKE 'IMP-%'").all() as { sku: string }[];
    const max = used.reduce((m, r) => Math.max(m, Number(r.sku.slice('IMP-'.length)) || 0), 0);
    return `IMP-${String(max + 1).padStart(6, '0')}`;
  };
  const seen = new Map<string, number>();
  const results: ImportRowResult[] = [];

  for (const row of rows) {
    const { data, errors } = parseRow(row, branches);
    const key = data.sku ?? data.barcodes[0] ?? data.name ?? '';
    const byNameOnly = data.sku === undefined && data.barcodes.length === 0;
    const identities = [
      ...(data.sku === undefined ? [] : [`sku:${data.sku}`]),
      ...data.barcodes.map((b) => `bc:${b}`),
      ...(byNameOnly && data.name !== undefined ? [`name:${normalizeHeader(data.name)}`] : []),
    ];
    if (identities.length === 0) {
      results.push({ line: row.line, key, action: 'error', messages: ['La fila no tiene SKU, código de barras ni nombre'] });
      continue;
    }
    const previous = identities.map((i) => seen.get(i)).find((l) => l !== undefined);
    if (previous !== undefined) {
      results.push({ line: row.line, key, action: 'error', messages: [`Repetida: ver la línea ${String(previous)}`] });
      continue;
    }
    if (errors.length > 0) {
      results.push({ line: row.line, key, action: 'error', messages: errors });
      continue;
    }

    const skuId = data.sku === undefined ? undefined : (bySku.get(data.sku) as { id: string } | undefined)?.id;
    const barcodeIds = data.barcodes.flatMap((b) => (byBarcode.all(b) as { id: string }[]).map((r) => r.id));
    const ids = new Set([...(skuId === undefined ? [] : [skuId]), ...barcodeIds]);
    if (ids.size > 1) {
      results.push({ line: row.line, key, action: 'error', messages: ['El SKU y el código de barras son de productos distintos'] });
      continue;
    }
    const nameIds = byNameOnly && data.name !== undefined ? (byName.get(normalizeHeader(data.name)) ?? []) : [];
    if (nameIds.length > 1) {
      results.push({ line: row.line, key, action: 'error', messages: [`Hay ${String(nameIds.length)} productos con ese nombre`] });
      continue;
    }
    const existingId = [...ids][0] ?? nameIds[0];

    let productId: string;
    let created = false;
    let changed = false;
    if (existingId === undefined) {
      if (data.name === undefined) {
        results.push({ line: row.line, key, action: 'error', messages: ['Falta el nombre para crearlo'] });
        continue;
      }
      if (data.price === undefined) {
        results.push({ line: row.line, key, action: 'error', messages: ['Falta el precio para crearlo'] });
        continue;
      }
      // Sin SKU en el archivo: el primer código de barras (si está libre) o un correlativo
      const fromBarcode = data.barcodes[0];
      const sku = data.sku ?? (fromBarcode !== undefined && bySku.get(fromBarcode) === undefined ? fromBarcode : nextSku());
      const tracks = data.tracksStock ?? true;
      productId = `prod_${randomUUID()}`;
      db.prepare(
        `INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(
        productId,
        sku,
        JSON.stringify(data.barcodes),
        data.name,
        data.price,
        data.taxRate ?? DEFAULT_TAX,
        data.category ?? DEFAULT_CATEGORY,
        tracks ? 1 : 0,
        now,
        now,
      );
      if (tracks) for (const b of branches) insertZeroStock.run(productId, b.id, now);
      rememberName(data.name, productId);
      created = true;
    } else {
      productId = existingId;
      const current = getProduct.get(existingId) as ProductRow;
      const currentBarcodes = JSON.parse(current.barcodes) as string[];
      const newBarcodes = data.barcodes.filter((b) => !currentBarcodes.includes(b));
      // Nombres de columna fijos del código, nunca del archivo
      const changes: [string, string | number][] = [];
      if (data.sku !== undefined && data.sku !== current.sku) changes.push(['sku', data.sku]);
      if (newBarcodes.length > 0) changes.push(['barcodes', JSON.stringify([...currentBarcodes, ...newBarcodes])]);
      if (data.name !== undefined && data.name !== current.name) changes.push(['name', data.name]);
      if (data.price !== undefined && data.price !== current.price) changes.push(['price', data.price]);
      if (data.taxRate !== undefined && data.taxRate !== current.tax_rate) changes.push(['tax_rate', data.taxRate]);
      if (data.category !== undefined && data.category !== current.category) changes.push(['category', data.category]);
      if (data.tracksStock !== undefined && (data.tracksStock ? 1 : 0) !== current.tracks_stock) {
        changes.push(['tracks_stock', data.tracksStock ? 1 : 0]);
      }
      if (changes.length > 0) {
        const sets = changes.map(([col]) => `${col} = ?`).join(', ');
        db.prepare(`UPDATE products SET ${sets}, updated_at = ? WHERE id = ?`).run(...changes.map(([, v]) => v), now, existingId);
        if (data.name !== undefined) rememberName(data.name, existingId);
        changed = true;
      }
    }
    for (const i of identities) seen.set(i, row.line);

    for (const s of data.stock) {
      const cur = (currentStock.get(productId, s.branchId) as { quantity: number } | undefined)?.quantity ?? 0;
      if (cur === s.quantity) continue;
      writeStock(db, { productId, branchId: s.branchId, type: 'set', quantity: s.quantity, reason: 'inventory_count', notes: STOCK_NOTE, now });
      changed = true;
    }
    results.push({ line: row.line, key, action: created ? 'create' : changed ? 'update' : 'unchanged', messages: [] });
  }
  return results;
}
