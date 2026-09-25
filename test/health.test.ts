import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

describe('App Scaffolding & Healthcheck', () => {
  it('responde 200 OK en /health con el status correcto', async () => {
    const systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);
    const tenantManager = new TenantManager(systemDb, { inMemory: true });

    const { app } = createApp({ systemDb, tenantManager });
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'mini-erp' });
  });
});
