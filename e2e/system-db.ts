import pg from 'pg';

/** La base del e2e: `E2E_DATABASE_URL` o la local de siempre. Nunca `DATABASE_URL`, que es la de desarrollo. */
export function e2eDatabaseUrl(): URL {
  return new URL(process.env.E2E_DATABASE_URL ?? 'postgres://minierp:minierp@localhost:5432/minierp_e2e');
}

/**
 * Una consulta de solo lectura a lo de sistema (esquema `system` de PostgreSQL) de la base del e2e.
 * Abre y cierra su cliente: el test no le deja conexiones colgadas al servidor.
 */
export async function querySystem<T extends pg.QueryResultRow>(sql: string, ...params: string[]): Promise<T[]> {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl().toString() });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}
