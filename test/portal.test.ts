import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

const V = { 'X-POS-Contract-Version': '4.6.0' };
const SALES = '/api/tenants/demo-kiosco/sales?from=2026-10-05&to=2026-10-05';

type Bundle = ReturnType<typeof createApp>;

describe('portal y acceso anónimo de la demo (#24)', () => {
  let app: Express;
  let bundle: Bundle;
  let systemDb: DatabaseSync;
  let clock: Date;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    clock = new Date('2026-10-05T15:00:00.000Z');
    bundle = createApp({
      systemDb,
      tenantManager,
      now: () => clock,
      demoConfig: { enabled: true, ttlHours: 24, maxActive: 50, resetHour: 4 },
    });
    app = bundle.app;
  });

  const demo = async (template = 'kiosco'): Promise<{ apiKey: string; pointOfSale: string }> => {
    const res = await request(app).post('/connector/demo-sessions').set(V).send({ template });
    expect(res.status).toBe(201);
    return res.body as { apiKey: string; pointOfSale: string };
  };
  const pos = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}`, ...V });
  const link = async (apiKey: string) => request(app).post('/connector/portal-links').set(pos(apiKey));
  const tokenOf = (url: string): string => new URL(url).hash.replace('#t=', '');
  const redeem = async (token: string) => request(app).post('/api/portal/redeem').send({ token });
  const anonymous = async (): Promise<{ session: string; apiKey: string; pointOfSale: string }> => {
    const d = await demo();
    const res = await redeem(tokenOf(((await link(d.apiKey)).body as { url: string }).url));
    expect(res.status).toBe(200);
    return { session: (res.body as { token: string }).token, ...d };
  };

  it('/info declara el portal con el comando MINI', async () => {
    const { apiKey } = await demo();
    const res = await request(app).get('/connector/info').set(pos(apiKey));
    const body = res.body as { capabilities: string[]; portal?: { command: string; label: string } };
    expect(body.capabilities).toContain('portal');
    expect(body.portal).toEqual({ command: 'MINI', label: 'Abrir mini' });
  });

  it('con una key de demo da un link de un uso que vence en 60 s, con el token en el fragmento', async () => {
    const { apiKey } = await demo();
    const res = await link(apiKey);
    expect(res.status).toBe(201);
    const body = res.body as { url: string; expiresAt: string };
    expect(body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/portal#t=[\w-]{43}$/);
    expect(body.expiresAt).toBe(new Date(clock.getTime() + 60_000).toISOString());
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM portal_links').get()).toEqual({ n: 1 });
  });

  it('el canje da la sesión anónima del comercio demo; el link no sirve dos veces', async () => {
    const { apiKey, pointOfSale } = await demo();
    const token = tokenOf(((await link(apiKey)).body as { url: string }).url);
    const first = await redeem(token);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      tenant: { id: 'demo-kiosco', slug: 'demo-kiosco', name: 'Kiosco Demo' },
      pointOfSale,
      template: 'kiosco',
    });
    expect((first.body as { token: string }).token).toMatch(/^[\w-]{43}$/);
    const second = await redeem(token);
    expect(second.status).toBe(410);
    expect((second.body as { error: string }).error).toBe('Este link venció: volvé a abrir mini desde el POS');
  });

  it('un link de hace más de 60 s no sirve', async () => {
    const { apiKey } = await demo();
    const token = tokenOf(((await link(apiKey)).body as { url: string }).url);
    clock = new Date(clock.getTime() + 61_000);
    expect((await redeem(token)).status).toBe(410);
  });

  it('un token inventado o vacío no sirve', async () => {
    expect((await redeem('x'.repeat(43))).status).toBe(410);
    expect((await redeem('')).status).toBe(400);
  });

  it('la sesión anónima es admin de su comercio demo, sin créditos, cajas, usuarios ni nada de cuenta', async () => {
    const { session } = await anonymous();
    const as = { Authorization: `Bearer ${session}` };
    expect((await request(app).get(SALES).set(as)).status).toBe(200);
    expect((await request(app).get('/api/tenants/demo-kiosco/products').set(as)).status).toBe(200);
    expect((await request(app).get('/api/tenants/demo-kiosco/credits').set(as)).status).toBe(403);
    expect((await request(app).get('/api/tenants/demo-kiosco/pos-registers').set(as)).status).toBe(403);
    expect((await request(app).get('/api/tenants/demo-kiosco/users').set(as)).status).toBe(403);
    expect((await request(app).get('/api/tenants/demo-almacen/sales?from=2026-10-05&to=2026-10-05').set(as)).status).toBe(403);
    expect((await request(app).post('/api/tenants/demo-kiosco/help-requests').set(as).send({ path: '/admin/demo-kiosco' })).status).toBe(403);
    expect((await request(app).get('/api/auth/me').set(as)).status).toBe(401);
    expect((await request(app).get('/api/me/support-access').set(as)).status).toBe(401);
    expect((await request(app).get('/api/tenants').set(as)).status).toBe(401);
    expect((await request(app).get('/api/platform/tenants').set(as)).status).toBe(401);
  });

  it('el reinicio total corta la sesión anónima y la key', async () => {
    const { session, apiKey } = await anonymous();
    bundle.demoResets.resetFull('kiosco');
    expect((await request(app).get(SALES).set({ Authorization: `Bearer ${session}` })).status).toBe(401);
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM anonymous_sessions').get()).toEqual({ n: 0 });
    expect((await link(apiKey)).status).toBe(401);
  });

  it('usar el admin anónimo corre el uso de la demo', async () => {
    const { session } = await anonymous();
    clock = new Date(clock.getTime() + 2 * 60_000);
    await request(app).get(SALES).set({ Authorization: `Bearer ${session}` });
    expect(systemDb.prepare('SELECT last_used_at AS at FROM demo_sessions').get()).toEqual({ at: clock.toISOString() });
  });

  it('con la key de un comercio real devuelve el login de mini, sin link guardado', async () => {
    const alta = await request(app).post('/api/alta').send({
      name: 'Ana',
      email: 'ana@kiosco.com',
      password: 'clave-segura',
      whatsapp: '1155550000',
      businessName: 'Kiosco Ana',
      businessType: 'kiosco',
    });
    const body = alta.body as { tenant: { id: string }; posKey: { key: string } };
    const res = await link(body.posKey.key);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: expect.stringMatching(new RegExp(`/admin/${body.tenant.id}$`)) as unknown });
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM portal_links').get()).toEqual({ n: 0 });
  });
});
