import type { DatabaseSync } from 'node:sqlite';
import { parseCsv, type DecimalMode } from './csv.ts';
import { suggestMapping } from './suggest-mapping.ts';
import { importCustomers } from './import-customers.ts';
import { importProducts } from './import-products.ts';
import { DomainError } from '../errors.ts';
import {
  CUSTOMER_FIELDS,
  PRODUCT_FIELDS,
  STOCK_UNASSIGNED,
  stockBranchOf,
  type ImportBranch,
  type ImportEntity,
  type ImportField,
  type ImportMapping,
  type ImportPreview,
  type ImportRowAction,
  type ImportRowResult,
} from '../../shared/import-fields.ts';

export type ImportRequest = { csv: string; mapping?: ImportMapping | undefined; dryRun: boolean };

/**
 * Una fila con sus celdas por campo: `undefined` si el campo no está mapeado, `''` si la celda está
 * vacía. `decimal` es `'comma'` si el archivo usa `;` (el punto es de miles).
 */
export type RowContext = { line: number; decimal: DecimalMode; get: (field: ImportField) => string | undefined };

/** Las columnas que identifican una fila; sin ninguna, no hay nada que importar. */
const IDENTIFIERS: Record<ImportEntity, readonly ImportField[]> = {
  customers: ['id', 'document', 'name'],
  products: ['sku', 'barcodes', 'name'],
};

const SAMPLES = 3;

/**
 * Importación con mapeo de columnas (#22), sin estado: cada vista previa y la confirmación reciben
 * el CSV entero. La vista previa corre igual dentro de un `SAVEPOINT` y se deshace; la confirmación
 * aplica las filas válidas en esa misma transacción (un error inesperado deshace todo).
 */
export class ImportService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  run(entity: ImportEntity, req: ImportRequest, now: string = new Date().toISOString()): ImportPreview {
    const table = parseCsv(req.csv);
    const branches = this.db.prepare('SELECT id, name, code FROM branches ORDER BY created_at, code').all() as ImportBranch[];
    const mapping = req.mapping ?? suggestMapping(entity, table.headers, branches);
    this.checkMapping(entity, mapping, table.headers.length, branches);

    const mapped = Object.entries(mapping).filter((e): e is [string, ImportField] => e[1] !== null);
    const missing: ImportField[] = mapped.some(([, f]) => IDENTIFIERS[entity].includes(f)) ? [] : ['name'];
    const needsBranch = mapped.filter(([, f]) => f === STOCK_UNASSIGNED).map(([i]) => Number(i));
    if (!req.dryRun && (missing.length > 0 || needsBranch.length > 0)) {
      throw new DomainError(400, 'Asigná las columnas que faltan antes de importar');
    }

    // El Excel argentino usa `;` y coma decimal: ahí `1.200` son mil doscientos
    const decimal: DecimalMode = table.separator === ';' ? 'comma' : 'auto';
    const columnOf = new Map<ImportField, number>(mapped.map(([i, f]) => [f, Number(i)]));
    const contexts: RowContext[] = table.rows.map(({ line, cells }) => ({
      line,
      decimal,
      get: (field) => {
        const column = columnOf.get(field);
        return column === undefined ? undefined : (cells[column] ?? '');
      },
    }));

    let rows: ImportRowResult[];
    this.db.exec('SAVEPOINT import_csv');
    try {
      rows = entity === 'customers' ? importCustomers(this.db, contexts, now) : importProducts(this.db, contexts, branches, now);
      if (req.dryRun) this.db.exec('ROLLBACK TO import_csv');
      this.db.exec('RELEASE import_csv');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK TO import_csv');
      this.db.exec('RELEASE import_csv');
      throw err;
    }

    const totals: Record<ImportRowAction, number> = { create: 0, update: 0, unchanged: 0, error: 0 };
    for (const r of rows) totals[r.action]++;
    return {
      entity,
      separator: table.separator,
      columns: table.headers.map((header, index) => ({
        index,
        header,
        samples: table.rows.slice(0, SAMPLES).map((r) => r.cells[index] ?? ''),
      })),
      mapping,
      branches,
      missing,
      needsBranch,
      rows,
      totals,
      dryRun: req.dryRun,
    };
  }

  /** Un mapeo de afuera: columnas que existen, campos de la entidad, sucursales del comercio, sin repetir. */
  private checkMapping(entity: ImportEntity, mapping: ImportMapping, columns: number, branches: readonly ImportBranch[]): void {
    const allowed = new Set<string>((entity === 'customers' ? CUSTOMER_FIELDS : PRODUCT_FIELDS).map((f) => f.field));
    const seen = new Set<string>();
    for (const [index, field] of Object.entries(mapping)) {
      if (!/^\d+$/.test(index) || Number(index) >= columns) throw new DomainError(400, `La columna ${index} no existe`);
      if (field === null) continue;
      const branchId = stockBranchOf(field);
      const valid =
        branchId === undefined
          ? allowed.has(field)
          : entity === 'products' && (field === STOCK_UNASSIGNED || branches.some((b) => b.id === branchId));
      if (!valid) throw new DomainError(400, `Campo desconocido: ${field}`);
      if (field !== STOCK_UNASSIGNED && seen.has(field)) throw new DomainError(400, 'Un campo está asignado a dos columnas');
      seen.add(field);
    }
  }
}
