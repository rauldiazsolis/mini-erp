import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

const V = { 'X-POS-Contract-Version': '4.6.0' };
const at = '2026-10-05T15:00:00.000Z';

function sale(eventId: string, extra: Record<string, unknown> = {}) {
  return {
    id: eventId,
    type: 'sale',
    createdAt: at,
    sale: { id: `v-${eventId}`, status: 'closed', total: 100, createdAt: at, lines: [], payments: [{ method: 'cash', amount: 100 }], ...extra },
  };
}

describe('puntos de registro del embudo (#25)', () => {
  let app: Express;
  let systemDb: DatabaseSync;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    app = createApp({
      systemDb,
      tenantManager,
      now: () => new Date(at),
      demoConfig: { enabled: true, ttlHours: 24, maxActive: 50, resetHour: 4 },
    }).app;
  });

  const demo = async () => {
    const res = await request(app).post('/connector/demo-sessions').set(V).send({ template: 'kiosco' });
    expect(res.status).toBe(201);
    const body = res.body as { apiKey: string; onboarding: { url: string } };
    const id = new URL(body.onboarding.url).searchParams.get('demo') ?? '';
    return { apiKey: body.apiKey, id, url: body.onboarding.url };
  };
  const events = () => systemDb.prepare('SELECT type, demo_session_id AS demo, tenant_id AS tenant, data FROM funnel_events ORDER BY type').all();
  const push = (apiKey: string, lot: string, evs: unknown[]) =>
    request(app)
      .post('/connector/sync/push')
      .set({ Authorization: `Bearer ${apiKey}`, 'Idempotency-Key': lot, ...V })
      .send({ deviceId: 'dev-1', events: evs });

  it('onboarding.url lleva el rubro y la demo', async () => {
    const d = await demo();
    expect(d.url).toMatch(/\/alta\?template=kiosco&demo=[0-9a-f-]{36}$/);
    expect(systemDb.prepare('SELECT 1 AS ok FROM demo_sessions WHERE id = ?').get(d.id)).toEqual({ ok: 1 });
  });

  it('la primera venta de una caja de visitante es demo-sale, una sola vez', async () => {
    const d = await demo();
    expect((await push(d.apiKey, 'lote-1', [sale('s1')])).status).toBe(200);
    expect((await push(d.apiKey, 'lote-2', [sale('s2')])).status).toBe(200);
    expect(events()).toEqual([{ type: 'demo-sale', demo: d.id, tenant: null, data: null }]);
  });

  it('un lote solo con anulaciones no cuenta como venta demo', async () => {
    const d = await demo();
    await push(d.apiKey, 'lote-1', [sale('s9', { voidsSaleId: 'otra', total: -100, payments: [{ method: 'cash', amount: -100 }] })]);
    expect(events()).toEqual([]);
  });

  it('el canje del portal de una demo es portal-opened y devuelve el id de la demo', async () => {
    const d = await demo();
    const link = await request(app)
      .post('/connector/portal-links')
      .set({ Authorization: `Bearer ${d.apiKey}`, ...V });
    const token = new URL((link.body as { url: string }).url).hash.replace('#t=', '');
    const res = await request(app).post('/api/portal/redeem').send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ access: 'demo', demoSessionId: d.id });
    expect(events()).toEqual([{ type: 'portal-opened', demo: d.id, tenant: null, data: null }]);
  });

  it('el alta con demoSessionId liga el comercio; una desconocida se ignora', async () => {
    const d = await demo();
    const base = { password: 'clave-segura', whatsapp: '1155550000', businessType: 'kiosco' };
    const ok = await request(app)
      .post('/api/alta')
      .send({ ...base, name: 'Ana', email: 'ana@x.com', businessName: 'Kiosco Ana', demoSessionId: d.id });
    expect(ok.status).toBe(201);
    const otra = await request(app)
      .post('/api/alta')
      .send({ ...base, name: 'Beto', email: 'beto@x.com', businessName: 'Kiosco Beto', demoSessionId: 'inventada' });
    expect(otra.status).toBe(201);
    expect(systemDb.prepare("SELECT id, demo_session_id AS demo FROM tenants WHERE id IN ('kiosco-ana', 'kiosco-beto') ORDER BY id").all()).toEqual([
      { id: 'kiosco-ana', demo: d.id },
      { id: 'kiosco-beto', demo: null },
    ]);
  });

  it('la importación confirmada y el catálogo de ejemplo son catalog-loaded, una vez; la vista previa no', async () => {
    const alta = await request(app).post('/api/alta').send({
      name: 'Ana',
      email: 'ana@x.com',
      password: 'clave-segura',
      whatsapp: '1155550000',
      businessName: 'Kiosco Ana',
      businessType: 'kiosco',
    });
    const auth = { Authorization: `Bearer ${(alta.body as { token: string }).token}` };
    const csv = 'nombre;precio\nAlfajor;100\n';
    await request(app).post('/api/tenants/kiosco-ana/import/products').set(auth).send({ csv, dryRun: true });
    expect(events()).toEqual([]);
    const done = await request(app).post('/api/tenants/kiosco-ana/import/products').set(auth).send({ csv, dryRun: false });
    expect(done.status).toBe(200);
    expect(events()).toEqual([{ type: 'catalog-loaded', demo: null, tenant: 'kiosco-ana', data: '{"source":"import-products"}' }]);
    await request(app).post('/api/tenants/kiosco-ana/catalog/example').set(auth).send({});
    expect(events()).toHaveLength(1);
  });

  it('el catálogo de ejemplo solo también cuenta como carga', async () => {
    const alta = await request(app).post('/api/alta').send({
      name: 'Caro',
      email: 'caro@x.com',
      password: 'clave-segura',
      whatsapp: '1155550000',
      businessName: 'Kiosco Caro',
      businessType: 'kiosco',
    });
    const auth = { Authorization: `Bearer ${(alta.body as { token: string }).token}` };
    expect((await request(app).post('/api/tenants/kiosco-caro/catalog/example').set(auth).send({})).status).toBe(200);
    expect(events()).toEqual([{ type: 'catalog-loaded', demo: null, tenant: 'kiosco-caro', data: '{"source":"example"}' }]);
  });
});
