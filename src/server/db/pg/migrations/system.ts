import { v1LineaDeBase } from './system/v1-linea-de-base.ts';
import type { SchemaMigrations } from './types.ts';

/** Migraciones del esquema `system`. Una nueva va al final, con la versión siguiente. */
export const SYSTEM_MIGRATIONS: SchemaMigrations = {
  kind: 'system',
  migrations: [v1LineaDeBase],
};
