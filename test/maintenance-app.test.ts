import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createMaintenanceApp, type MaintenanceState } from '../src/server/maintenance/maintenance-app.ts';
import { MAINTENANCE_MESSAGE } from '../src/server/connector/backend-info.ts';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };

function app(state: MaintenanceState = { phase: 'migrating' }, demos = true) {
  return createMaintenanceApp({ state: () => state, demos });
}

describe('app de mantenimiento (#47)', () => {
  it('/health responde 503 maintenance con la versión y el progreso', async () => {
    const res = await request(app({ phase: 'migrating', progress: { done: 3, total: 41 } })).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'maintenance', service: 'mini-erp', version: pkg.version, progress: { done: 3, total: 41 } });
  });

  it('/health dice migration-failed si la migración falló', async () => {
    const res = await request(app({ phase: 'failed' })).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'migration-failed', service: 'mini-erp', version: pkg.version });
  });

  it('/connector/info responde maintenance sin key, con CORS y sin 409', async () => {
    const res = await request(app()).get('/connector/info').set('X-POS-Contract-Version', '9.0.0');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body).toEqual({
      contractVersion: '4.4.0',
      status: 'maintenance',
      message: MAINTENANCE_MESSAGE,
      backend: { name: 'mini-erp', version: pkg.version },
      capabilities: ['customer-payment-void', 'demo-sessions'],
    });
  });

  it('sin demos, /connector/info declara solo customer-payment-void', async () => {
    const res = await request(app({ phase: 'migrating' }, false)).get('/connector/info');
    expect((res.body as { capabilities: string[] }).capabilities).toEqual(['customer-payment-void']);
  });

  it('el preflight de red privada pasa, como en el app real', async () => {
    const res = await request(app())
      .options('/connector/info')
      .set('Origin', 'https://offline-pos.pages.dev')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Private-Network', 'true');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it.each(['/connector/sync/push', '/connector/sync/pull', '/connector/account-holds', '/connector/demo-sessions'])(
    'POST %s responde 503 con Retry-After',
    async (path) => {
      const res = await request(app()).post(path).send({});
      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('30');
      expect(res.body).toEqual({ code: 'maintenance', message: MAINTENANCE_MESSAGE });
    },
  );

  it('/api responde 503 con el error y el código', async () => {
    const res = await request(app()).get('/api/auth/me');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.body).toEqual({ error: MAINTENANCE_MESSAGE, code: 'maintenance' });
  });

  it('cualquier página muestra la pantalla de actualización que reintenta sola', async () => {
    const res = await request(app()).get('/admin');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Estamos actualizando mini contax');
    expect(res.text).toContain("fetch('/health'");
    expect(res.text).toContain('http-equiv="refresh"');
    expect(res.text).not.toMatch(/Mini-ERP|Express|Multitenant/);
  });
});
