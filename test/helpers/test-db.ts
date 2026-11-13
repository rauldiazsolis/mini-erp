import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createDatabase, type Database } from '../../src/server/db/pg/database.ts';
import { SYSTEM_SCHEMA_NAME, TENANT_SCHEMA_PREFIX } from '../../src/server/db/pg/tenant-schema-name.ts';
import { createDb, TEMPLATE_DB, TEST_DB_PREFIX, testDbUrl, withAdmin } from './pg-admin.ts';

/** Vacía `system` y borra los esquemas de comercio: deja la base como recién clonada. */
export async function resetTestDb(db: Database): Promise<void> {
  const schemas = await sql<{ nspname: string }>`
    SELECT nspname FROM pg_namespace WHERE nspname LIKE ${`${TENANT_SCHEMA_PREFIX.replace(/_/g, '\\_')}%`}`.execute(db.root);
  for (const schema of schemas.rows) {
    await sql`DROP SCHEMA ${sql.id(schema.nspname)} CASCADE`.execute(db.root);
  }
  // Solo las tablas con filas: un TRUNCATE de las 27 tarda mucho más que lo que tarda un test.
  const tables = await sql<{ tablename: string }>`
    SELECT tablename FROM pg_tables WHERE schemaname = ${SYSTEM_SCHEMA_NAME} AND tablename <> 'schema_migrations'`.execute(db.root);
  const probes = tables.rows.map(
    (table) => sql`SELECT ${table.tablename}::text AS tablename WHERE EXISTS (SELECT 1 FROM ${sql.id(SYSTEM_SCHEMA_NAME, table.tablename)})`,
  );
  if (probes.length === 0) {
    return;
  }
  const used = await sql<{ tablename: string }>`${sql.join(probes, sql` UNION ALL `)}`.execute(db.root);
  if (used.rows.length > 0) {
    const list = sql.join(used.rows.map((table) => sql.id(SYSTEM_SCHEMA_NAME, table.tablename)));
    await sql`TRUNCATE ${list} RESTART IDENTITY CASCADE`.execute(db.root);
  }
}

/**
 * La base de PostgreSQL de un archivo de test: se clona de la plantilla al empezar el archivo (una
 * por worker de Vitest, así los archivos en paralelo no se pisan), se vacía antes de cada test y el
 * pool se cierra al terminar. Se llama una vez, arriba del archivo:
 *
 * ```ts
 * const db = setupTestDb();
 * it('…', async () => { await db().system.selectFrom('users')… });
 * ```
 */
export function setupTestDb(): () => Database {
  const dbName = `${TEST_DB_PREFIX}w${process.env.VITEST_POOL_ID ?? '0'}`;
  let db: Database | undefined;

  beforeAll(async () => {
    await withAdmin((client) => createDb(client, dbName, TEMPLATE_DB));
    // Los tests no necesitan que un commit llegue al disco.
    db = createDatabase({ connectionString: testDbUrl(dbName), max: 5, options: '-c synchronous_commit=off' });
  });

  beforeEach(async () => {
    if (db !== undefined) {
      await resetTestDb(db);
    }
  });

  afterAll(async () => {
    await db?.destroy();
    db = undefined;
  });

  return () => {
    if (db === undefined) {
      throw new Error('setupTestDb(): la base todavía no está lista (¿se llamó fuera de un test?)');
    }
    return db;
  };
}
