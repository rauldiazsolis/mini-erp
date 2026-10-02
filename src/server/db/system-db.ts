import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkDb } from './migrations/migrate.ts';
import { SYSTEM_SCHEMA } from './migrations/system.ts';
import { currentVersion } from './migrations/types.ts';

export const SYSTEM_SCHEMA_VERSION = currentVersion(SYSTEM_SCHEMA);

/** Crea una base nueva en la versión actual o verifica que esté al día (#47): nunca migra datos. */
export function initSystemDb(db: DatabaseSync): void {
  checkDb(db, SYSTEM_SCHEMA);
}

export function openSystemDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  const db = new DatabaseSync(path);
  initSystemDb(db);
  return db;
}
