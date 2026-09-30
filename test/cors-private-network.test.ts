import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

function makeApp() {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  return createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }) }).app;
}

function preflight(app: ReturnType<typeof makeApp>) {
  return request(app)
    .options('/connector/sync/pull')
    .set('Origin', 'https://offline-pos.pages.dev')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,content-type,x-pos-contract-version');
}

describe('CORS y red privada (#9)', () => {
  it('acepta el origen del POS publicado', async () => {
    const res = await preflight(makeApp());
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('contesta el preflight de red privada de Chrome', async () => {
    const res = await preflight(makeApp()).set('Access-Control-Request-Private-Network', 'true');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it('no agrega el header si no lo piden', async () => {
    const res = await preflight(makeApp());
    expect(res.headers['access-control-allow-private-network']).toBeUndefined();
  });
});
