import { createDatabase } from '../../src/server/db/pg/database.ts';
import { migrateSystem } from '../../src/server/db/pg/migrations/migrate.ts';
import { createDb, dropDb, TEMPLATE_DB, TEST_DB_PREFIX, testDbUrl, withAdmin } from './pg-admin.ts';

async function dropTestDbs(): Promise<void> {
  await withAdmin(async (client) => {
    const { rows } = await client.query<{ datname: string }>('SELECT datname FROM pg_database WHERE datname LIKE $1', [
      `${TEST_DB_PREFIX.replace(/_/g, '\\_')}%`,
    ]);
    for (const row of rows) {
      await dropDb(client, row.datname);
    }
  });
}

/**
 * Antes de toda la suite: una base plantilla con el esquema `system` ya migrado. Cada archivo de
 * test que usa `setupTestDb()` clona de ahí la base de su worker, sin volver a migrar.
 */
export async function setup(): Promise<void> {
  await dropTestDbs();
  await withAdmin((client) => createDb(client, TEMPLATE_DB, 'template0'));
  const db = createDatabase({ connectionString: testDbUrl(TEMPLATE_DB), max: 1 });
  try {
    await migrateSystem(db.root);
  } finally {
    await db.destroy();
  }
}

export async function teardown(): Promise<void> {
  await dropTestDbs();
}
