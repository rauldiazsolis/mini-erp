import type { DatabaseSync } from 'node:sqlite';
import type { RowContext } from './import-service.ts';
import type { ImportBranch, ImportRowResult } from '../../shared/import-fields.ts';

/** Productos y stock (#22): lo completa la tarea siguiente. */
export function importProducts(_db: DatabaseSync, _rows: RowContext[], _branches: readonly ImportBranch[], _now: string): ImportRowResult[] {
  return [];
}
