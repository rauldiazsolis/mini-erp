import pg from 'pg';
import { e2eDatabaseUrl } from './system-db.ts';

/**
 * Servidor del e2e: arranca siempre de una base vacía (la de PostgreSQL `minierp_e2e`, nunca la de
 * desarrollo) y levanta el mini-erp en modo desarrollo, que sirve la copia local del POS.
 */
const dbUrl = e2eDatabaseUrl();
const dbName = decodeURIComponent(dbUrl.pathname.slice(1));
if (!/^minierp_e2e\w*$/.test(dbName)) {
  throw new Error(`El e2e solo recrea una base minierp_e2e…, no "${dbName}"`);
}
const adminUrl = new URL(dbUrl);
adminUrl.pathname = '/postgres';

// Vacía y con el orden por bytes, como producción y los tests (`test/helpers/pg-admin.ts`)
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C.UTF-8'`);
} finally {
  await admin.end();
}

process.env.DATABASE_URL = dbUrl.toString();
await import('../src/server/server.ts');
