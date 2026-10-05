import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import type { DemoConfig } from '../src/server/demo/demo-config.ts';

const HOUR = 60 * 60 * 1000;

type DemoBody = {
  apiKey: string;
  branch: string;
  pointOfSale: string;
  template: string;
  onboarding: { url: string; label: string };
  baseUrl?: string;
};

function makeApp(overrides: Partial<DemoConfig> = {}) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const clock = { now: new Date('2026-09-30T12:00:00.000Z') };
  const tenantManager = new TenantManager(systemDb, { inMemory: true });
  const bundle = createApp({
    systemDb,
    tenantManager,
    demoConfig: { enabled: true, ttlHours: 24, maxActive: 200, resetHour: 4, ...overrides },
    now: () => clock.now,
  });
  const advance = (ms: number): void => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { ...bundle, tenantManager, advance };
}

function startDemo(app: ReturnType<typeof makeApp>['app'], body?: object) {
  const req = request(app).post('/connector/demo-sessions').set('X-POS-Contract-Version', '4.4.0');
  return body === undefined ? req : req.send(body);
}

describe('POST /connector/demo-sessions (#9, #24)', () => {
  it('crea una demo sin autenticación con el template por defecto', async () => {
    const { app } = makeApp();
    const res = await startDemo(app);
    expect(res.status).toBe(201);
    const body = res.body as DemoBody;
    expect(body).toMatchObject({ branch: 'CENTRAL', template: 'kiosco' });
    expect(body.pointOfSale).toMatch(/^Demo [0-9A-F]{4}$/);
    expect(body.onboarding.label).toBe('Crear mi comercio');
    expect(body.onboarding.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/alta\?template=kiosco&demo=[0-9a-f-]{36}$/);
    expect(body).not.toHaveProperty('baseUrl');
  });

  it('usa PUBLIC_URL para la página de alta', async () => {
    const { app } = makeApp({ publicUrl: 'https://erp.example.com' });
    const res = await startDemo(app, { template: 'almacen' });
    expect(res.status).toBe(201);
    expect((res.body as DemoBody).onboarding.url).toMatch(/^https:\/\/erp\.example\.com\/alta\?template=almacen&demo=[0-9a-f-]{36}$/);
  });

  it('la key de la demo sincroniza el catálogo del template y declara la capacidad', async () => {
    const { app } = makeApp();
    const { apiKey } = (await startDemo(app, { template: 'ferreteria' })).body as DemoBody;

    const pull = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .send({ cursors: {}, pendingLotIds: [] });
    expect(pull.status).toBe(200);
    const skus = (pull.body as { products: { items: { sku: string }[] } }).products.items.map((p) => p.sku);
    expect(skus).toContain('FER-001');

    const info = await request(app).get('/connector/info').set('Authorization', `Bearer ${apiKey}`);
    expect((info.body as { capabilities?: string[] }).capabilities).toEqual(['customer-payment-void', 'demo-sessions', 'portal']);
    expect((info.body as { company?: { name: string } }).company).toEqual({ name: 'Ferretería Demo' });
  });

  it('422 con la lista si el template no existe', async () => {
    const { app } = makeApp();
    const res = await startDemo(app, { template: 'panaderia' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ code: 'unknown-template', templates: ['kiosco', 'almacen', 'ferreteria'] });
  });

  it('400 si el body no tiene la forma', async () => {
    const { app } = makeApp();
    expect((await startDemo(app, { template: 5 })).status).toBe(400);
  });

  it('409 con otro major del contrato', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/connector/demo-sessions').set('X-POS-Contract-Version', '5.0.0');
    expect(res.status).toBe(409);
  });

  it('404 si las demos están apagadas', async () => {
    const { app } = makeApp({ enabled: false });
    expect((await startDemo(app)).status).toBe(404);
  });

  it('503 al llegar al tope', async () => {
    const { app } = makeApp({ maxActive: 1 });
    expect((await startDemo(app)).status).toBe(201);
    const res = await startDemo(app);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'demo-capacity', message: 'No hay lugar para más demos; probá más tarde' });
  });

  it('dos demos del mismo rubro son dos cajas del mismo comercio demo', async () => {
    const { app, apiKeyService } = makeApp();
    const a = (await startDemo(app)).body as DemoBody;
    const b = (await startDemo(app)).body as DemoBody;
    expect(apiKeyService.validateApiKey(a.apiKey)?.tenantId).toBe('demo-kiosco');
    expect(apiKeyService.validateApiKey(b.apiKey)?.tenantId).toBe('demo-kiosco');
    expect(a.pointOfSale).not.toBe(b.pointOfSale);
  });

  it('una caja en uso no se revoca; una sin uso sí', async () => {
    const { app, advance, demoSessions } = makeApp();
    const { apiKey } = (await startDemo(app)).body as DemoBody;
    const info = () => request(app).get('/connector/info').set('Authorization', `Bearer ${apiKey}`);

    advance(23 * HOUR);
    expect((await info()).status).toBe(200); // el request la toca
    advance(23 * HOUR);
    demoSessions.revokeIdle();
    expect((await info()).status).toBe(200);

    advance(25 * HOUR);
    demoSessions.revokeIdle();
    expect((await info()).status).toBe(401);
  });

  it('sin demos, /info no declara demo-sessions', async () => {
    const { app } = makeApp({ enabled: false });
    const alta = await request(app)
      .post('/api/alta')
      .send({ email: 'a@b.com', password: 'secreta1', name: 'Ana', businessName: 'Tienda', businessType: 'otro', whatsapp: '1155550000' });
    const token = (alta.body as { token: string }).token;
    const key = await request(app)
      .post('/api/tenants/tienda/pos-registers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    const info = await request(app)
      .get('/connector/info')
      .set('Authorization', `Bearer ${(key.body as { rawKey: string }).rawKey}`);
    expect(info.status).toBe(200);
    expect((info.body as { capabilities: string[] }).capabilities).toEqual(['customer-payment-void', 'portal']);
  });
});

describe('demo revocada (contrato 4.5.0, #58, #24)', () => {
  it('la key de una caja revocada por inactividad da 401 en todo el Connector API', async () => {
    const { app, advance, demoSessions } = makeApp();
    const { apiKey } = (await startDemo(app)).body as DemoBody;
    advance(25 * HOUR);
    demoSessions.revokeIdle();

    const headers = { Authorization: `Bearer ${apiKey}`, 'X-POS-Contract-Version': '4.5.0' };
    expect((await request(app).get('/connector/info').set(headers)).status).toBe(401);
    expect(
      (await request(app).post('/connector/sync/pull').set(headers).send({ cursors: {}, pendingLotIds: [] })).status,
    ).toBe(401);
    expect(
      (await request(app).post('/connector/sync/push').set(headers).set('Idempotency-Key', 'l1').send({ deviceId: 'd1', events: [] }))
        .status,
    ).toBe(401);
    expect(
      (await request(app).post('/connector/account-holds').set(headers).set('Idempotency-Key', 'h1').send({ customerId: 'c1', amount: 10 }))
        .status,
    ).toBe(401);
  });

  it('el reinicio total revoca las cajas: su key da 401', async () => {
    const { app, demoSessions } = makeApp();
    const { apiKey } = (await startDemo(app)).body as DemoBody;
    demoSessions.revokeTenant('demo-kiosco', 'reset');
    const res = await request(app)
      .post('/connector/sync/pull')
      .set({ Authorization: `Bearer ${apiKey}`, 'X-POS-Contract-Version': '4.6.0' })
      .send({ cursors: {}, pendingLotIds: [] });
    expect(res.status).toBe(401);
  });

  it('una demo vencida puede ir igual al alta: nace un comercio nuevo con su rubro y su caja', async () => {
    const { app, advance, demoSessions, tenantManager } = makeApp();
    expect((await startDemo(app, { template: 'almacen' })).status).toBe(201);
    advance(25 * HOUR);
    demoSessions.revokeIdle();

    // Lo que hace /alta?template=almacen&return_url=…&wipe_key=…: nunca usa la key de la demo
    const res = await request(app).post('/api/alta').send({
      name: 'Ana',
      email: 'ana@almacen.com',
      password: 'clave-segura',
      whatsapp: '1155550000',
      businessName: 'Almacén Ana',
      businessType: 'almacen',
    });
    expect(res.status).toBe(201);
    const body = res.body as { tenant: { id: string }; posKey: { key: string } };
    expect(tenantManager.getBusinessType(body.tenant.id)).toBe('almacen');

    const info = await request(app).get('/connector/info').set('Authorization', `Bearer ${body.posKey.key}`);
    expect(info.status).toBe(200);
    expect((info.body as { company?: { name: string } }).company).toEqual({ name: 'Almacén Ana' });
  });
});
