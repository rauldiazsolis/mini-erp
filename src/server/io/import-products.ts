import { randomUUID } from 'node:crypto';
import type { Transaction, Updateable } from 'kysely';
import { z } from '../../shared/zod.ts';
import { normalizeHeader, parseAmount, parseBool, parseDecimal, type DecimalMode } from './csv.ts';
import { parseMoneyCell, writeRow } from './import-row.ts';
import { roundQuantity, writeStock } from '../stock/write-stock.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { jsonValue } from '../db/pg/sql-helpers.ts';
import type { RowContext } from './import-service.ts';
import { stockField, type ImportBranch, type ImportRowResult } from '../../shared/import-fields.ts';

/** Un producto como está en la base, en memoria mientras dura la importación. */
type Product = {
  id: string;
  sku: string;
  barcodes: string[];
  name: string;
  price: number;
  taxRate: number;
  category: string;
  tracksStock: boolean;
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
const SKU_PREFIX = 'IMP-';
/** Lo que entra en `numeric(14,4)`: diez dígitos enteros. */
const MAX_QUANTITY = 9_999_999_999.9999;

const barcodesSchema = z.array(z.string());

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
  const price = rawPrice === undefined ? undefined : parseMoneyCell('Precio', rawPrice, row.decimal, true, errors);
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
    // Una cantidad no se valida por decimales: se redondea a los 4 de la columna
    const quantity = parseDecimal(raw, row.decimal);
    if (quantity === undefined) errors.push(`Stock · ${b.name}: no es un número`);
    else if (Math.abs(quantity) > MAX_QUANTITY) errors.push(`Stock · ${b.name}: cantidad inválida`);
    else stock.push({ branchId: b.id, quantity: roundQuantity(quantity) });
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

const stockKey = (productId: string, branchId: string): string => `${productId}\u0000${branchId}`;

/**
 * El catálogo del comercio en memoria: la importación busca las coincidencias acá (por SKU, código
 * de barras o nombre normalizado) y lo va actualizando con cada fila que se escribe, así una fila
 * ve lo que dejó la anterior sin volver a consultar la base.
 */
class Catalog {
  private products = new Map<string, Product>();
  private bySku = new Map<string, string>();
  private byBarcode = new Map<string, Set<string>>();
  private byName = new Map<string, Set<string>>();
  private stock = new Map<string, number>();

  static async load(trx: Transaction<TenantDatabase>): Promise<Catalog> {
    const catalog = new Catalog();
    const rows = await trx
      .selectFrom('products')
      .select(['id', 'sku', 'barcodes', 'name', 'price', 'tax_rate', 'category', 'tracks_stock'])
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    for (const r of rows) {
      const barcodes = barcodesSchema.safeParse(r.barcodes);
      catalog.put({
        id: r.id,
        sku: r.sku,
        barcodes: barcodes.success ? barcodes.data : [],
        name: r.name,
        price: r.price,
        taxRate: r.tax_rate,
        category: r.category,
        tracksStock: r.tracks_stock,
      });
    }
    for (const s of await trx.selectFrom('stock').select(['product_id', 'branch_id', 'quantity']).execute()) {
      catalog.stock.set(stockKey(s.product_id, s.branch_id), s.quantity);
    }
    return catalog;
  }

  get(id: string): Product | undefined {
    return this.products.get(id);
  }

  idBySku(sku: string): string | undefined {
    return this.bySku.get(sku);
  }

  idsByBarcode(barcode: string): string[] {
    return [...(this.byBarcode.get(barcode) ?? [])];
  }

  idsByName(name: string): string[] {
    return [...(this.byName.get(normalizeHeader(name)) ?? [])];
  }

  /** Agrega un producto o reemplaza el que había con ese id, con sus índices. */
  put(product: Product): void {
    const previous = this.products.get(product.id);
    if (previous !== undefined) {
      this.bySku.delete(previous.sku);
      for (const b of previous.barcodes) this.byBarcode.get(b)?.delete(product.id);
      this.byName.get(normalizeHeader(previous.name))?.delete(product.id);
    }
    this.products.set(product.id, product);
    this.bySku.set(product.sku, product.id);
    for (const b of product.barcodes) this.byBarcode.set(b, (this.byBarcode.get(b) ?? new Set()).add(product.id));
    const nameKey = normalizeHeader(product.name);
    this.byName.set(nameKey, (this.byName.get(nameKey) ?? new Set()).add(product.id));
  }

  stockOf(productId: string, branchId: string): number {
    return this.stock.get(stockKey(productId, branchId)) ?? 0;
  }

  setStock(productId: string, branchId: string, quantity: number): void {
    this.stock.set(stockKey(productId, branchId), quantity);
  }

  /** El correlativo que sigue para un producto sin SKU ni código de barras. */
  nextSku(): string {
    let max = 0;
    for (const sku of this.bySku.keys()) {
      if (sku.startsWith(SKU_PREFIX)) max = Math.max(max, Number(sku.slice(SKU_PREFIX.length)) || 0);
    }
    return `${SKU_PREFIX}${String(max + 1).padStart(6, '0')}`;
  }
}

/**
 * Productos y stock (#22): se reconocen por código de barras o SKU y, sin ninguno de los dos, por
 * nombre normalizado. Al actualizar solo se tocan los campos mapeados (los códigos de barras nuevos
 * se suman); el stock se fija por sucursal con un movimiento `inventory_count`. Corre en la
 * transacción de la importación y cada fila escribe en su `SAVEPOINT`.
 */
export async function importProducts(
  trx: Transaction<TenantDatabase>,
  rows: RowContext[],
  branches: readonly ImportBranch[],
  now: string,
): Promise<ImportRowResult[]> {
  const catalog = await Catalog.load(trx);
  const seen = new Map<string, number>();
  const results: ImportRowResult[] = [];
  const fail = (row: RowContext, key: string, message: string): void => {
    results.push({ line: row.line, key, action: 'error', messages: [message] });
  };

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
      fail(row, key, 'La fila no tiene SKU, código de barras ni nombre');
      continue;
    }
    const previous = identities.map((i) => seen.get(i)).find((l) => l !== undefined);
    if (previous !== undefined) {
      fail(row, key, `Repetida: ver la línea ${String(previous)}`);
      continue;
    }
    if (errors.length > 0) {
      results.push({ line: row.line, key, action: 'error', messages: errors });
      continue;
    }

    const skuId = data.sku === undefined ? undefined : catalog.idBySku(data.sku);
    const ids = new Set([...(skuId === undefined ? [] : [skuId]), ...data.barcodes.flatMap((b) => catalog.idsByBarcode(b))]);
    if (ids.size > 1) {
      fail(row, key, 'El SKU y el código de barras son de productos distintos');
      continue;
    }
    const nameIds = byNameOnly && data.name !== undefined ? catalog.idsByName(data.name) : [];
    if (nameIds.length > 1) {
      fail(row, key, `Hay ${String(nameIds.length)} productos con ese nombre`);
      continue;
    }
    const existingId = [...ids][0] ?? nameIds[0];
    const current = existingId === undefined ? undefined : catalog.get(existingId);

    let product: Product;
    let changes: Updateable<TenantDatabase['products']> | undefined;
    if (current === undefined) {
      if (data.name === undefined) {
        fail(row, key, 'Falta el nombre para crearlo');
        continue;
      }
      if (data.price === undefined) {
        fail(row, key, 'Falta el precio para crearlo');
        continue;
      }
      // Sin SKU en el archivo: el primer código de barras (si está libre) o un correlativo
      const fromBarcode = data.barcodes[0];
      product = {
        id: `prod_${randomUUID()}`,
        sku: data.sku ?? (fromBarcode !== undefined && catalog.idBySku(fromBarcode) === undefined ? fromBarcode : catalog.nextSku()),
        barcodes: data.barcodes,
        name: data.name,
        price: data.price,
        taxRate: data.taxRate ?? DEFAULT_TAX,
        category: data.category ?? DEFAULT_CATEGORY,
        tracksStock: data.tracksStock ?? true,
      };
    } else {
      const newBarcodes = data.barcodes.filter((b) => !current.barcodes.includes(b));
      product = {
        ...current,
        ...(data.sku === undefined ? {} : { sku: data.sku }),
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.price === undefined ? {} : { price: data.price }),
        ...(data.taxRate === undefined ? {} : { taxRate: data.taxRate }),
        ...(data.category === undefined ? {} : { category: data.category }),
        ...(data.tracksStock === undefined ? {} : { tracksStock: data.tracksStock }),
        barcodes: [...current.barcodes, ...newBarcodes],
      };
      // Solo los campos mapeados que cambian
      changes = {
        ...(product.sku === current.sku ? {} : { sku: product.sku }),
        ...(newBarcodes.length === 0 ? {} : { barcodes: jsonValue(product.barcodes) }),
        ...(product.name === current.name ? {} : { name: product.name }),
        ...(product.price === current.price ? {} : { price: product.price }),
        ...(product.taxRate === current.taxRate ? {} : { tax_rate: product.taxRate }),
        ...(product.category === current.category ? {} : { category: product.category }),
        ...(product.tracksStock === current.tracksStock ? {} : { tracks_stock: product.tracksStock }),
      };
    }
    const created = current === undefined;
    const fieldsChanged = changes !== undefined && Object.keys(changes).length > 0;
    const stockChanges = data.stock.filter((s) => catalog.stockOf(product.id, s.branchId) !== s.quantity);

    if (created || fieldsChanged || stockChanges.length > 0) {
      const failure = await writeRow(trx, row.line, async () => {
        if (created) {
          await trx
            .insertInto('products')
            .values({
              id: product.id,
              sku: product.sku,
              barcodes: jsonValue(product.barcodes),
              name: product.name,
              price: product.price,
              tax_rate: product.taxRate,
              category: product.category,
              tracks_stock: product.tracksStock,
              blocked_reason: null,
              created_at: now,
              updated_at: now,
            })
            .execute();
          if (product.tracksStock && branches.length > 0) {
            await trx
              .insertInto('stock')
              .values(branches.map((b) => ({ product_id: product.id, branch_id: b.id, quantity: 0, updated_at: now })))
              .onConflict((oc) => oc.doNothing())
              .execute();
          }
        } else if (fieldsChanged && changes !== undefined) {
          await trx.updateTable('products').set({ ...changes, updated_at: now }).where('id', '=', product.id).execute();
        }
        for (const s of stockChanges) {
          await writeStock(trx, {
            productId: product.id,
            branchId: s.branchId,
            type: 'set',
            quantity: s.quantity,
            reason: 'inventory_count',
            notes: STOCK_NOTE,
            now,
          });
        }
      });
      if (failure !== undefined) {
        fail(row, key, failure);
        continue;
      }
      catalog.put(product);
      for (const s of stockChanges) catalog.setStock(product.id, s.branchId, s.quantity);
    }
    // Solo una fila que se aplica "ocupa" sus claves: corregida más abajo en el mismo archivo, entra
    for (const i of identities) seen.set(i, row.line);
    results.push({ line: row.line, key, action: created ? 'create' : fieldsChanged || stockChanges.length > 0 ? 'update' : 'unchanged', messages: [] });
  }
  return results;
}
