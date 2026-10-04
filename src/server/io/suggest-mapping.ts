import { normalizeHeader } from './csv.ts';
import {
  CUSTOMER_FIELDS,
  PRODUCT_FIELDS,
  STOCK_UNASSIGNED,
  stockField,
  type CustomerField,
  type ImportBranch,
  type ImportEntity,
  type ImportField,
  type ImportMapping,
  type ProductField,
} from '../../shared/import-fields.ts';

/** Sinónimos ya normalizados (`normalizeHeader`), incluidos los nombres del export de mini. */
const CUSTOMER_SYNONYMS: Record<CustomerField, readonly string[]> = {
  id: ['id', 'id mini'],
  name: ['nombre', 'name', 'cliente', 'razon social', 'nombre y apellido', 'apellido y nombre'],
  document: ['document', 'documento', 'dni', 'cuit', 'cuil', 'nro doc', 'doc', 'nro documento'],
  phone: ['phone', 'telefono', 'tel', 'celular', 'cel', 'whatsapp', 'movil'],
  creditLimit: ['creditlimit', 'limite', 'limite de credito', 'limite credito', 'tope'],
  margin: ['margin', 'margen'],
  balance: ['balance', 'saldo', 'deuda', 'debe', 'saldo cc', 'cuenta corriente', 'saldo cuenta corriente'],
  unrestricted: ['unrestricted', 'sin restriccion', 'sin limite'],
  blockedReason: ['blockedreason', 'motivo de bloqueo', 'bloqueo', 'bloqueado'],
};

const PRODUCT_SYNONYMS: Record<ProductField, readonly string[]> = {
  sku: ['sku', 'codigo', 'cod', 'codigo interno', 'cod interno', 'art'],
  barcodes: ['barcodes', 'barcode', 'codigo de barras', 'cod barras', 'cod de barras', 'ean', 'barras'],
  name: ['nombre', 'name', 'descripcion', 'producto', 'articulo', 'detalle'],
  price: ['price', 'precio', 'precio venta', 'p venta', 'pvp', 'precio final', 'precio de venta'],
  taxRate: ['taxrate', 'iva', 'alicuota', 'alicuota iva'],
  category: ['category', 'categoria', 'rubro', 'familia', 'seccion'],
  tracksStock: ['tracksstock', 'controla stock', 'maneja stock'],
};

const STOCK_WORDS = ['stock', 'cantidad', 'cant', 'existencia', 'existencias', 'inventario'];

/** 2 = igual a un sinónimo; 1 = lo contiene como palabras enteras; 0 = nada. */
function score(header: string, synonyms: readonly string[]): number {
  if (synonyms.includes(header)) return 2;
  return synonyms.some((s) => ` ${header} `.includes(` ${s} `)) ? 1 : 0;
}

/** Pares campo → sinónimos, recorriendo las listas de campos (así el campo queda tipado). */
function synonymsFor(entity: ImportEntity): { field: ImportField; list: readonly string[] }[] {
  return entity === 'customers'
    ? CUSTOMER_FIELDS.map(({ field }) => ({ field, list: CUSTOMER_SYNONYMS[field] }))
    : PRODUCT_FIELDS.map(({ field }) => ({ field, list: PRODUCT_SYNONYMS[field] }));
}

/** Una columna de stock: por el nombre o el código de una sucursal, o genérica ("Stock", "Cantidad"). */
function stockCandidate(header: string, branches: readonly ImportBranch[]): ImportField | undefined {
  for (const b of branches) {
    const names = [normalizeHeader(b.name), normalizeHeader(b.code)].filter((n) => n.length >= 3);
    if (names.some((n) => score(header, [n]) > 0)) return stockField(b.id);
  }
  if (score(header, STOCK_WORDS) === 0) return undefined;
  const only = branches.length === 1 ? branches[0] : undefined;
  return only === undefined ? STOCK_UNASSIGNED : stockField(only.id);
}

/**
 * El mapeo sugerido (#22): cada columna a su mejor campo, sin repetir campos (salvo el stock sin
 * sucursal). Gana la coincidencia más exacta y, a igual calidad, la primera columna.
 */
export function suggestMapping(entity: ImportEntity, headers: readonly string[], branches: readonly ImportBranch[]): ImportMapping {
  const candidates: { column: number; field: ImportField; score: number }[] = [];
  headers.forEach((raw, column) => {
    const header = normalizeHeader(raw);
    if (header === '') return;
    for (const { field, list } of synonymsFor(entity)) {
      const s = score(header, list);
      if (s > 0) candidates.push({ column, field, score: s });
    }
    if (entity === 'products') {
      const stock = stockCandidate(header, branches);
      if (stock !== undefined) candidates.push({ column, field: stock, score: 2 });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const mapping: ImportMapping = Object.fromEntries(headers.map((_h, i) => [String(i), null]));
  const taken = new Set<ImportField>();
  for (const c of candidates) {
    if (mapping[String(c.column)] !== null) continue;
    if (taken.has(c.field) && c.field !== STOCK_UNASSIGNED) continue;
    mapping[String(c.column)] = c.field;
    taken.add(c.field);
  }
  return mapping;
}
