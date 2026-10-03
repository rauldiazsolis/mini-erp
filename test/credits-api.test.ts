import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import type { BillingService } from '../src/server/billing/billing-service.ts';
import type { ChargesPage, CreditMovementItem, CreditsResponse, GiftItem } from '../src/shared/credits-types.ts';

const origin = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };
const venta = (eventId: string, saleId: string, createdAt: string) => ({
  id: eventId,
  type: 'sale',
  createdAt,
  origin,
  sale: { id: saleId, status: 'closed', total: 100, createdAt, lines: [], payments: [{ method: 'cash', amount: 100 }] },
});

describe('API de Créditos del comercio (#21)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let billing: BillingService;
  let tokens: { owner: string; admin: string; member: string; root: string };
  let keys: string[];
  const tenantId = 'kiosco';
  const at = new Date('2026-10-05T15:00:00.000Z');

  beforeEach(async () => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => at });
    app = bundle.app;
    billing = bundle.billing;
    bundle.authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    const admin = bundle.authService.createUser({ email: 'admin@x.com', password: 'password123', name: 'Admin' });
    const member = bundle.authService.createUser({ email: 'member@x.com', password: 'password123', name: 'Member' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    const members = new MembershipService(systemDb);
    members.addMembership(tenantId, admin.user.id, 'admin');
    members.addMembership(tenantId, member.user.id, 'member');
    billing.grantSignupBonus(tenantId, owner.user.id);
    tokens = {
      owner: owner.token,
      admin: admin.token,
      member: member.token,
      root: bundle.authService.login({ email: 'root@x.com', password: 'password123' }).token,
    };
    keys = [];
    for (const pos of ['Caja 1', 'Caja 2']) {
      const res = await request(app).post(`/api/tenants/${tenantId}/pos-registers`).set(as('owner')).send({ name: pos, branch: 'CENTRAL', pointOfSale: pos });
      keys.push((res.body as { rawKey: string }).rawKey);
    }
  });

  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const push = (key: string, lotId: string, deviceId: string, events: unknown[]) =>
    request(app).post('/connector/sync/push').set('Authorization', `Bearer ${key}`).set('X-POS-Contract-Version', '4.4.0').set('Idempotency-Key', lotId).send({ deviceId, events });

  it('owner y admin ven el resumen con "Cómo pagar"; el member no', async () => {
    await request(app).put('/api/platform/settings').set(as('root')).send({ paymentAlias: 'mini.contax', supportWhatsapp: '+5491155551234' });
    for (const who of ['owner', 'admin'] as const) {
      const res = await request(app).get(`/api/tenants/${tenantId}/credits`).set(as(who));
      expect(res.status).toBe(200);
      expect(res.body as CreditsResponse).toMatchObject({
        billable: true,
        state: 'ok',
        giftBalance: 50000,
        paidBalance: 0,
        holder: { name: 'Owner', email: 'owner@x.com' },
        paymentInfo: { alias: 'mini.contax', cbu: '', holder: '', supportWhatsapp: '+5491155551234' },
      });
    }
    expect((await request(app).get(`/api/tenants/${tenantId}/credits`).set(as('member'))).status).toBe(403);
  });

  it('consumo por caja y día, con el otro equipo aparte y el total del filtro', async () => {
    await push(keys[0] ?? '', 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T13:00:00.000Z')]);
    await push(keys[1] ?? '', 'l2', 'dev-2', [venta('e2', 's2', '2026-10-04T14:00:00.000Z')]);
    await push(keys[0] ?? '', 'l3', 'dev-x', [venta('e3', 's3', '2026-10-05T13:00:00.000Z')]);
    const res = await request(app).get(`/api/tenants/${tenantId}/credits/charges?from=2026-10-01&to=2026-10-05`).set(as('owner'));
    const page = res.body as ChargesPage;
    expect(page).toMatchObject({ count: 3, total: 3000, page: 1, pageSize: 50 });
    expect(page.items.map((c) => [c.day, c.registerName, c.deviceId, c.giftAmount])).toEqual([
      ['2026-10-05', 'Caja 1', 'dev-x', 1000],
      ['2026-10-04', 'Caja 1', null, 1000],
      ['2026-10-04', 'Caja 2', null, 1000],
    ]);
    const solo4 = (await request(app).get(`/api/tenants/${tenantId}/credits/charges?from=2026-10-04&to=2026-10-04`).set(as('owner'))).body as ChargesPage;
    expect(solo4.count).toBe(2);
    expect((await request(app).get(`/api/tenants/${tenantId}/credits/charges?from=4-10`).set(as('owner'))).status).toBe(400);
  });

  it('movimientos y regalados', async () => {
    await request(app).post(`/api/platform/tenants/${tenantId}/payments`).set(as('root')).send({ day: '2026-10-05', amount: 5000, info: 'op 1' });
    await push(keys[0] ?? '', 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T13:00:00.000Z')]);
    const movements = (await request(app).get(`/api/tenants/${tenantId}/credits/movements`).set(as('admin'))).body as CreditMovementItem[];
    expect(movements.map((m) => [m.kind, m.amount, m.info, m.byName])).toEqual([
      ['payment', 5000, 'op 1', 'Root'],
      ['gift-granted', 50000, 'Bono de alta', 'Owner'],
    ]);
    const gifts = (await request(app).get(`/api/tenants/${tenantId}/credits/gifts`).set(as('owner'))).body as GiftItem[];
    expect(gifts).toEqual([expect.objectContaining({ origin: 'signup', amount: 50000, remaining: 49500, status: 'active', grantedByName: 'Owner' })]);
  });

  it('el estado de cobro lo ven los tres roles', async () => {
    const res = await request(app).get(`/api/tenants/${tenantId}/billing-status`).set(as('member'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: 'ok', debt: 0, deadline: null });
  });
});
