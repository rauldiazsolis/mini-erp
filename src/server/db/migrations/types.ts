import type { DatabaseSync } from 'node:sqlite';

/** Un cambio de esquema (#47). `up` corre dentro de una transacción que abre `migrateDb`: no abre otra. */
export type Migration = { version: number; name: string; up: (db: DatabaseSync) => void };

/** Línea de base más migraciones de un tipo de base. La línea de base no se toca nunca más. */
export type Schema = {
  kind: 'system' | 'tenant';
  baselineVersion: number;
  baselineSql: string;
  migrations: readonly Migration[];
};

export function currentVersion(schema: Schema): number {
  const last = schema.migrations.at(-1);
  return last === undefined ? schema.baselineVersion : last.version;
}
