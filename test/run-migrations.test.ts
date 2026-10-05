import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { readVersion } from '../src/server/db/migrations/migrate.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { currentVersion, type Schema } from '../src/server/db/migrations/types.ts';
import { MigrationRunError, PRE_MIGRATION_DIR, restoreRun, runMigrations, type MigrationProgress } from '../src/server/db/migrations/run-migrations.ts';

let root = '';

/** Versiones de hoy y las de prueba (una más): el test no depende de cuántas migraciones reales haya. */
const S = currentVersion(SYSTEM_SCHEMA);
const T = currentVersion(TENANT_SCHEMA);
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Schemas de prueba: sistema v5 y comercio v3 sobre lo que crea el código de hoy. */
function schemasDePrueba(tenantUp?: (db: DatabaseSync) => void): { system: Schema; tenant: Schema } {
  return {
    system: { ...SYSTEM_SCHEMA, migrations: [...SYSTEM_SCHEMA.migrations, { version: S + 1, name: 'prueba', up: (db) => { db.exec('CREATE TABLE prueba (id TEXT)'); } }] },
    tenant: {
      ...TENANT_SCHEMA,
      migrations: [
        ...TENANT_SCHEMA.migrations,
        { version: T + 1, name: 'columna', up: tenantUp ?? ((db) => { db.exec('ALTER TABLE products ADD COLUMN prueba TEXT'); }) },
      ],
    },
  };
}

/** Un directorio de datos con el código de hoy: sistema v4, comercios v2 y una demo. */
function sembrar(ids: string[] = ['kiosco-real']): string {
  root = mkdtempSync(join(tmpdir(), 'mini-erp-migr-'));
  const dataDir = join(root, 'data');
  const systemDb = openSystemDb(join(dataDir, 'system.sqlite'));
  const tenants = new TenantManager(systemDb, { baseDir: join(dataDir, 'tenants') });
  for (const id of ids) {
    tenants.createTenant({ id, slug: id, name: id });
  }
  tenants.createTenant({ id: 'demo-abc', slug: 'demo-abc', name: 'Demo' });
  const at = new Date().toISOString();
  systemDb.prepare('INSERT INTO demo_tenants (tenant_id, template, last_full_reset_at) VALUES (?, ?, ?)').run('demo-abc', 'kiosco', at);
  const kiosco = tenants.getTenantDb(ids[0] ?? 'kiosco-real');
  kiosco.prepare('INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'SKU1', 'Yerba', at, at);
  tenants.closeAll();
  systemDb.close();
  return dataDir;
}

function versionDe(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return readVersion(db);
  } finally {
    db.close();
  }
}

const NOW = new Date('2026-10-02T14:30:00Z');

describe('runMigrations (#47)', () => {
  it('sin base de sistema no hace nada', () => {
    root = mkdtempSync(join(tmpdir(), 'mini-erp-migr-'));
    expect(runMigrations({ dataDir: join(root, 'vacio'), now: NOW })).toEqual({ migrated: [] });
  });

  it('sin nada pendiente no copia nada', () => {
    const dataDir = sembrar();
    expect(runMigrations({ dataDir, now: NOW })).toEqual({ migrated: [] });
    expect(existsSync(join(dataDir, PRE_MIGRATION_DIR))).toBe(false);
  });

  it('migra sistema, comercios y demos, conserva los datos y avisa el progreso', () => {
    const dataDir = sembrar();
    const progreso: MigrationProgress[] = [];
    const result = runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba(), onProgress: (p) => progreso.push(p) });

    expect(result.migrated).toEqual([
      { file: 'system.sqlite', from: S, to: S + 1 },
      { file: 'tenants/demo-abc.sqlite', from: T, to: T + 1 },
      { file: 'tenants/kiosco-real.sqlite', from: T, to: T + 1 },
    ]);
    expect(progreso.map((p) => `${p.file} ${String(p.done)}/${String(p.total)}`)).toEqual([
      'system.sqlite 1/3', 'tenants/demo-abc.sqlite 2/3', 'tenants/kiosco-real.sqlite 3/3',
    ]);
    expect(versionDe(join(dataDir, 'system.sqlite'))).toBe(S + 1);
    const kiosco = new DatabaseSync(join(dataDir, 'tenants', 'kiosco-real.sqlite'));
    expect(kiosco.prepare('SELECT name, prueba FROM products').all()).toEqual([{ name: 'Yerba', prueba: null }]);
    kiosco.close();
  });

  it('copia antes de migrar, en la versión vieja, solo lo pendiente', () => {
    const dataDir = sembrar();
    const { runDir } = runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba() });
    expect(runDir).toBe(join(dataDir, PRE_MIGRATION_DIR, '2026-10-02T14-30-00'));
    expect(versionDe(join(runDir ?? '', 'system.sqlite'))).toBe(S);
    expect(versionDe(join(runDir ?? '', 'tenants', 'kiosco-real.sqlite'))).toBe(T);
    expect(readdirSync(join(runDir ?? '', 'tenants')).sort()).toEqual(['demo-abc.sqlite', 'kiosco-real.sqlite']);
  });

  it('deja las últimas keepRuns corridas', () => {
    const dataDir = sembrar();
    for (const vieja of ['2026-09-01T00-00-00', '2026-09-02T00-00-00', '2026-09-03T00-00-00']) {
      mkdirSync(join(dataDir, PRE_MIGRATION_DIR, vieja), { recursive: true });
    }
    runMigrations({ dataDir, now: NOW, keepRuns: 3, schemas: schemasDePrueba() });
    expect(readdirSync(join(dataDir, PRE_MIGRATION_DIR)).sort()).toEqual([
      '2026-09-02T00-00-00', '2026-09-03T00-00-00', '2026-10-02T14-30-00',
    ]);
  });

  it('una base más nueva que el código frena todo sin tocar nada', () => {
    const dataDir = sembrar();
    const kiosco = new DatabaseSync(join(dataDir, 'tenants', 'kiosco-real.sqlite'));
    kiosco.exec('PRAGMA user_version = 9');
    kiosco.close();
    expect(() => runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba() })).toThrow(/kiosco-real.*más nueva/s);
    expect(versionDe(join(dataDir, 'system.sqlite'))).toBe(S);
    expect(existsSync(join(dataDir, PRE_MIGRATION_DIR))).toBe(false);
  });

  it('si un comercio falla, restaura lo ya migrado y todo queda como estaba', () => {
    const dataDir = sembrar(['a-ok', 'b-falla']);
    const falla = new DatabaseSync(join(dataDir, 'tenants', 'b-falla.sqlite'));
    falla.prepare('INSERT INTO tenant_settings (key, value) VALUES (?, ?)').run('romper', '1');
    falla.close();
    const schemas = schemasDePrueba((db) => {
      db.exec('ALTER TABLE products ADD COLUMN prueba TEXT');
      if (db.prepare("SELECT 1 FROM tenant_settings WHERE key = 'romper'").get() !== undefined) {
        throw new Error('pedido de romper');
      }
    });

    expect(() => runMigrations({ dataDir, now: NOW, schemas })).toThrow(MigrationRunError);
    expect(versionDe(join(dataDir, 'system.sqlite'))).toBe(S);
    expect(versionDe(join(dataDir, 'tenants', 'a-ok.sqlite'))).toBe(T);
    expect(versionDe(join(dataDir, 'tenants', 'b-falla.sqlite'))).toBe(T);
    const system = new DatabaseSync(join(dataDir, 'system.sqlite'));
    expect(system.prepare("SELECT name FROM sqlite_master WHERE name = 'prueba'").get()).toBeUndefined();
    system.close();
  });

  it('el error dice qué base y qué migración fallaron', () => {
    const dataDir = sembrar(['b-falla']);
    const schemas = schemasDePrueba(() => { throw new Error('pedido de romper'); });
    // Orden: sistema, b-falla, demo-abc. Falla b-falla y el sistema vuelve a v4
    expect(() => runMigrations({ dataDir, now: NOW, schemas })).toThrow(
      `tenants/b-falla.sqlite, migración v${String(T + 1)} columna: pedido de romper`,
    );
    expect(versionDe(join(dataDir, 'system.sqlite'))).toBe(S);
  });

  it('restoreRun copia encima y borra -wal y -shm', () => {
    const dataDir = sembrar();
    const { runDir } = runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba() });
    const file = join(dataDir, 'system.sqlite');
    writeFileSync(`${file}-wal`, 'basura');
    writeFileSync(`${file}-shm`, 'basura');
    restoreRun(runDir ?? '', dataDir, ['system.sqlite']);
    expect(versionDe(file)).toBe(S);
    expect(existsSync(`${file}-wal`)).toBe(false);
    expect(existsSync(`${file}-shm`)).toBe(false);
  });
});
