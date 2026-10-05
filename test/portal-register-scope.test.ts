import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

const V = { 'X-POS-Contract-Version': '4.6.0' };
const DAY = '2026-10-05';

describe('la caja fija en Ventas & Caja (M10, #26)', () => {
  let app: Express;
  let tenantId: string;
  let session: string;

  const pushSale = async (apiKey: string, id: string, pointOfSale: string) => {
    const at = `${DAY}T14:00:00.000Z`;
    const origin = { branch: 'CENTRAL', pointOfSale };
    const sale = {
      id,
      status: 'closed',
      createdAt: at,
      ticket: { date: DAY, number: 1 },
      total: 1000,
      lines: [{ kind: 'freeform', description: 'Varios', qty: 1, unitPrice: 1000 }],
      payments: [{ method: 'cash', amount: 1000 }],
    };
    const res = await request(app)
      .post('/connector/sync/push')
      .set({ Authorization: `Bearer ${apiKey}`, 'Idempotency-Key': `lote-${id}`, ...V })
      .send({ deviceId: `dev-${pointOfSale}`, events: [{ id: `e-${id}`, type: 'sale', createdAt: at, origin, sale }] });
    expect(res.status).toBe(200);
  };

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    app = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }), now: () => new Date(`${DAY}T15:00:00.000Z`) }).app;
    const alta = await request(app).post('/api/alta').send({
      name: 'Ana',
      email: 'ana@kiosco.com',
      password: 'clave-segura',
      whatsapp: '1155550000',
      businessName: 'Kiosco Ana',
      businessType: 'kiosco',
    });
    const body = alta.body as { token: string; tenant: { id: string }; posKey: { key: string } };
    tenantId = body.tenant.id;
    const caja1 = body.posKey.key;
    const created = await request(app)
      .post(`/api/tenants/${tenantId}/pos-registers`)
      .set({ Authorization: `Bearer ${body.token}` })
      .send({ name: 'Caja 2', branch: 'CENTRAL', pointOfSale: 'Caja 2' });
    const caja2 = (created.body as { key: string }).key;
    await pushSale(caja1, 'v1', 'Caja 1');
    await pushSale(caja2, 'v2', 'Caja 2');
    const link = await request(app).post('/connector/portal-links').set({ Authorization: `Bearer ${caja1}`, ...V });
    const token = new URL((link.body as { url: string }).url).hash.replace('#t=', '');
    session = ((await request(app).post('/api/portal/redeem').send({ token })).body as { token: string }).token;
  });

  const get = (path: string) => request(app).get(`/api/tenants/${tenantId}${path}`).set({ Authorization: `Bearer ${session}` });

  it('las ventas son solo las de su caja, aunque la query pida otra', async () => {
    for (const q of ['', '&pointOfSale=Caja%202', '&branch=OTRA']) {
      const res = await get(`/sales?from=${DAY}&to=${DAY}${q}`);
      expect([q, (res.body as { items: { id: string }[] }).items.map((s) => s.id)]).toEqual([q, ['v1']]);
    }
  });

  it('el resumen y el día también', async () => {
    const summary = await get(`/cash-summary?from=${DAY}&to=${DAY}&pointOfSale=Caja%202`);
    expect((summary.body as { rows: { pointOfSale: string | null }[] }).rows.map((r) => r.pointOfSale)).toEqual(['Caja 1']);
    const day = await get(`/cash-summary/day?day=${DAY}&pointOfSale=Caja%202`);
    const entries = (day.body as { entries: { kind: string; sale?: { id: string } }[] }).entries;
    expect(entries.flatMap((e) => (e.sale === undefined ? [] : [e.sale.id]))).toEqual(['v1']);
  });

  it('una venta de otra caja no existe', async () => {
    expect((await get('/sales/v1')).status).toBe(200);
    expect((await get('/sales/v2')).status).toBe(404);
  });

  it('/registers es solo la suya', async () => {
    expect((await get('/registers')).body).toEqual([{ branch: 'CENTRAL', pointOfSale: 'Caja 1' }]);
  });
});
