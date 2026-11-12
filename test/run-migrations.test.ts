import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { readVersion } from '../src/server/db/migrations/migrate.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { currentVersion, type Schema } from '../src/server/db/migrations/types.ts';
import { MigrationRunError, PRE_MIGRATION_DIR, restoreRun, runMigrations, type MigrationProgress } from '../src/server/db/migrations/run-migrations.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

let root = '';

/** Versión de hoy y la de prueba (una más): el test no depende de cuántas migraciones reales haya. */
const T = currentVersion(TENANT_SCHEMA);
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Schema de prueba: el de comercio de hoy con una migración más. Lo de sistema está en PostgreSQL. */
function schemasDePrueba(tenantUp?: (db: DatabaseSync) => void): { tenant: Schema } {
  return {
    tenant: {
      ...TENANT_SCHEMA,
      migrations: [
        ...TENANT_SCHEMA.migrations,
        { version: T + 1, name: 'columna', up: tenantUp ?? ((db) => { db.exec('ALTER TABLE products ADD COLUMN prueba TEXT'); }) },
      ],
    },
  };
}

/** Un directorio de datos con el código de hoy: comercios al día y una demo, sin `system.sqlite`. */
async function sembrar(ids: string[] = ['kiosco-real']): Promise<string> {
  root = mkdtempSync(join(tmpdir(), 'mini-erp-migr-'));
  const dataDir = join(root, 'data');
  const tenants = new TenantManager(pgDb().system, { baseDir: join(dataDir, 'tenants') });
  for (const id of ids) {
    await tenants.createTenant({ id, slug: id, name: id });
  }
  await tenants.createTenant({ id: 'demo-abc', slug: 'demo-abc', name: 'Demo' });
  const at = new Date().toISOString();
  const kiosco = tenants.getTenantDb(ids[0] ?? 'kiosco-real');
  kiosco.prepare('INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'SKU1', 'Yerba', at, at);
  tenants.closeAll();
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
  it('sin comercios no hace nada', () => {
    root = mkdtempSync(join(tmpdir(), 'mini-erp-migr-'));
    expect(runMigrations({ dataDir: join(root, 'vacio'), now: NOW })).toEqual({ migrated: [] });
  });

  it('sin nada pendiente no copia nada', async () => {
    const dataDir = await sembrar();
    expect(runMigrations({ dataDir, now: NOW })).toEqual({ migrated: [] });
    expect(existsSync(join(dataDir, PRE_MIGRATION_DIR))).toBe(false);
  });

  it('migra comercios y demos, conserva los datos y avisa el progreso', async () => {
    const dataDir = await sembrar();
    const progreso: MigrationProgress[] = [];
    const result = runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba(), onProgress: (p) => progreso.push(p) });

    expect(result.migrated).toEqual([
      { file: 'tenants/demo-abc.sqlite', from: T, to: T + 1 },
      { file: 'tenants/kiosco-real.sqlite', from: T, to: T + 1 },
    ]);
    expect(progreso.map((p) => `${p.file} ${String(p.done)}/${String(p.total)}`)).toEqual([
      'tenants/demo-abc.sqlite 1/2', 'tenants/kiosco-real.sqlite 2/2',
    ]);
    expect(existsSync(join(dataDir, 'system.sqlite'))).toBe(false);
    const kiosco = new DatabaseSync(join(dataDir, 'tenants', 'kiosco-real.sqlite'));
    expect(kiosco.prepare('SELECT name, prueba FROM products').all()).toEqual([{ name: 'Yerba', prueba: null }]);
    kiosco.close();
  });

  it('copia antes de migrar, en la versión vieja, solo lo pendiente', async () => {
    const dataDir = await sembrar();
    const { runDir } = runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba() });
    expect(runDir).toBe(join(dataDir, PRE_MIGRATION_DIR, '2026-10-02T14-30-00'));
    expect(versionDe(join(runDir ?? '', 'tenants', 'kiosco-real.sqlite'))).toBe(T);
    expect(readdirSync(join(runDir ?? '', 'tenants')).sort()).toEqual(['demo-abc.sqlite', 'kiosco-real.sqlite']);
  });

  it('deja las últimas keepRuns corridas', async () => {
    const dataDir = await sembrar();
    for (const vieja of ['2026-09-01T00-00-00', '2026-09-02T00-00-00', '2026-09-03T00-00-00']) {
      mkdirSync(join(dataDir, PRE_MIGRATION_DIR, vieja), { recursive: true });
    }
    runMigrations({ dataDir, now: NOW, keepRuns: 3, schemas: schemasDePrueba() });
    expect(readdirSync(join(dataDir, PRE_MIGRATION_DIR)).sort()).toEqual([
      '2026-09-02T00-00-00', '2026-09-03T00-00-00', '2026-10-02T14-30-00',
    ]);
  });

  it('una base más nueva que el código frena todo sin tocar nada', async () => {
    const dataDir = await sembrar();
    const kiosco = new DatabaseSync(join(dataDir, 'tenants', 'kiosco-real.sqlite'));
    kiosco.exec('PRAGMA user_version = 9');
    kiosco.close();
    expect(() => runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba() })).toThrow(/kiosco-real.*más nueva/s);
    expect(versionDe(join(dataDir, 'tenants', 'demo-abc.sqlite'))).toBe(T);
    expect(existsSync(join(dataDir, PRE_MIGRATION_DIR))).toBe(false);
  });

  it('si un comercio falla, restaura lo ya migrado y todo queda como estaba', async () => {
    const dataDir = await sembrar(['a-ok', 'b-falla']);
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
    expect(versionDe(join(dataDir, 'tenants', 'a-ok.sqlite'))).toBe(T);
    expect(versionDe(join(dataDir, 'tenants', 'b-falla.sqlite'))).toBe(T);
    const ok = new DatabaseSync(join(dataDir, 'tenants', 'a-ok.sqlite'));
    expect(ok.prepare("SELECT 1 FROM pragma_table_info('products') WHERE name = 'prueba'").get()).toBeUndefined();
    ok.close();
  });

  it('el error dice qué base y qué migración fallaron', async () => {
    const dataDir = await sembrar(['b-falla']);
    const schemas = schemasDePrueba(() => { throw new Error('pedido de romper'); });
    // Orden: b-falla, demo-abc. Falla la primera y no se toca la otra
    expect(() => runMigrations({ dataDir, now: NOW, schemas })).toThrow(
      `tenants/b-falla.sqlite, migración v${String(T + 1)} columna: pedido de romper`,
    );
    expect(versionDe(join(dataDir, 'tenants', 'demo-abc.sqlite'))).toBe(T);
  });

  it('restoreRun copia encima y borra -wal y -shm', async () => {
    const dataDir = await sembrar();
    const { runDir } = runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba() });
    const file = join(dataDir, 'tenants', 'kiosco-real.sqlite');
    expect(versionDe(file)).toBe(T + 1);
    writeFileSync(`${file}-wal`, 'basura');
    writeFileSync(`${file}-shm`, 'basura');
    restoreRun(runDir ?? '', dataDir, ['tenants/kiosco-real.sqlite']);
    expect(versionDe(file)).toBe(T);
    expect(existsSync(`${file}-wal`)).toBe(false);
    expect(existsSync(`${file}-shm`)).toBe(false);
  });
});
