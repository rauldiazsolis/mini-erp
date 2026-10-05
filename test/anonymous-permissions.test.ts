import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { ANONYMOUS_DENIED, REGISTER_ALLOWED } from '../src/shared/permissions.ts';
import { RUTAS } from './helpers/tenant-routes.ts';

const V = { 'X-POS-Contract-Version': '4.6.0' };

/** Una muestra de cada ruta de la tabla, en el comercio demo. */
function sample(route: string, tenantId = 'demo-kiosco'): { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string } {
  const [verb = 'GET', pattern = '/'] = route.split(' ');
  const path = pattern.replace(/:(\w+)/g, (_m, name: string) => (name === 'entity' ? 'products' : 'x1'));
  const method = verb.toLowerCase();
  if (method !== 'get' && method !== 'post' && method !== 'put' && method !== 'patch' && method !== 'delete') throw new Error(verb);
  return { method, path: `/api/tenants/${tenantId}${path}` };
}

describe('permisos del acceso anónimo en todas las rutas del comercio (#24, M10)', () => {
  it('lo que no puede da 403; lo demás pasa el permiso', async () => {
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const { app } = createApp({ systemDb, tenantManager, demoConfig: { enabled: true, ttlHours: 24, maxActive: 50, resetHour: 4 } });
    const demo = await request(app).post('/connector/demo-sessions').set(V).send({});
    const apiKey = (demo.body as { apiKey: string }).apiKey;
    const link = await request(app).post('/connector/portal-links').set({ Authorization: `Bearer ${apiKey}`, ...V });
    const token = new URL((link.body as { url: string }).url).hash.replace('#t=', '');
    const session = ((await request(app).post('/api/portal/redeem').send({ token })).body as { token: string }).token;

    for (const [route, capability] of Object.entries(RUTAS)) {
      const { method, path } = sample(route);
      const res = await request(app)[method](path).set({ Authorization: `Bearer ${session}` }).send({});
      const denied = ANONYMOUS_DENIED.includes(capability) || route === 'POST /help-requests';
      if (denied) expect([route, res.status]).toEqual([route, 403]);
      else expect([route, res.status === 401 || res.status === 403]).toEqual([route, false]);
    }
  });

  it('la caja real solo pasa tenant.view y sales.view (M10)', async () => {
    const systemDb = openSystemDb(':memory:');
    const { app } = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }) });
    const alta = await request(app).post('/api/alta').send({
      name: 'Ana',
      email: 'ana@kiosco.com',
      password: 'clave-segura',
      whatsapp: '1155550000',
      businessName: 'Kiosco Ana',
      businessType: 'kiosco',
    });
    const body = alta.body as { tenant: { id: string }; posKey: { key: string } };
    const link = await request(app).post('/connector/portal-links').set({ Authorization: `Bearer ${body.posKey.key}`, ...V });
    const token = new URL((link.body as { url: string }).url).hash.replace('#t=', '');
    const session = ((await request(app).post('/api/portal/redeem').send({ token })).body as { token: string }).token;

    for (const [route, capability] of Object.entries(RUTAS)) {
      const { method, path } = sample(route, body.tenant.id);
      const res = await request(app)[method](path).set({ Authorization: `Bearer ${session}` }).send({});
      if (REGISTER_ALLOWED.includes(capability)) expect([route, res.status === 401 || res.status === 403]).toEqual([route, false]);
      else expect([route, res.status]).toEqual([route, 403]);
    }
  });
});
