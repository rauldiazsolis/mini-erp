import pg from 'pg';

/**
 * El servidor de PostgreSQL de los tests: `TEST_DATABASE_URL` apunta a una base de mantenimiento
 * (por omisión, `postgres` en localhost) con un rol que puede crear bases. Nunca es `DATABASE_URL`:
 * los tests crean y borran bases `minierp_test_*`, y la de desarrollo no se toca.
 */
export const TEST_ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://minierp:minierp@localhost:5432/postgres';
export const TEST_DB_PREFIX = 'minierp_test_';
export const TEMPLATE_DB = `${TEST_DB_PREFIX}template`;

export function testDbUrl(dbName: string): string {
  const url = new URL(TEST_ADMIN_URL);
  url.pathname = `/${dbName}`;
  return url.toString();
}

export async function withAdmin<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_ADMIN_URL });
  try {
    await client.connect();
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Los tests necesitan PostgreSQL (${TEST_ADMIN_URL.replace(/:[^:@/]*@/, ':***@')}): ${detail}. Ver "Verificación" en AGENTS.md.`,
      { cause: err },
    );
  }
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Orden por bytes (`C`), como en producción, para que el orden de un listado no dependa de la máquina. */
export async function createDb(client: pg.Client, dbName: string, template: string): Promise<void> {
  await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  const locale = template === 'template0' ? ` ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C.UTF-8'` : '';
  await client.query(`CREATE DATABASE "${dbName}" TEMPLATE "${template}"${locale}`);
}
