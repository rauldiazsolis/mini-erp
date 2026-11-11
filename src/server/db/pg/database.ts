import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { SystemDatabase } from './system-schema.ts';
import type { TenantDatabase } from './tenant-schema.ts';
import { SYSTEM_SCHEMA_NAME, tenantSchemaName } from './tenant-schema-name.ts';

/** La instancia de producción tiene 512 MB: PostgreSQL y Node comparten esa memoria. */
export const POOL_MAX = 10;

const { INT8, NUMERIC, DATE, TIMESTAMPTZ } = pg.types.builtins;
type TextParser = (value: string) => unknown;
const parseTimestamptz = pg.types.getTypeParser(TIMESTAMPTZ) as (value: string) => Date;

/**
 * Cómo llegan los valores a TypeScript (los tipos están en `columns.ts`):
 * - `numeric` y `bigint`, como `number`: es lo que viaja en el JSON del contrato del POS.
 * - `timestamptz`, como texto ISO en UTC, igual que `new Date().toISOString()`.
 * - `date`, como `YYYY-MM-DD`: un día argentino no tiene hora ni zona.
 */
const PARSERS = new Map<number, TextParser>([
  [INT8, (value) => Number(value)],
  [NUMERIC, (value) => Number(value)],
  [DATE, (value) => value],
  [TIMESTAMPTZ, (value) => parseTimestamptz(value).toISOString()],
]);

const defaultParser = pg.types.getTypeParser as (oid: number, format?: 'text' | 'binary') => TextParser;

function typeParser(oid: number, format: 'text' | 'binary' = 'text'): TextParser {
  const own = format === 'text' ? PARSERS.get(oid) : undefined;
  return own ?? defaultParser(oid, format);
}

/** Los parsers van en el pool, no en `pg.types` global: no cambian a quien use `pg` por su cuenta. */
const TYPES: pg.CustomTypesConfig = { getTypeParser: typeParser as typeof pg.types.getTypeParser };

export type DatabaseOptions = {
  connectionString: string;
  /** Conexiones del pool; por omisión `POOL_MAX`. Los tests usan menos. */
  max?: number | undefined;
  /** Parámetros de sesión de PostgreSQL (`-c nombre=valor`), para los tests. */
  options?: string | undefined;
};

/**
 * La base del mini-erp: un pool, el esquema `system` y un esquema por comercio.
 * `system` y `forTenant` son los únicos que llaman a `withSchema` (lo vigila `test/pg-guards.test.ts`).
 */
export type Database = {
  /** Sin esquema: solo para migraciones y mantenimiento. Los servicios nunca lo reciben. */
  root: Kysely<unknown>;
  /** Lo global, acotado al esquema `system`. */
  system: Kysely<SystemDatabase>;
  /** Lo de un comercio, acotado a su esquema: lo que reciben los servicios de comercio. */
  forTenant: (tenantId: string) => Kysely<TenantDatabase>;
  /** Cierra el pool. Scripts y tests lo llaman al terminar. */
  destroy: () => Promise<void>;
};

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    types: TYPES,
    ...(options.options === undefined ? {} : { options: options.options }),
  });
  // Un error en una conexión ociosa (el servidor se reinició) no tiene que tumbar el proceso.
  pool.on('error', (err) => {
    console.error('[db] error en una conexión ociosa:', err.message);
  });
  const root = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  return {
    root,
    system: root.withSchema(SYSTEM_SCHEMA_NAME),
    forTenant: (tenantId) => root.withSchema(tenantSchemaName(tenantId)),
    destroy: () => root.destroy(),
  };
}

/** La URL de la base, de `DATABASE_URL`. Sin valor por omisión: una base equivocada es peor que no arrancar. */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('Falta DATABASE_URL (por ejemplo, postgres://usuario:clave@localhost:5432/minierp)');
  }
  return url;
}
