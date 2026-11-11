import { v1LineaDeBase } from './tenant/v1-linea-de-base.ts';
import type { SchemaMigrations } from './types.ts';

/** Migraciones del esquema de cada comercio. Una nueva va al final, con la versión siguiente. */
export const TENANT_MIGRATIONS: SchemaMigrations = {
  kind: 'tenant',
  migrations: [v1LineaDeBase],
};
