import { DatabaseSync } from 'node:sqlite';
import type { Schema } from '../../src/server/db/migrations/types.ts';

/** Una base como la dejaba la versión `version` del código (#47): línea de base y migraciones hasta ahí. */
export function createDbAtVersion(schema: Schema, version: number, path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(schema.baselineSql);
  for (const migration of schema.migrations) {
    if (migration.version <= version) {
      migration.up(db);
    }
  }
  db.exec(`PRAGMA user_version = ${String(version)}`);
  return db;
}
