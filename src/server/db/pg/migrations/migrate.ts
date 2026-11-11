import { sql, type Kysely } from 'kysely';
import { SYSTEM_SCHEMA_NAME, tenantSchemaName } from '../tenant-schema-name.ts';
import { SYSTEM_MIGRATIONS } from './system.ts';
import { TENANT_MIGRATIONS } from './tenant.ts';
import { currentVersion, type Migration, type SchemaMigrations } from './types.ts';

/** Un esquema que este código no puede abrir ni migrar (más nuevo que el código, con huecos). */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** Una migración que falló. Si era transaccional, su esquema quedó como estaba. */
export class MigrationError extends Error {
  schemaName: string;
  version: number;
  migration: string;
  constructor(schemaName: string, migration: Migration, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`migración v${String(migration.version)} ${migration.name} en ${schemaName}: ${detail}`, { cause });
    this.name = 'MigrationError';
    this.schemaName = schemaName;
    this.version = migration.version;
    this.migration = migration.name;
  }
}

export type MigrationResult = { schemaName: string; from: number; to: number; applied: string[] };

/** Un número cualquiera, fijo: el candado que deja migrar a un solo proceso a la vez. */
const MIGRATION_LOCK_ID = 4_100_047;

function describe(migration: Migration): string {
  return `v${String(migration.version)} ${migration.name}`;
}

async function appliedVersions(conn: Kysely<unknown>, schemaName: string): Promise<number[]> {
  await sql`CREATE SCHEMA IF NOT EXISTS ${sql.id(schemaName)}`.execute(conn);
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql.id(schemaName, 'schema_migrations')} (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`.execute(conn);
  const { rows } = await sql<{ version: number }>`
    SELECT version FROM ${sql.id(schemaName, 'schema_migrations')} ORDER BY version`.execute(conn);
  return rows.map((row) => row.version);
}

function pendingMigrations(schemaName: string, schema: SchemaMigrations, applied: number[]): Migration[] {
  const last = applied.at(-1) ?? 0;
  const target = currentVersion(schema);
  if (last > target) {
    throw new SchemaError(
      `El esquema ${schemaName} es más nuevo (v${String(last)}) que este código (v${String(target)}): ¿un rollback?`,
    );
  }
  const known = schema.migrations.filter((migration) => migration.version <= last).map((migration) => migration.version);
  if (known.length !== applied.length || known.some((version, i) => version !== applied[i])) {
    throw new SchemaError(`El esquema ${schemaName} tiene migraciones que este código no conoce o le faltan`);
  }
  return schema.migrations.filter((migration) => migration.version > last);
}

async function recordMigration(conn: Kysely<unknown>, schemaName: string, migration: Migration): Promise<void> {
  await sql`
    INSERT INTO ${sql.id(schemaName, 'schema_migrations')} (version, name)
    VALUES (${migration.version}, ${migration.name})`.execute(conn);
}

/**
 * Lleva un esquema a la versión del código, sobre **una** conexión (`conn`): cada migración corre
 * con el `search_path` en su esquema. Una transaccional va en su transacción junto con su fila de
 * `schema_migrations`; una `transactional: false` corre afuera y se anota al terminar.
 */
async function migrateSchemaOn(conn: Kysely<unknown>, schemaName: string, schema: SchemaMigrations): Promise<MigrationResult> {
  const applied = await appliedVersions(conn, schemaName);
  const pending = pendingMigrations(schemaName, schema, applied);
  const from = applied.at(-1) ?? 0;
  const done: string[] = [];
  for (const migration of pending) {
    try {
      if (migration.transactional === false) {
        await sql`SELECT set_config('search_path', ${schemaName}, false)`.execute(conn);
        try {
          await migration.up(conn);
        } finally {
          await sql`RESET search_path`.execute(conn);
        }
        await recordMigration(conn, schemaName, migration);
      } else {
        await conn.transaction().execute(async (trx) => {
          await sql`SELECT set_config('search_path', ${schemaName}, true)`.execute(trx);
          await migration.up(trx);
          await recordMigration(trx, schemaName, migration);
        });
      }
    } catch (err: unknown) {
      throw new MigrationError(schemaName, migration, err);
    }
    done.push(describe(migration));
  }
  return { schemaName, from, to: currentVersion(schema), applied: done };
}

const LOCK_RETRY_MS = 200;

/**
 * Corre `work` con una sola conexión y el candado de migraciones tomado.
 *
 * El candado se pide con `pg_try_advisory_lock` y se reintenta: una espera bloqueante
 * (`pg_advisory_lock`) es una consulta abierta, y `CREATE INDEX CONCURRENTLY` espera a que terminen
 * las consultas abiertas, así que dos procesos migrando a la vez se trabarían entre sí.
 */
async function withMigrationLock<T>(db: Kysely<unknown>, work: (conn: Kysely<unknown>) => Promise<T>): Promise<T> {
  return db.connection().execute(async (conn) => {
    for (;;) {
      const { rows } = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_ID}) AS locked`.execute(conn);
      if (rows[0]?.locked === true) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
    try {
      return await work(conn);
    } finally {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`.execute(conn);
    }
  });
}

/** Lleva un esquema a la versión del código. Para tests de migraciones; el arranque usa `migrateAll`. */
export async function migrateSchema(db: Kysely<unknown>, schemaName: string, schema: SchemaMigrations): Promise<MigrationResult> {
  return withMigrationLock(db, (conn) => migrateSchemaOn(conn, schemaName, schema));
}

/** Lo que el esquema `system` necesita de la base antes de su primera migración. */
async function ensureExtensions(conn: Kysely<unknown>): Promise<void> {
  // Búsquedas sin distinguir tildes (`searchable` en `sql-helpers.ts`). Es una extensión "trusted":
  // la crea el dueño de la base, sin superusuario.
  await sql`CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public`.execute(conn);
}

export async function migrateSystem(db: Kysely<unknown>): Promise<MigrationResult> {
  return withMigrationLock(db, async (conn) => {
    await ensureExtensions(conn);
    return migrateSchemaOn(conn, SYSTEM_SCHEMA_NAME, SYSTEM_MIGRATIONS);
  });
}

/**
 * Crea el esquema de un comercio nuevo en la versión del código. Corre por fuera de cualquier
 * transacción de quien llama (una migración puede no ser transaccional): si el alta del comercio
 * falla después, se deshace con `dropTenantSchema`.
 */
export async function createTenantSchema(db: Kysely<unknown>, tenantId: string): Promise<MigrationResult> {
  const schemaName = tenantSchemaName(tenantId);
  return withMigrationLock(db, async (conn) => {
    const { rows } = await sql`SELECT 1 FROM pg_namespace WHERE nspname = ${schemaName}`.execute(conn);
    if (rows.length > 0) {
      throw new SchemaError(`El esquema ${schemaName} ya existe`);
    }
    try {
      return await migrateSchemaOn(conn, schemaName, TENANT_MIGRATIONS);
    } catch (err: unknown) {
      await sql`DROP SCHEMA IF EXISTS ${sql.id(schemaName)} CASCADE`.execute(conn);
      throw err;
    }
  });
}

/** Borra el esquema de un comercio con todo lo que tiene. */
export async function dropTenantSchema(db: Kysely<unknown>, tenantId: string): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS ${sql.id(tenantSchemaName(tenantId))} CASCADE`.execute(db);
}

/**
 * La migración del arranque: `system` y después el esquema de cada comercio de `system.tenants`,
 * con el candado tomado todo el tiempo. Corta en la primera que falla: lo ya migrado queda migrado
 * (cada migración es Expand & Contract, así que el código anterior sigue andando con ese esquema).
 */
export async function migrateAll(
  db: Kysely<unknown>,
  onProgress?: (result: MigrationResult, done: number, total: number) => void,
): Promise<MigrationResult[]> {
  return withMigrationLock(db, async (conn) => {
    await ensureExtensions(conn);
    const systemResult = await migrateSchemaOn(conn, SYSTEM_SCHEMA_NAME, SYSTEM_MIGRATIONS);
    const results = [systemResult];
    const tenants = await sql<{ id: string }>`
      SELECT id FROM ${sql.id(SYSTEM_SCHEMA_NAME, 'tenants')} ORDER BY seq`.execute(conn);
    const total = tenants.rows.length + 1;
    onProgress?.(systemResult, 1, total);
    for (const tenant of tenants.rows) {
      const result = await migrateSchemaOn(conn, tenantSchemaName(tenant.id), TENANT_MIGRATIONS);
      results.push(result);
      onProgress?.(result, results.length, total);
    }
    return results;
  });
}
