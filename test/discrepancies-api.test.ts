import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { recordDiscrepancy } from '../src/server/discrepancy/discrepancies.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

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
    const tenantManager = new TenantManager(db(), { inMemory: true });
    const bundle = createApp({ database: db(), tenantManager });
    app = bundle.app;
    const owner = await bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    const member = await bundle.authService.createUser({ email: 'member@x.com', password: 'password123', name: 'Member' });
    await tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    // Con bono: las ventas con fechas fijas no dejan al comercio restringido cuando pase la gracia (#21)
    await bundle.billing.grantSignupBonus(tenantId, owner.user.id);
    await new MembershipService(db().system).addMembership(tenantId, member.user.id, 'member');
    ownerToken = owner.token;
    memberToken = member.token;
    const key = await request(app)
      .post(`/api/tenants/${tenantId}/pos-registers`)
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

  it('una discrepancia del comercio se lista con su mensaje y se descarta una sola vez', async () => {
    const id = await recordDiscrepancy(db().forTenant(tenantId), {
      kind: 'void-duplicate', deviceId: 'dev-2', originBranch: 'CENTRAL', originPos: 'POS-02',
      customerId: 'c1', refType: 'customer-payment', refId: 'p3', amount: 500,
    }, at);
    const abiertas = (await list(ownerToken)).body as { id: string; kind: string; originPos: string; amount: number; message: string; createdAt: string }[];
    expect(abiertas.find((d) => d.id === id)).toMatchObject({
      kind: 'void-duplicate', originPos: 'POS-02', amount: 500, createdAt: at,
      message: 'Esa cobranza ya estaba anulada y se volvió a anular ($500): revisalo en mini contax.',
    });

    expect((await dismiss(ownerToken, id, 'Revisado')).status).toBe(200);
    expect(((await list(ownerToken)).body as { id: string }[]).some((d) => d.id === id)).toBe(false);
    expect((await dismiss(ownerToken, id, 'otra vez')).status).toBe(409);
    expect((await dismiss(ownerToken, 'nada', 'x')).status).toBe(404);
    expect(
      await db().forTenant(tenantId).selectFrom('discrepancies').select(['resolution', 'note']).where('id', '=', id).execute(),
    ).toMatchObject([{ resolution: 'dismissed', note: 'Revisado' }]);
  });
});
