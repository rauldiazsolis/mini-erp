import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { demoTenantIds } from '../demo/demo-tenant-ids.ts';

const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;

/** `VACUUM INTO`: copia consistente aunque el servidor esté escribiendo. */
async function copyDb(from: string, to: string): Promise<void> {
  const db = new DatabaseSync(from, { readOnly: true, timeout: 10_000 });
  try {
    db.prepare('VACUUM INTO ?').run(to);
  } finally {
    db.close();
  }
}

/**
 * Backup nocturno (#3): la base de cada comercio real (las demos no) en `<backupDir>/<día>/tenants/`.
 * La lista de comercios sale de PostgreSQL. Lo de sistema ya no está en SQLite: su backup es un
 * `pg_dump` (fase 6 de la migración a PostgreSQL), que este script no hace.
 * Reemplaza la carpeta del día y deja las últimas `keep`.
 */
export async function backupAll(params: {
  system: Kysely<SystemDatabase>;
  dataDir: string;
  backupDir: string;
  now: Date;
  keep: number;
}): Promise<{
  dir: string;
  tenants: string[];
}> {
  const rows = await params.system
    .selectFrom('tenants as t')
    .select('t.id')
    .where('t.id', 'not in', demoTenantIds(params.system))
    .orderBy('t.id')
    .execute();

  const dir = join(params.backupDir, params.now.toISOString().slice(0, 10));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'tenants'), { recursive: true });

  const tenants: string[] = [];
  for (const { id } of rows) {
    const file = join(params.dataDir, 'tenants', `${id}.sqlite`);
    if (existsSync(file)) {
      await copyDb(file, join(dir, 'tenants', `${id}.sqlite`));
      tenants.push(id);
    }
  }

  const days = readdirSync(params.backupDir)
    .filter((d) => DAY_DIR.test(d))
    .sort();
  for (const old of days.slice(0, Math.max(0, days.length - params.keep))) {
    rmSync(join(params.backupDir, old), { recursive: true, force: true });
  }
  return { dir, tenants };
}
