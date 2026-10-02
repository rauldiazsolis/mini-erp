import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { currentVersion } from '../src/server/db/migrations/types.ts';
import { readVersion } from '../src/server/db/migrations/migrate.ts';
import type { MigrationProgress } from '../src/server/db/migrations/run-migrations.ts';
import { runMigrationsInWorker } from '../src/server/db/migrations/worker-runner.ts';
import { createDbAtVersion } from './helpers/db-at-version.ts';

let root = '';
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Sistema al día y un comercio en v1 (como el de producción antes de la 0.4.0), con un producto. */
function sembrar(tenantVersion = 1): string {
  root = mkdtempSync(join(tmpdir(), 'mini-erp-worker-'));
  const dataDir = join(root, 'data');
  const systemDb = openSystemDb(join(dataDir, 'system.sqlite'));
  systemDb.prepare('INSERT INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)').run('kiosco', 'kiosco', 'Kiosco', 'active', new Date().toISOString());
  systemDb.close();
  mkdirSync(join(dataDir, 'tenants'), { recursive: true });
  const tenant = createDbAtVersion(TENANT_SCHEMA, 1, join(dataDir, 'tenants', 'kiosco.sqlite'));
  const at = new Date().toISOString();
  tenant.prepare('INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'SKU1', 'Yerba', at, at);
  tenant.exec(`PRAGMA user_version = ${String(tenantVersion)}`);
  tenant.close();
  return dataDir;
}

describe('runMigrationsInWorker (#47)', () => {
  it('migra en un worker real y avisa el progreso', async () => {
    const dataDir = sembrar();
    const progreso: MigrationProgress[] = [];
    const result = await runMigrationsInWorker(dataDir, (p) => { progreso.push(p); });

    expect(result.migrated).toEqual([{ file: 'tenants/kiosco.sqlite', from: 1, to: currentVersion(TENANT_SCHEMA) }]);
    expect(result.runDir).toBeDefined();
    expect(progreso).toEqual([{ file: 'tenants/kiosco.sqlite', done: 1, total: 1 }]);
    const db = new DatabaseSync(join(dataDir, 'tenants', 'kiosco.sqlite'));
    expect(readVersion(db)).toBe(currentVersion(TENANT_SCHEMA));
    expect(db.prepare('SELECT name FROM products').all()).toEqual([{ name: 'Yerba' }]);
    db.close();
  });

  it('rechaza con el motivo si una base está fuera de rango', async () => {
    const dataDir = sembrar(99);
    await expect(runMigrationsInWorker(dataDir, () => undefined)).rejects.toThrow(/más nueva \(v99\)/);
  });
});
