import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assessDb, migrateDb, SchemaError } from './migrate.ts';
import { SYSTEM_SCHEMA } from './system.ts';
import { TENANT_SCHEMA } from './tenant.ts';
import type { Schema } from './types.ts';

export const PRE_MIGRATION_DIR = 'pre-migracion';
const RUN_DIR = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
const SYSTEM_FILE = 'system.sqlite';

/** `file` es relativo a `dataDir` y usa `/`: `system.sqlite`, `tenants/<id>.sqlite`. */
export type MigrationProgress = { file: string; done: number; total: number };
export type MigratedFile = { file: string; from: number; to: number };
export type MigrationRunResult = { runDir?: string; migrated: MigratedFile[] };

/** Falló la migración de una base; las ya migradas en la corrida se restauraron. */
export class MigrationRunError extends Error {
  file: string;
  constructor(file: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${file}, ${detail}`, { cause });
    this.name = 'MigrationRunError';
    this.file = file;
  }
}

type Pending = { file: string; schema: Schema; from: number; to: number };

function stamp(now: Date): string {
  return now.toISOString().slice(0, 19).replace(/:/g, '-');
}

/** `VACUUM INTO`: copia consistente y compacta (la misma que el backup nocturno). */
function vacuumInto(from: string, to: string): void {
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    db.prepare('VACUUM INTO ?').run(to);
  } finally {
    db.close();
  }
}

function pruneRuns(dir: string, keep: number): void {
  const runs = readdirSync(dir).filter((d) => RUN_DIR.test(d)).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - keep))) {
    rmSync(join(dir, old), { recursive: true, force: true });
  }
}

/** Vuelve a dejar cada base como estaba en la copia de la corrida. Nadie la tiene que tener abierta. */
export function restoreRun(runDir: string, dataDir: string, files: readonly string[]): void {
  for (const file of files) {
    const target = join(dataDir, file);
    for (const suffix of ['-wal', '-shm']) {
      rmSync(`${target}${suffix}`, { force: true });
    }
    copyFileSync(join(runDir, file), target);
  }
}

/** Qué bases están atrasadas. Si alguna está fuera de rango, no toca nada y lo dice. */
function plan(dataDir: string, schemas: { system: Schema; tenant: Schema }): Pending[] | undefined {
  const systemPath = join(dataDir, SYSTEM_FILE);
  if (!existsSync(systemPath)) {
    return undefined;
  }
  const targets: { file: string; schema: Schema }[] = [{ file: SYSTEM_FILE, schema: schemas.system }];
  const system = new DatabaseSync(systemPath, { readOnly: true });
  try {
    if (assessDb(system, schemas.system).kind === 'new') {
      return undefined;
    }
    const rows = system.prepare('SELECT id FROM tenants ORDER BY id').all() as { id: string }[];
    for (const { id } of rows) {
      const file = `tenants/${id}.sqlite`;
      if (existsSync(join(dataDir, file))) {
        targets.push({ file, schema: schemas.tenant });
      }
    }
  } catch (err: unknown) {
    if (err instanceof SchemaError) {
      throw new SchemaError(`Bases fuera de rango, no se migró nada:\n${SYSTEM_FILE}: ${err.message}`);
    }
    throw err;
  } finally {
    system.close();
  }

  const pending: Pending[] = [];
  const outOfRange: string[] = [];
  for (const target of targets) {
    const db = new DatabaseSync(join(dataDir, target.file), { readOnly: true });
    try {
      const state = assessDb(db, target.schema);
      if (state.kind === 'behind') {
        pending.push({ ...target, from: state.from, to: state.to });
      }
    } catch (err: unknown) {
      if (!(err instanceof SchemaError)) {
        throw err;
      }
      outOfRange.push(`${target.file}: ${err.message}`);
    } finally {
      db.close();
    }
  }
  if (outOfRange.length > 0) {
    throw new SchemaError(`Bases fuera de rango, no se migró nada:\n${outOfRange.join('\n')}`);
  }
  return pending;
}

/**
 * Migra todas las bases al arrancar (#47): sistema y cada comercio, demos incluidas. Antes copia lo
 * que va a migrar a `pre-migracion/<fecha>/`. Si una falla, restaura las que ya migró: todas quedan
 * en la versión vieja, consistentes.
 */
export function runMigrations(params: {
  dataDir: string;
  now: Date;
  keepRuns?: number | undefined;
  onProgress?: ((progress: MigrationProgress) => void) | undefined;
  schemas?: { system: Schema; tenant: Schema } | undefined;
}): MigrationRunResult {
  const pending = plan(params.dataDir, params.schemas ?? { system: SYSTEM_SCHEMA, tenant: TENANT_SCHEMA });
  if (pending === undefined || pending.length === 0) {
    return { migrated: [] };
  }

  const runsDir = join(params.dataDir, PRE_MIGRATION_DIR);
  const runDir = join(runsDir, stamp(params.now));
  rmSync(runDir, { recursive: true, force: true });
  for (const p of pending) {
    const copy = join(runDir, p.file);
    mkdirSync(dirname(copy), { recursive: true });
    vacuumInto(join(params.dataDir, p.file), copy);
  }
  pruneRuns(runsDir, params.keepRuns ?? 3);

  const migrated: MigratedFile[] = [];
  for (const [index, p] of pending.entries()) {
    const db = new DatabaseSync(join(params.dataDir, p.file));
    try {
      migrateDb(db, p.schema);
    } catch (err: unknown) {
      db.close();
      restoreRun(runDir, params.dataDir, migrated.map((m) => m.file));
      throw new MigrationRunError(p.file, err);
    }
    db.close();
    migrated.push({ file: p.file, from: p.from, to: p.to });
    params.onProgress?.({ file: p.file, done: index + 1, total: pending.length });
  }
  return { runDir, migrated };
}
