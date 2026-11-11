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
});
