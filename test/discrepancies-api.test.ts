import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';

const at = '2026-10-02T12:00:00.000Z';
const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };
const ventaACuenta = { id: 'e1', type: 'sale', createdAt: at, origin, sale: { id: 'v1', total: 950, customerId: 'c9', payments: [{ method: 'account', amount: 950 }] } };

describe('API de discrepancias (#2)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let ownerToken: string;
  let memberToken: string;
  let apiKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    const member = bundle.authService.createUser({ email: 'member@x.com', password: 'password123', name: 'Member' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    new MembershipService(systemDb).addMembership(tenantId, member.user.id, 'member');
    ownerToken = owner.token;
    memberToken = member.token;
    const key = await request(app)
      .post(`/api/tenants/${tenantId}/api-keys`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'POS-01' });
    apiKey = (key.body as { rawKey: string }).rawKey;
    await request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', 'l1')
      .send({ deviceId: 'dev-1', events: [ventaACuenta] });
  });

  const list = (token: string) => request(app).get(`/api/tenants/${tenantId}/discrepancies`).set('Authorization', `Bearer ${token}`);
  const dismiss = (token: string, id: string, note: string) =>
    request(app).post(`/api/tenants/${tenantId}/discrepancies/${id}/dismiss`).set('Authorization', `Bearer ${token}`).send({ note });

  it('lista las abiertas y owner las descarta con motivo', async () => {
    const res = await list(ownerToken);
    expect(res.status).toBe(200);
    const [d] = res.body as { id: string; kind: string; originPos: string; amount: number; message: string }[];
    expect(d).toMatchObject({ kind: 'unknown-customer', originPos: 'POS-01', amount: 950 });
    const id = d?.id ?? '';

    expect((await dismiss(ownerToken, id, '   ')).status).toBe(400);
    expect((await dismiss(ownerToken, id, 'Era una prueba')).status).toBe(200);
    expect((await list(ownerToken)).body).toEqual([]);
    expect((await dismiss(ownerToken, id, 'otra vez')).status).toBe(409);
    expect((await dismiss(ownerToken, 'nada', 'x')).status).toBe(404);
  });

  it('un member las ve pero no las descarta', async () => {
    const res = await list(memberToken);
    expect(res.status).toBe(200);
    const [d] = res.body as { id: string }[];
    expect((await dismiss(memberToken, d?.id ?? '', 'x')).status).toBe(403);
  });
});
