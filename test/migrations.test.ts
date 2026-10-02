import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { assessDb, checkDb, migrateDb, readVersion, MigrationError, SchemaError } from '../src/server/db/migrations/migrate.ts';
import { currentVersion, type Schema } from '../src/server/db/migrations/types.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';

/** Schema de prueba: línea de base 1 con una tabla, v2 agrega una columna y v3 falla si se lo piden. */
const PRUEBA: Schema = {
  kind: 'tenant',
  baselineVersion: 1,
  baselineSql: 'CREATE TABLE cosas (id TEXT PRIMARY KEY, nombre TEXT NOT NULL);',
  migrations: [
    { version: 2, name: 'color', up: (db) => { db.exec("ALTER TABLE cosas ADD COLUMN color TEXT NOT NULL DEFAULT 'gris'"); } },
    {
      version: 3,
      name: 'rompe',
      up: (db) => {
        db.exec('CREATE TABLE a_medias (id TEXT)');
        const romper = db.prepare("SELECT 1 FROM cosas WHERE id = 'romper'").get();
        if (romper !== undefined) {
          throw new Error('pedido de romper');
        }
      },
    },
  ],
};

function baseEn(version: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(PRUEBA.baselineSql);
  for (const m of PRUEBA.migrations) {
    if (m.version <= version) m.up(db);
  }
  db.exec(`PRAGMA user_version = ${String(version)}`);
  return db;
}

const tablas = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe('migraciones de esquema (#47)', () => {
  it('las migraciones de cada schema son consecutivas desde la línea de base', () => {
    for (const schema of [SYSTEM_SCHEMA, TENANT_SCHEMA]) {
      schema.migrations.forEach((m, i) => {
        expect(m.version).toBe(schema.baselineVersion + i + 1);
      });
    }
    expect(SYSTEM_SCHEMA.baselineVersion).toBe(4);
    expect(TENANT_SCHEMA.baselineVersion).toBe(1);
  });

  it('una base nueva queda en la versión actual con todas las migraciones', () => {
    const db = new DatabaseSync(':memory:');
    expect(assessDb(db, PRUEBA)).toEqual({ kind: 'new' });
    expect(migrateDb(db, PRUEBA)).toEqual({ from: 0, to: 3, applied: [] });
    expect(readVersion(db)).toBe(3);
    expect(tablas(db)).toEqual(['a_medias', 'cosas']);
  });

  it('aplica las pendientes en orden y conserva los datos', () => {
    const db = baseEn(1);
    db.prepare('INSERT INTO cosas (id, nombre) VALUES (?, ?)').run('c1', 'Martillo');
    expect(assessDb(db, PRUEBA)).toEqual({ kind: 'behind', from: 1, to: 3 });
    expect(migrateDb(db, PRUEBA)).toEqual({ from: 1, to: 3, applied: ['v2 color', 'v3 rompe'] });
    expect(readVersion(db)).toBe(3);
    expect(db.prepare('SELECT nombre, color FROM cosas').all()).toEqual([{ nombre: 'Martillo', color: 'gris' }]);
  });

  it('una migración que falla deja la versión y los datos como estaban', () => {
    const db = baseEn(2);
    db.prepare('INSERT INTO cosas (id, nombre) VALUES (?, ?)').run('romper', 'x');
    expect(() => migrateDb(db, PRUEBA)).toThrow(MigrationError);
    expect(() => migrateDb(db, PRUEBA)).toThrow(/v3 rompe: pedido de romper/);
    expect(readVersion(db)).toBe(2);
    expect(tablas(db)).toEqual(['cosas']);
  });

  it('frena con una base anterior a la línea de base', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE vieja (id TEXT); PRAGMA user_version = 3');
    expect(() => assessDb(db, SYSTEM_SCHEMA)).toThrow(SchemaError);
    expect(() => assessDb(db, SYSTEM_SCHEMA)).toThrow(/anterior a la línea de base/);
  });

  it('frena con una base con tablas y sin versión', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE suelta (id TEXT)');
    expect(() => assessDb(db, PRUEBA)).toThrow(/sin versión/);
  });

  it('frena con una base más nueva que el código', () => {
    const db = baseEn(3);
    db.exec('PRAGMA user_version = 9');
    expect(() => migrateDb(db, PRUEBA)).toThrow(/más nueva \(v9\) que este código \(v3\)/);
  });

  it('checkDb crea una base nueva pero no migra una atrasada', () => {
    const nueva = new DatabaseSync(':memory:');
    checkDb(nueva, PRUEBA);
    expect(readVersion(nueva)).toBe(currentVersion(PRUEBA));

    const atrasada = baseEn(1);
    expect(() => { checkDb(atrasada, PRUEBA); }).toThrow(/migraciones pendientes \(v1 → v3\)/);
    expect(readVersion(atrasada)).toBe(1);
  });
});
