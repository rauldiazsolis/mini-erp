import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { startServer, type MigrationProgress, type StartedServer } from '../src/server/startup.ts';

let started: StartedServer | undefined;
afterEach(async () => {
  if (started !== undefined) {
    const server = started.server;
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    started = undefined;
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

const quiet = { logError: () => undefined };

describe('startServer (#47)', () => {
  it('atiende en mantenimiento mientras migra PostgreSQL, con el avance, y pasa al app listo', async () => {
    const migration = deferred<undefined>();
    let progress: ((p: MigrationProgress) => void) | undefined;
    started = await startServer({
      port: 0, demos: false, ...quiet,
      migrateDatabase: async (onProgress) => { progress = onProgress; await migration.promise; },
      createReadyHandler: () => Promise.resolve(readyApp()),
    });

    const durante = await request(started.server).get('/health');
    expect(durante.status).toBe(503);
    expect(durante.body).toMatchObject({ status: 'maintenance' });
    expect(durante.body).not.toHaveProperty('progress');

    progress?.({ done: 1, total: 3 });
    expect((await request(started.server).get('/health')).body).toMatchObject({ status: 'maintenance', progress: { done: 1, total: 3 } });

    migration.resolve(undefined);
    expect(await started.ready).toBe('ready');
    const despues = await request(started.server).get('/health');
    expect(despues.status).toBe(200);
    expect(despues.body).toEqual({ status: 'ok' });
  });

  it('migra antes de armar el app', async () => {
    const pg = deferred<undefined>();
    const orden: string[] = [];
    started = await startServer({
      port: 0, demos: false, ...quiet,
      migrateDatabase: async () => { orden.push('pg'); await pg.promise; },
      createReadyHandler: () => { orden.push('app'); return Promise.resolve(readyApp()); },
    });
    expect((await request(started.server).get('/health')).status).toBe(503);
    expect(orden).toEqual(['pg']);
    pg.resolve(undefined);
    expect(await started.ready).toBe('ready');
    expect(orden).toEqual(['pg', 'app']);
  });

  it('si la migración falla, sigue vivo en mantenimiento con migration-failed y sin armar el app', async () => {
    const errores: string[] = [];
    const orden: string[] = [];
    started = await startServer({
      port: 0, demos: false, logError: (l) => { errores.push(l); },
      migrateDatabase: () => Promise.reject(new Error('migración v2 algo en system: pedido de romper')),
      createReadyHandler: () => { orden.push('app'); return Promise.resolve(readyApp()); },
    });
    expect(await started.ready).toBe('failed');
    expect(orden).toEqual([]);
    const res = await request(started.server).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'migration-failed' });
    expect(errores.join('\n')).toMatch(/FALLÓ.*PostgreSQL.*v2 algo/s);
    // El resto sigue en mantenimiento
    const api = await request(started.server).get('/api/me');
    expect(api.status).toBe(503);
    expect(api.headers['retry-after']).toBe('30');
  });

  it('si el app no arranca después de migrar, queda en mantenimiento con migration-failed', async () => {
    const errores: string[] = [];
    started = await startServer({
      port: 0, demos: false, logError: (l) => { errores.push(l); },
      migrateDatabase: () => Promise.resolve(),
      createReadyHandler: () => Promise.reject(new Error('no arranca')),
    });
    expect(await started.ready).toBe('failed');
    expect((await request(started.server).get('/health')).body).toMatchObject({ status: 'migration-failed' });
    expect(errores.join('\n')).toMatch(/FALLÓ el arranque: no arranca/);
  });
});
