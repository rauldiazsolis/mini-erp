import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { saveCashMovement, saveCustomerPayment, saveSale } from '../src/server/sales/records.ts';
import type { ListResult } from '../src/shared/sales-types.ts';
import { D1, D2, seedSalesFixture } from './helpers/sales-fixture.ts';

/**
 * Scroll infinito (#87): las listas sin límite se piden por tramos con un cursor ("después de esta
 * fila"), así una venta que entra mientras se scrollea no repite ni saltea filas.
 */
describe('Ventas, cobranzas y movimientos por cursor (#87)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let token: string;
  let db: DatabaseSync;
  const tenantId = 'kiosco';
  const origin = { deviceId: 'dev-1', branch: 'CENTRAL', pointOfSale: 'Caja 1' };

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const owner = bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    token = owner.token;
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    bundle.billing.grantSignupBonus(tenantId, owner.user.id);
    db = tenantManager.getTenantDb(tenantId);
    await seedSalesFixture(app, token, tenantId, db);
  });

  const list = async (path: string, query: string) => {
    const res = await request(app)
      .get(`/api/tenants/${tenantId}/${path}?from=${D1}&to=${D2}${query}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as ListResult<{ id: string }>;
  };
  const ids = (l: ListResult<{ id: string }>) => l.items.map((i) => i.id);

  it('recorre las ventas de a tramos hasta el final', async () => {
    const first = await list('sales', '&pageSize=2');
    expect(ids(first)).toEqual(['s5', 's4']);
    expect(first).toMatchObject({ count: 5, netTotal: 550 });
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await list('sales', `&pageSize=2&after=${encodeURIComponent(first.nextCursor ?? '')}`);
    expect(ids(second)).toEqual(['s2', 's3']);
    const third = await list('sales', `&pageSize=2&after=${encodeURIComponent(second.nextCursor ?? '')}`);
    expect(ids(third)).toEqual(['s1']);
    expect(third.nextCursor).toBeNull();
  });

  it('una venta nueva mientras se scrollea no corre el tramo siguiente', async () => {
    const first = await list('sales', '&pageSize=2');
    saveSale(db, { id: 's6', total: 10, ticket: { date: D2, number: 3 }, createdAt: `${D2}T20:00:00.000Z` }, origin, `${D2}T20:00:00.000Z`);
    const second = await list('sales', `&pageSize=2&after=${encodeURIComponent(first.nextCursor ?? '')}`);
    expect(ids(second)).toEqual(['s2', 's3']);
  });

  it('cobranzas y movimientos van igual', async () => {
    const payments = await list('customer-payments', '&pageSize=1');
    expect(ids(payments)).toEqual(['cp2']);
    saveCustomerPayment(db, { id: 'cp3', customerId: 'c1', total: 5, createdAt: `${D2}T22:00:00.000Z` }, origin, `${D2}T22:00:00.000Z`);
    const rest = await list('customer-payments', `&pageSize=5&after=${encodeURIComponent(payments.nextCursor ?? '')}`);
    expect(ids(rest)).toEqual(['cp1']);
    expect(rest.nextCursor).toBeNull();

    const movements = await list('cash-movements', '&pageSize=2');
    expect(ids(movements)).toEqual(['m3', 'm2']);
    saveCashMovement(db, { id: 'm4', direction: 'in', amount: 1, createdAt: `${D2}T22:00:00.000Z` }, origin, `${D2}T22:00:00.000Z`);
    const next = await list('cash-movements', `&pageSize=2&after=${encodeURIComponent(movements.nextCursor ?? '')}`);
    expect(ids(next)).toEqual(['m1']);
  });

  it('un cursor que no se entiende da 400', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenantId}/sales?from=${D1}&to=${D2}&after=basura`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
