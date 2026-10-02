import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkDb } from './migrations/migrate.ts';
import { TENANT_SCHEMA } from './migrations/tenant.ts';
import { currentVersion } from './migrations/types.ts';

export const TENANT_SCHEMA_VERSION = currentVersion(TENANT_SCHEMA);

/** Crea una base nueva en la versión actual o verifica que esté al día (#47): nunca migra datos. */
export function initTenantDb(db: DatabaseSync): void {
  checkDb(db, TENANT_SCHEMA);
}

export function openTenantDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  const db = new DatabaseSync(path);
  initTenantDb(db);
  return db;
}
