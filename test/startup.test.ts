import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import request from 'supertest';
import { startServer, type StartedServer } from '../src/server/startup.ts';
import type { MigrationRunResult, MigrationProgress } from '../src/server/db/migrations/run-migrations.ts';
import { readVersion } from '../src/server/db/migrations/migrate.ts';

let started: StartedServer | undefined;
let root = '';
afterEach(async () => {
  if (started !== undefined) {
    const server = started.server;
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    started = undefined;
  }
  if (root !== '') {
    rmSync(root, { recursive: true, force: true });
    root = '';
  }
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function readyApp() {
  const app = express();
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  return app;
}

const quiet = { log: () => undefined, logError: () => undefined };

describe('startServer (#47)', () => {
  it('atiende en mantenimiento mientras migra y pasa al app listo', async () => {
    const migration = deferred<MigrationRunResult>();
    let progress: ((p: MigrationProgress) => void) | undefined;
    started = await startServer({
      port: 0, dataDir: 'no-se-usa', demos: false, ...quiet,
      runner: (_dir, onProgress) => { progress = onProgress; return migration.promise; },
      createReadyHandler: () => Promise.resolve(readyApp()),
    });

    const durante = await request(started.server).get('/health');
    expect(durante.status).toBe(503);
    expect(durante.body).toMatchObject({ status: 'maintenance' });

    progress?.({ file: 'tenants/a.sqlite', done: 1, total: 2 });
    expect((await request(started.server).get('/health')).body).toMatchObject({ progress: { done: 1, total: 2 } });

    migration.resolve({ migrated: [] });
    expect(await started.ready).toBe('ready');
    const despues = await request(started.server).get('/health');
    expect(despues.status).toBe(200);
    expect(despues.body).toEqual({ status: 'ok' });
  });

  it('si la migración falla, sigue vivo en mantenimiento con migration-failed', async () => {
    const errores: string[] = [];
    started = await startServer({
      port: 0, dataDir: 'no-se-usa', demos: false, log: () => undefined, logError: (l) => { errores.push(l); },
      runner: () => Promise.reject(new Error('tenants/b.sqlite, migración v3 columna: pedido de romper')),
      createReadyHandler: () => Promise.reject(new Error('no se tiene que llamar')),
    });
    expect(await started.ready).toBe('failed');
    const res = await request(started.server).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'migration-failed' });
    expect(errores.join('\n')).toMatch(/FALLÓ.*v3 columna.*quedaron como estaban/s);
  });

  it('si el app no arranca después de migrar, restaura la corrida y queda en failed', async () => {
    root = mkdtempSync(join(tmpdir(), 'mini-erp-startup-'));
    const dataDir = join(root, 'data');
    const runDir = join(dataDir, 'pre-migracion', '2026-10-02T14-30-00');
    mkdirSync(runDir, { recursive: true });
    const copia = new DatabaseSync(join(runDir, 'system.sqlite'));
    copia.exec('PRAGMA user_version = 4');
    copia.close();
    const migrada = new DatabaseSync(join(dataDir, 'system.sqlite'));
    migrada.exec('PRAGMA user_version = 5');
    migrada.close();

    started = await startServer({
      port: 0, dataDir, demos: false, ...quiet,
      runner: () => Promise.resolve({ runDir, migrated: [{ file: 'system.sqlite', from: 4, to: 5 }] }),
      createReadyHandler: () => Promise.reject(new Error('no arranca')),
    });
    expect(await started.ready).toBe('failed');
    const db = new DatabaseSync(join(dataDir, 'system.sqlite'));
    expect(readVersion(db)).toBe(4);
    db.close();
    expect((await request(started.server).get('/health')).body).toMatchObject({ status: 'migration-failed' });
  });
});
