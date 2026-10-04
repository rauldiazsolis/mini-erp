/**
 * Importación con mapeo de columnas (#22): los campos de cada entidad, sus etiquetas y los tipos de
 * la API. TS puro: lo usan el servidor y el cliente.
 */

export type ImportEntity = 'customers' | 'products';
export type CustomerField =
  | 'id'
  | 'name'
  | 'document'
  | 'phone'
  | 'creditLimit'
  | 'margin'
  | 'balance'
  | 'unrestricted'
  | 'blockedReason';
export type ProductField = 'sku' | 'barcodes' | 'name' | 'price' | 'taxRate' | 'category' | 'tracksStock';
/** Stock de una sucursal (`stock:<branchId>`) o de una sucursal todavía sin elegir (`stock:?`). */
export type StockField = `stock:${string}`;
export type ImportField = CustomerField | ProductField | StockField;
/** Índice de columna (como string, por JSON) → campo, o `null` = no importar. */
export type ImportMapping = Record<string, ImportField | null>;
export type ImportBranch = { id: string; name: string; code: string };
export type ImportRowAction = 'create' | 'update' | 'unchanged' | 'error';
export type ImportRowResult = { line: number; key: string; action: ImportRowAction; messages: string[] };

export type ImportPreview = {
  entity: ImportEntity;
  separator: ';' | ',' | '\t';
  columns: { index: number; header: string; samples: string[] }[];
  mapping: ImportMapping;
  branches: ImportBranch[];
  /** `['name']` si ninguna columna identifica las filas. */
  missing: ImportField[];
  /** Columnas de stock genérico sin sucursal. */
  needsBranch: number[];
  rows: ImportRowResult[];
  totals: Record<ImportRowAction, number>;
  dryRun: boolean;
};

export const STOCK_UNASSIGNED: StockField = 'stock:?';

export const CUSTOMER_FIELDS: readonly { field: CustomerField; label: string }[] = [
  { field: 'id', label: 'Id (de mini)' },
  { field: 'name', label: 'Nombre' },
  { field: 'document', label: 'Documento' },
  { field: 'phone', label: 'Teléfono' },
  { field: 'creditLimit', label: 'Límite de crédito' },
  { field: 'margin', label: 'Margen' },
  { field: 'balance', label: 'Saldo' },
  { field: 'unrestricted', label: 'Sin restricción' },
  { field: 'blockedReason', label: 'Motivo de bloqueo' },
];

export const PRODUCT_FIELDS: readonly { field: ProductField; label: string }[] = [
  { field: 'sku', label: 'SKU' },
  { field: 'barcodes', label: 'Código de barras' },
  { field: 'name', label: 'Nombre' },
  { field: 'price', label: 'Precio' },
  { field: 'taxRate', label: 'IVA' },
  { field: 'category', label: 'Categoría' },
  { field: 'tracksStock', label: 'Controla stock' },
];

export function stockField(branchId: string): StockField {
  return `stock:${branchId}`;
}

/** La sucursal de un campo de stock (`'?'` si todavía no se eligió); `undefined` si no es de stock. */
export function stockBranchOf(field: ImportField): string | undefined {
  return field.startsWith('stock:') ? field.slice('stock:'.length) : undefined;
}

/** Un nombre de campo conocido (de cualquier entidad) o de stock. */
export function isImportFieldName(value: string): value is ImportField {
  if (value.startsWith('stock:') && value.length > 'stock:'.length) return true;
  return CUSTOMER_FIELDS.some((f) => f.field === value) || PRODUCT_FIELDS.some((f) => f.field === value);
}

export function fieldLabel(field: ImportField, branches: readonly ImportBranch[]): string {
  const branchId = stockBranchOf(field);
  if (branchId !== undefined) {
    if (field === STOCK_UNASSIGNED) return 'Stock · ¿qué sucursal?';
    return `Stock · ${branches.find((b) => b.id === branchId)?.name ?? branchId}`;
  }
  return [...CUSTOMER_FIELDS, ...PRODUCT_FIELDS].find((f) => f.field === field)?.label ?? field;
}
