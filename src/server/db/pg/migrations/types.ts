import type { Kysely } from 'kysely';

/**
 * Un cambio de esquema. `up` recibe una conexión con el `search_path` puesto en su esquema (`system`
 * o `tenant_<id>`): escribe los nombres de tabla sin calificar y no abre transacciones.
 *
 * Por omisión corre dentro de una transacción, junto con su fila de `schema_migrations`. Con
 * `transactional: false` corre afuera (lo pide `CREATE INDEX CONCURRENTLY`): tiene que poder
 * repetirse (`IF NOT EXISTS`), porque si se corta por la mitad se vuelve a correr entera.
 */
export type Migration = {
  version: number;
  name: string;
  transactional?: false;
  up: (db: Kysely<unknown>) => Promise<void>;
};

/** Las migraciones de un tipo de esquema, en orden. La v1 es la línea de base y no se toca más. */
export type SchemaMigrations = {
  kind: 'system' | 'tenant';
  migrations: readonly Migration[];
};

export function currentVersion(schema: SchemaMigrations): number {
  return schema.migrations.at(-1)?.version ?? 0;
}
