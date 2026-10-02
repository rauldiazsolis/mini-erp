import type { DatabaseSync } from 'node:sqlite';
import { currentVersion, type Schema } from './types.ts';

/** Una base que este código no puede abrir ni migrar (anterior a la línea de base, más nueva, atrasada). */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** Una migración que falló: su transacción ya dejó la base como estaba. */
export class MigrationError extends Error {
  version: number;
  migration: string;
  constructor(version: number, migration: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`migración v${String(version)} ${migration}: ${detail}`, { cause });
    this.name = 'MigrationError';
    this.version = version;
    this.migration = migration;
  }
}

const LABEL: Record<Schema['kind'], string> = { system: 'de sistema', tenant: 'del comercio' };

export function readVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function hasTables(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get() !== undefined;
}

export type DbState = { kind: 'new' } | { kind: 'current' } | { kind: 'behind'; from: number; to: number };

/** Dónde está una base frente al código. Tira `SchemaError` si está fuera de rango. */
export function assessDb(db: DatabaseSync, schema: Schema): DbState {
  const version = readVersion(db);
  const target = currentVersion(schema);
  const label = LABEL[schema.kind];
  if (version === 0) {
    if (hasTables(db)) {
      throw new SchemaError(`La base ${label} tiene tablas sin versión: no se puede migrar`);
    }
    return { kind: 'new' };
  }
  if (version < schema.baselineVersion) {
    throw new SchemaError(
      `La base ${label} es anterior a la línea de base (v${String(version)} < v${String(schema.baselineVersion)}): no se puede migrar`,
    );
  }
  if (version > target) {
    throw new SchemaError(
      `La base ${label} es más nueva (v${String(version)}) que este código (v${String(target)}): ¿un rollback?`,
    );
  }
  return version === target ? { kind: 'current' } : { kind: 'behind', from: version, to: target };
}

/** Una base vacía: línea de base y todas las migraciones, en una sola transacción. */
function createAtCurrent(db: DatabaseSync, schema: Schema): void {
  db.exec('BEGIN');
  try {
    db.exec(schema.baselineSql);
    for (const migration of schema.migrations) {
      migration.up(db);
    }
    db.exec(`PRAGMA user_version = ${String(currentVersion(schema))}`);
    db.exec('COMMIT');
  } catch (err: unknown) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Lleva una base a la versión del código (#47): una transacción por migración, con `user_version`
 * adentro. Si una falla, esa queda como estaba y se corta acá.
 */
export function migrateDb(db: DatabaseSync, schema: Schema): { from: number; to: number; applied: string[] } {
  const state = assessDb(db, schema);
  const to = currentVersion(schema);
  if (state.kind === 'new') {
    createAtCurrent(db, schema);
    return { from: 0, to, applied: [] };
  }
  if (state.kind === 'current') {
    return { from: to, to, applied: [] };
  }
  const applied: string[] = [];
  for (const migration of schema.migrations) {
    if (migration.version <= state.from) {
      continue;
    }
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${String(migration.version)}`);
      db.exec('COMMIT');
    } catch (err: unknown) {
      db.exec('ROLLBACK');
      throw new MigrationError(migration.version, migration.name, err);
    }
    applied.push(`v${String(migration.version)} ${migration.name}`);
  }
  return { from: state.from, to, applied };
}

/**
 * Para abrir una base fuera del arranque: crea una nueva en la versión actual y verifica que una
 * existente esté al día. Nunca migra datos (eso es del arranque, con copia previa).
 */
export function checkDb(db: DatabaseSync, schema: Schema): void {
  const state = assessDb(db, schema);
  if (state.kind === 'new') {
    createAtCurrent(db, schema);
    return;
  }
  if (state.kind === 'behind') {
    throw new SchemaError(
      `La base ${LABEL[schema.kind]} tiene migraciones pendientes (v${String(state.from)} → v${String(state.to)}): se migran al arrancar el servidor`,
    );
  }
}
