import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import type { ListResult, SaleDetail, SaleListItem } from '../src/shared/sales-types.ts';
import { D1, D2, seedSalesFixture } from './helpers/sales-fixture.ts';

describe('API de Ventas & Caja (#20)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let token: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const owner = bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    token = owner.token;
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    await seedSalesFixture(app, token, tenantId, tenantManager.getTenantDb(tenantId));
  });

  const get = (path: string) => request(app).get(`/api/tenants/${tenantId}${path}`).set('Authorization', `Bearer ${token}`);
  const sales = async (query: string) => (await get(`/sales?from=${D1}&to=${D2}${query}`)).body as ListResult<SaleListItem>;
  const ids = (list: ListResult<{ id: string }>) => list.items.map((i) => i.id);

  describe('ventas', () => {
    it('las cajas que aparecen en los datos', async () => {
      expect((await get('/registers')).body).toEqual([
        { branch: 'CENTRAL', pointOfSale: 'Caja 1' },
        { branch: 'CENTRAL', pointOfSale: 'Caja 2' },
      ]);
    });

    it('lista del rango: lo más nuevo primero, total neto y marcas', async () => {
      const list = await sales('');
      expect(ids(list)).toEqual(['s5', 's4', 's2', 's3', 's1']);
      expect(list).toMatchObject({ count: 5, page: 1, pageSize: 50, netTotal: 550 });
      const byId = new Map(list.items.map((i) => [i.id, i]));
      expect(byId.get('s1')).toEqual({
        id: 's1', day: D1, createdAt: `${D1}T13:00:00.000Z`, ticket: { date: D1, number: 1 }, branch: 'CENTRAL', pointOfSale: 'Caja 1',
        methods: ['cash'], total: 1000, kind: 'sale', voided: true, voidedBy: 's4',
      });
      expect(byId.get('s4')).toMatchObject({ kind: 'void', voidsSaleId: 's1', voided: false });
      expect(byId.get('s5')).toMatchObject({ kind: 'return' });
      expect(byId.get('s2')).toMatchObject({ customer: { id: 'c1', name: 'Ana' } });
      expect(byId.get('s3')).toMatchObject({ methods: ['crypto'] });
    });

    it.each([
      ['&pointOfSale=Caja%202', ['s3']],
      ['&method=other', ['s3']],
      ['&method=debit', ['s2']],
      ['&customerId=c1', ['s2']],
      ['&productId=p1', ['s4', 's2', 's1']],
      ['&kind=return', ['s5']],
      ['&kind=void', ['s4']],
      ['&status=valid', ['s5', 's2', 's3']],
      ['&status=voided', ['s1']],
      ['&branch=CENTRAL&pointOfSale=Caja%201', ['s5', 's4', 's2', 's1']],
    ])('filtro %s', async (query, expected) => {
      expect(ids(await sales(query))).toEqual(expected);
    });

    it('un día solo y paginación', async () => {
      expect(ids((await get(`/sales?from=${D2}&to=${D2}`)).body as ListResult<SaleListItem>)).toEqual(['s5', 's4']);
      const page2 = await sales('&page=2&pageSize=2');
      expect(ids(page2)).toEqual(['s2', 's3']);
      expect(page2).toMatchObject({ count: 5, page: 2, pageSize: 2, netTotal: 550 });
    });

    it('el detalle del ticket: líneas con su total, ajuste, pagos y anulación', async () => {
      const s2 = (await get('/sales/s2')).body as SaleDetail;
      expect(s2).toMatchObject({
        lines: [{ kind: 'product', productId: 'p1', name: 'Alfajor', qty: 1, unitPrice: 500, discount: { type: 'amount', value: 50 }, total: 450 }],
        subtotal: 450, globalAdjustment: 0, payments: [{ method: 'debit', amount: 450 }],
      });
      const s3 = (await get('/sales/s3')).body as SaleDetail;
      expect(s3.lines.map((l) => l.name)).toEqual(['Fotocopias', 'Producto eliminado']);
      expect((await get('/sales/s4')).body).toMatchObject({ voidReason: 'Error', voidsSaleId: 's1', kind: 'void' });
      expect((await get('/sales/nada')).status).toBe(404);
    });

    it.each([
      [`/sales?from=${D2}&to=${D1}`],
      ['/sales?from=2025-01-01&to=2026-10-02'],
      ['/sales?from=ayer&to=2026-10-02'],
      [`/sales?from=${D1}&to=${D2}&pageSize=500`],
      [`/sales?from=${D1}&to=${D2}&status=raro`],
    ])('%s da 400', async (path) => {
      expect((await get(path)).status).toBe(400);
    });
  });
});
