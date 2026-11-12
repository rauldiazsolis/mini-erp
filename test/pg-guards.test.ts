import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SERVER_DIR = join(import.meta.dirname, '..', 'src', 'server');
const SCRIPTS_DIR = join(import.meta.dirname, '..', 'scripts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(dir, file));
}

const FILES = [...sourceFiles(SERVER_DIR), ...sourceFiles(SCRIPTS_DIR)];

function filesMatching(pattern: RegExp): string[] {
  return FILES.filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(join(import.meta.dirname, '..'), file).replaceAll('\\', '/'))
    .sort();
}

describe('reglas de persistencia (AGENTS.md, "Persistencia")', () => {
  it('withSchema se llama en un solo archivo: nadie más elige un esquema', () => {
    expect(filesMatching(/\.withSchema\(/)).toEqual(['src/server/db/pg/database.ts']);
  });

  it('el pool se crea en un solo archivo', () => {
    expect(filesMatching(/new (pg\.)?Pool\(|new Kysely</)).toEqual(['src/server/db/pg/database.ts']);
  });

  it('columnas explícitas: sin selectAll ni returningAll', () => {
    expect(filesMatching(/\.(selectAll|returningAll)\(/)).toEqual([]);
  });

  it('search_path solo lo toca el runner de migraciones', () => {
    expect(filesMatching(/search_path/i)).toEqual(['src/server/db/pg/migrations/migrate.ts', 'src/server/db/pg/migrations/types.ts']);
  });

  it('lo de sistema no está en SQLite: nadie nombra system.sqlite ni el esquema viejo de sistema', () => {
    // migrations/system.ts (SQLite) queda solo para sus tests, hasta la fase 5
    expect(filesMatching(/system\.sqlite|system-db\.ts|migrations\/system\.ts|\bopenSystemDb\b|\bsystemDbDef\b/)).toEqual([]);
  });

  it('solo abren bases de SQLite los comercios, sus migraciones y el backup', () => {
    expect(filesMatching(/new DatabaseSync\(/)).toEqual([
      'src/server/backup/backup.ts',
      'src/server/db/migrations/run-migrations.ts',
      'src/server/db/tenant-db.ts',
      'src/server/db/tenant-manager.ts',
    ]);
  });
});
