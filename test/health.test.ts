import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
    // La versión sale de package.json (#40): el deploy la compara con el tag
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };
    expect(res.body).toEqual({ status: 'ok', service: 'mini-erp', version: pkg.version });
  });
});
