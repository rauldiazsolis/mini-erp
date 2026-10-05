import { describe, it, expect, beforeEach } from 'vitest';
import { impersonate } from './helpers/impersonate.ts';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import type { BillingService } from '../src/server/billing/billing-service.ts';

describe('restricción del admin por deuda (#21)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let billing: BillingService;
  let tokens: { owner: string; member: string; root: string };
  let ownerId: string;
  let apiKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => new Date('2026-10-25T15:00:00.000Z') });
    app = bundle.app;
    billing = bundle.billing;
    bundle.authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    const member = bundle.authService.createUser({ email: 'member@x.com', password: 'password123', name: 'Member' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    ownerId = owner.user.id;
    new MembershipService(systemDb).addMembership(tenantId, member.user.id, 'member');
    tokens = { owner: owner.token, member: member.token, root: bundle.authService.login({ email: 'root@x.com', password: 'password123' }).token };
    const key = await request(app).post(`/api/tenants/${tenantId}/pos-registers`).set(as('owner')).send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    apiKey = (key.body as { rawKey: string }).rawKey;
    // Un cargo en deuda de hace 20 días: la gracia de 10 ya pasó
    billing.charge({ tenantId, registerId: 'reg-vieja', chargeDevice: '', days: ['2026-10-05'] });
  });

  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const get = (path: string, who: keyof typeof tokens = 'owner') => request(app).get(`/api/tenants/${tenantId}${path}`).set(as(who));

  it('el owner recibe 402 en el día a día y sigue en Créditos, el estado y exportar', async () => {
    for (const path of ['/products', '/sales?from=2026-10-01&to=2026-10-25', '/dashboard/summary', '/pos-registers']) {
      const res = await get(path);
      expect(res.status, path).toBe(402);
      expect(res.body).toEqual({ code: 'billing-restricted', error: 'mini contax está restringido por deuda', debt: 1000, deadline: '2026-10-15' });
    }
    expect((await request(app).post(`/api/tenants/${tenantId}/customers`).set(as('owner')).send({ name: 'Ana' })).status).toBe(402);
    for (const path of ['/credits', '/credits/charges', '/credits/movements', '/credits/gifts', '/billing-status', '/export/products']) {
      expect((await get(path)).status, path).toBe(200);
    }
  });

  it('el member recibe 402 en el día a día y ve el estado', async () => {
    expect((await get('/products', 'member')).status).toBe(402);
    expect((await get('/billing-status', 'member')).body).toEqual({ state: 'restricted', debt: 1000, deadline: '2026-10-15' });
  });

  it('quien impersona al owner no se restringe; root sin membresía no entra (#16)', async () => {
    const imp = await impersonate(app, tokens.root, ownerId);
    expect((await request(app).get(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${imp}`)).status).toBe(200);
    expect((await get('/products', 'root')).status).toBe(403);
  });

  it('el POS sigue vendiendo y sincronizando', async () => {
    const push = await request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', 'l1')
      .send({ deviceId: 'dev-1', events: [{ id: 'e1', type: 'sale', createdAt: '2026-10-25T13:00:00.000Z', origin: { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, sale: { id: 's1', total: 100, payments: [{ method: 'cash', amount: 100 }] } }] });
    expect(push.status).toBe(200);
    expect(tenantManager.getTenantDb(tenantId).prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 1 });
    const pull = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .send({ deviceId: 'dev-1', cursors: {}, pendingLotIds: [] });
    expect(pull.status).toBe(200);
    expect((pull.body as { notices: { id: string }[] }).notices.map((n) => n.id)).toEqual(['credits:restricted']);
  });

  it('un pago que cancela la deuda levanta la restricción', async () => {
    await request(app).post(`/api/platform/tenants/${tenantId}/payments`).set(as('root')).send({ day: '2026-10-25', amount: 1000 });
    expect((await get('/products')).status).toBe(200);
  });
});
