import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tenantSchemaName } from '../db/pg/tenant-schema-name.ts';

/**
 * Backup de la base entera con `pg_dump -Fc` (#3, fase 6 de la migración a PostgreSQL). Lo corre
 * `mini-erp-backup.timer` cada noche y `deploy.sh` antes de activar una versión, así que puede correr
 * varias veces por día: cada corrida es un archivo con fecha y hora.
 *
 * - **Nombre**: `minierp-AAAA-MM-DDTHH-MM-SSZ.dump` (UTC, sin `:` para que sirva en cualquier sistema
 *   de archivos). Se escribe a `<nombre>.tmp` y se renombra al terminar: un archivo con nombre final
 *   siempre es un dump completo.
 * - **Demos**: un `--exclude-schema` por cada comercio de `system.demo_tenants`, con el nombre exacto
 *   entre comillas dobles (pg_dump lo lee como un patrón de psql: entre comillas es literal, sin
 *   pasar a minúsculas ni leer `*`, `?` o `.` como comodines). Nunca por prefijo: un comercio real puede llamarse `demo-…`.
 *   Las filas de sistema de las demos sí van.
 * - **Retención**: por la fecha del nombre, no por el `mtime` (que cambia al copiar o mover un
 *   archivo): los dumps de más de 7 días y los `.tmp` de corridas cortadas de más de un día. Solo
 *   después de un dump bueno: si pg_dump falla, lo viejo queda. Otros archivos no se tocan.
 */

export const RETENTION_DAYS = 7;
export const STALE_TMP_HOURS = 24;

const PREFIX = 'minierp-';
const DUMP = '.dump';
const TMP = '.tmp';
const NAME = /^minierp-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.dump(\.tmp)?$/;
const HOUR_MS = 60 * 60 * 1000;

export function backupFileName(now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  return `${PREFIX}${stamp}Z${DUMP}`;
}

/** La fecha de un nombre de backup (y si es un `.tmp`), o `undefined` si el archivo no es nuestro. */
export function parseBackupFileName(name: string): { at: Date; partial: boolean } | undefined {
  const match = NAME.exec(name);
  if (match === null) {
    return undefined;
  }
  const [, y, mo, d, h, mi, s, tmp] = match;
  const iso = `${String(y)}-${String(mo)}-${String(d)}T${String(h)}:${String(mi)}:${String(s)}Z`;
  const at = new Date(iso);
  // `new Date` acepta "2026-02-31": la vuelta a texto lo descarta
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 19) !== iso.slice(0, 19)) {
    return undefined;
  }
  return { at, partial: tmp !== undefined };
}

/** Los archivos de `names` que la retención borra a la hora `now`. */
export function filesToDelete(names: string[], now: Date): string[] {
  const dumpLimit = now.getTime() - RETENTION_DAYS * 24 * HOUR_MS;
  const tmpLimit = now.getTime() - STALE_TMP_HOURS * HOUR_MS;
  return names.filter((name) => {
    const parsed = parseBackupFileName(name);
    if (parsed === undefined) {
      return false;
    }
    return parsed.at.getTime() < (parsed.partial ? tmpLimit : dumpLimit);
  });
}

/** El nombre exacto de un esquema como patrón de pg_dump: entre comillas dobles, literal. */
export function excludeSchemaArg(schema: string): string {
  return `--exclude-schema="${schema.replace(/"/g, '""')}"`;
}

export function pgDumpArgs(p: { file: string; dbname: string; excludeSchemas: string[] }): string[] {
  return ['--format=custom', `--file=${p.file}`, ...p.excludeSchemas.map(excludeSchemaArg), `--dbname=${p.dbname}`];
}

/**
 * La URL para `--dbname` y el entorno de pg_dump: la contraseña sale de la URL y va por
 * `PGPASSWORD`, porque los argumentos de un proceso los ve cualquier usuario con `ps`.
 */
export function pgConnection(url: string): { dbname: string; env: Record<string, string> } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { dbname: url, env: {} };
  }
  if (parsed.password === '') {
    return { dbname: url, env: {} };
  }
  const password = decodeURIComponent(parsed.password);
  parsed.password = '';
  return { dbname: parsed.toString(), env: { PGPASSWORD: password } };
}

/** Corre pg_dump sin shell; su stderr va al del proceso (el journal, con systemd). */
export function spawnPgDump(args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', args, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...env } });
    child.on('error', (err) => {
      reject(new Error(`no se pudo correr pg_dump: ${err.message}`, { cause: err }));
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pg_dump terminó con ${code === null ? `la señal ${String(signal)}` : `código ${String(code)}`}`));
      }
    });
  });
}

export type BackupDeps = {
  /** La de `DATABASE_URL`. */
  url: string;
  backupDir: string;
  now: () => Date;
  /** Los ids de `system.demo_tenants`. */
  demoTenantIds: () => Promise<string[]>;
  /** Por omisión, `spawnPgDump`. */
  pgDump?: ((args: string[], env: Record<string, string>) => Promise<void>) | undefined;
  /** Por omisión, `console.log`. */
  log?: ((line: string) => void) | undefined;
};

export type BackupResult = { file: string; bytes: number; excludedSchemas: number; deleted: string[] };

export async function runBackup(deps: BackupDeps): Promise<BackupResult> {
  const log = deps.log ?? ((line: string) => {
    console.log(line);
  });
  const pgDump = deps.pgDump ?? spawnPgDump;
  const now = deps.now();

  const excludeSchemas = (await deps.demoTenantIds()).map(tenantSchemaName).sort();
  await mkdir(deps.backupDir, { recursive: true });
  const file = join(deps.backupDir, backupFileName(now));
  const tmp = `${file}${TMP}`;
  const { dbname, env } = pgConnection(deps.url);

  try {
    await pgDump(pgDumpArgs({ file: tmp, dbname, excludeSchemas }), env);
    await rename(tmp, file);
  } catch (err: unknown) {
    await rm(tmp, { force: true });
    throw err;
  }
  const { size } = await stat(file);
  log(`[backup] ${file}: ${String(size)} B, ${String(excludeSchemas.length)} esquemas demo excluidos`);

  const deleted = filesToDelete(await readdir(deps.backupDir), now).sort();
  for (const name of deleted) {
    await rm(join(deps.backupDir, name), { force: true });
  }
  log(`[backup] retención: ${String(deleted.length)} borrado${deleted.length === 1 ? '' : 's'}${deleted.length > 0 ? ` (${deleted.join(', ')})` : ''}`);
  return { file, bytes: size, excludedSchemas: excludeSchemas.length, deleted };
}
