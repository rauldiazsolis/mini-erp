import pg from 'pg';
import { tenantSchemaName } from '../src/server/db/pg/tenant-schema-name.ts';

/** La base del e2e: `E2E_DATABASE_URL` o la local de siempre. Nunca `DATABASE_URL`, que es la de desarrollo. */
export function e2eDatabaseUrl(): URL {
  return new URL(process.env.E2E_DATABASE_URL ?? 'postgres://minierp:minierp@localhost:5432/minierp_e2e');
}

/**
 * Una consulta de solo lectura a la base del e2e (lo de sistema, en el esquema `system`).
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

/** Cuántas ventas tiene un comercio (su esquema `tenant_<id>`), de todas sus cajas o de un punto de venta. */
export async function salesOf(tenantId: string, pointOfSale?: string): Promise<number> {
  const sales = `${pg.escapeIdentifier(tenantSchemaName(tenantId))}.sales`;
  const rows =
    pointOfSale === undefined
      ? await querySystem<{ n: string }>(`SELECT count(*) AS n FROM ${sales}`)
      : await querySystem<{ n: string }>(`SELECT count(*) AS n FROM ${sales} WHERE point_of_sale = $1`, pointOfSale);
  return Number(rows[0]?.n ?? 0);
}

/** El precio de un producto de un comercio; `null` si no existe. */
export async function productPrice(tenantId: string, productId: string): Promise<number | null> {
  const products = `${pg.escapeIdentifier(tenantSchemaName(tenantId))}.products`;
  const rows = await querySystem<{ price: string }>(`SELECT price FROM ${products} WHERE id = $1`, productId);
  const price = rows[0]?.price;
  return price === undefined ? null : Number(price);
}
