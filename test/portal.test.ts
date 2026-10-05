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
      access: 'demo',
      tenant: { id: 'demo-kiosco', slug: 'demo-kiosco', name: 'Kiosco Demo' },
      branch: 'CENTRAL',
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
});

describe('portal de una caja real (M10, #26)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let clock: Date;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    clock = new Date('2026-10-05T15:00:00.000Z');
    app = createApp({ systemDb, tenantManager, now: () => clock }).app;
  });

  type Kiosco = { tenantId: string; key: string; owner: string; registerId: string };
  const alta = async (): Promise<Kiosco> => {
    const res = await request(app).post('/api/alta').send({
      name: 'Ana',
      email: 'ana@kiosco.com',
      password: 'clave-segura',
      whatsapp: '1155550000',
      businessName: 'Kiosco Ana',
      businessType: 'kiosco',
    });
    const body = res.body as { token: string; tenant: { id: string }; posKey: { key: string } };
    const regs = await request(app).get(`/api/tenants/${body.tenant.id}/pos-registers`).set({ Authorization: `Bearer ${body.token}` });
    const registerId = (regs.body as { id: string }[])[0]?.id ?? '';
    return { tenantId: body.tenant.id, key: body.posKey.key, owner: body.token, registerId };
  };
  const pos = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}`, ...V });
  const tokenOf = (url: string): string => new URL(url).hash.replace('#t=', '');
  const open = async (k: Kiosco) => {
    const link = await request(app).post('/connector/portal-links').set(pos(k.key));
    expect(link.status).toBe(201);
    return request(app).post('/api/portal/redeem').send({ token: tokenOf((link.body as { url: string }).url) });
  };
  const sessionOf = async (k: Kiosco): Promise<string> => ((await open(k)).body as { token: string }).token;
  const products = (k: Kiosco, session: string) => request(app).get(`/api/tenants/${k.tenantId}/products`).set({ Authorization: `Bearer ${session}` });
  const asOwner = (k: Kiosco) => ({ Authorization: `Bearer ${k.owner}` });

  it('da un link de un uso que vence en 60 s, como en la demo', async () => {
    const k = await alta();
    const res = await request(app).post('/connector/portal-links').set(pos(k.key));
    expect(res.body).toEqual({
      url: expect.stringMatching(/\/portal#t=[\w-]{43}$/) as unknown,
      expiresAt: new Date(clock.getTime() + 60_000).toISOString(),
    });
    const token = tokenOf((res.body as { url: string }).url);
    clock = new Date(clock.getTime() + 61_000);
    expect((await request(app).post('/api/portal/redeem').send({ token })).status).toBe(410);
  });

  it('el canje da la sesión de la caja, una sola vez', async () => {
    const k = await alta();
    const link = await request(app).post('/connector/portal-links').set(pos(k.key));
    const token = tokenOf((link.body as { url: string }).url);
    const first = await request(app).post('/api/portal/redeem').send({ token });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      access: 'register',
      tenant: { id: k.tenantId, name: 'Kiosco Ana' },
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
      registerName: 'Caja 1',
    });
    expect(first.body).not.toHaveProperty('template');
    expect((await request(app).post('/api/portal/redeem').send({ token })).status).toBe(410);
  });

  it('consulta pero no opera: catálogo y ventas sí; dashboard, edición, cajas y cuenta no', async () => {
    const k = await alta();
    const as = { Authorization: `Bearer ${await sessionOf(k)}` };
    const t = `/api/tenants/${k.tenantId}`;
    expect((await request(app).get(`${t}/products`).set(as)).status).toBe(200);
    expect((await request(app).get(`${t}/sales?from=2026-10-05&to=2026-10-05`).set(as)).status).toBe(200);
    expect((await request(app).get(`${t}/billing-status`).set(as)).status).toBe(200);
    expect((await request(app).get(`${t}/dashboard/summary`).set(as)).status).toBe(403);
    expect((await request(app).post(`${t}/products`).set(as).send({ name: 'X', price: 1 })).status).toBe(403);
    expect((await request(app).get(`${t}/pos-registers`).set(as)).status).toBe(403);
    expect((await request(app).get('/api/auth/me').set(as)).status).toBe(401);
    expect((await request(app).get('/api/tenants/otro/products').set(as)).status).toBe(403);
  });

  it('rotar la key corta la sesión y la borra', async () => {
    const k = await alta();
    const session = await sessionOf(k);
    const rotated = await request(app).post(`/api/tenants/${k.tenantId}/pos-registers/${k.registerId}/rotate-key`).set(asOwner(k));
    expect(rotated.status).toBe(200);
    expect((await products(k, session)).status).toBe(401);
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM anonymous_sessions').get()).toEqual({ n: 0 });
  });

  it('desactivar la caja corta la sesión; desligar el equipo no', async () => {
    const k = await alta();
    const session = await sessionOf(k);
    await request(app).post(`/api/tenants/${k.tenantId}/pos-registers/${k.registerId}/unbind`).set(asOwner(k));
    expect((await products(k, session)).status).toBe(200);
    await request(app).delete(`/api/tenants/${k.tenantId}/pos-registers/${k.registerId}`).set(asOwner(k));
    expect((await products(k, session)).status).toBe(401);
  });

  it('vence a las 2 h sin uso; usarla la estira', async () => {
    const k = await alta();
    const session = await sessionOf(k);
    clock = new Date(clock.getTime() + 90 * 60_000);
    expect((await products(k, session)).status).toBe(200);
    clock = new Date(clock.getTime() + 90 * 60_000);
    expect((await products(k, session)).status).toBe(200);
    clock = new Date(clock.getTime() + 2 * 60 * 60_000 + 1000);
    expect((await products(k, session)).status).toBe(401);
  });

  it('cada apertura queda en la actividad del comercio, con la caja como origen', async () => {
    const k = await alta();
    await sessionOf(k);
    const audit = await request(app).get(`/api/tenants/${k.tenantId}/audit`).set(asOwner(k));
    const entries = audit.body as { action: string; actorName: string }[];
    expect(entries.find((e) => e.action === 'portal.opened')).toMatchObject({ actorName: 'Caja 1 (desde el POS)' });
    expect(systemDb.prepare("SELECT actor_user_id, actor_register_id FROM audit_log WHERE action = 'portal.opened'").get()).toEqual({
      actor_user_id: 'register',
      actor_register_id: k.registerId,
    });
  });

  it('un comercio suspendido no deja entrar a la caja', async () => {
    const k = await alta();
    const session = await sessionOf(k);
    systemDb
      .prepare("INSERT INTO tenant_suspensions (id, tenant_id, from_at, reason, created_by) VALUES ('susp_1', ?, ?, 'deuda', 'u')")
      .run(k.tenantId, new Date(clock.getTime() - 60_000).toISOString());
    expect((await products(k, session)).status).toBe(403);
  });
});
