import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import type {
  CashMovementItem, CashSummaryResult, CustomerPaymentItem, DaySummaryResult, ListResult, SaleDetail, SaleListItem,
} from '../src/shared/sales-types.ts';
import { argentinaToday } from '../src/shared/argentina-day.ts';
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
    // Con bono: las ventas con fechas fijas no dejan al comercio restringido cuando pase la gracia (#21)
    bundle.billing.grantSignupBonus(tenantId, owner.user.id);
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

  describe('cobranzas y movimientos', () => {
    it('cobranzas con recibo, cliente y anulación', async () => {
      const list = (await get(`/customer-payments?from=${D1}&to=${D2}`)).body as ListResult<CustomerPaymentItem>;
      expect(ids(list)).toEqual(['cp2', 'cp1']);
      expect(list).toMatchObject({ count: 2, netTotal: 0 });
      expect(list.items[1]).toEqual({
        id: 'cp1', day: D1, createdAt: `${D1}T15:00:00.000Z`, receipt: { date: D1, number: 1 }, branch: 'CENTRAL', pointOfSale: 'Caja 1',
        customer: { id: 'c1', name: 'Ana' }, payments: [{ method: 'cash', amount: 700 }], total: 700, voided: true, voidedBy: 'cp2',
      });
      expect(list.items[0]).toMatchObject({ voidsPaymentId: 'cp1', voided: false });
      const filtered = async (q: string) => ids((await get(`/customer-payments?from=${D1}&to=${D2}${q}`)).body as ListResult<CustomerPaymentItem>);
      expect(await filtered('&status=voided')).toEqual(['cp1']);
      expect(await filtered('&status=valid')).toEqual([]);
      expect(await filtered('&method=transfer')).toEqual([]);
      expect(await filtered('&customerId=c1')).toEqual(['cp2', 'cp1']);
    });

    it('la cobranza del admin aparece en la caja ADMIN', async () => {
      await request(app).post(`/api/tenants/${tenantId}/customers/c1/payments`).set('Authorization', `Bearer ${token}`).send({ amount: 100, method: 'transfer' });
      const today = argentinaToday(new Date());
      const list = (await get(`/customer-payments?from=${today}&to=${today}`)).body as ListResult<CustomerPaymentItem>;
      // Si hoy es D2, en la lista también está cp2: se busca por la caja
      const admin = list.items.find((p) => p.branch === 'ADMIN');
      expect(admin).toMatchObject({ pointOfSale: 'Oficina', payments: [{ method: 'transfer', amount: 100 }], total: 100 });
      expect(admin?.receipt).toBeUndefined();
      expect((await get(`/customer-payments?from=${today}&to=${today}&branch=ADMIN`)).body).toMatchObject({ count: 1 });
    });

    it('movimientos de caja con arqueo y total neto con signo', async () => {
      const list = (await get(`/cash-movements?from=${D1}&to=${D2}`)).body as ListResult<CashMovementItem>;
      expect(ids(list)).toEqual(['m3', 'm2', 'm1']);
      expect(list).toMatchObject({ count: 3, netTotal: 1350 });
      expect(list.items[0]).toEqual({
        id: 'm3', day: D1, createdAt: `${D1}T21:00:00.000Z`, branch: 'CENTRAL', pointOfSale: 'Caja 1', direction: 'out', amount: 150,
        concept: 'Ajuste por arqueo', source: 'count-adjustment', count: { expected: 3200, counted: 3050 },
      });
      const filtered = async (q: string) => ids((await get(`/cash-movements?from=${D1}&to=${D2}${q}`)).body as ListResult<CashMovementItem>);
      expect(await filtered('&direction=in')).toEqual(['m1']);
      expect(await filtered('&source=count-adjustment')).toEqual(['m3']);
      expect(await filtered('&source=manual&direction=out')).toEqual(['m2']);
      expect((await get(`/cash-movements?from=${D1}&to=${D2}&direction=lateral`)).status).toBe(400);
    });
  });

  describe('resumen por caja y día', () => {
    it('una fila por día y caja, con totales', async () => {
      const res = (await get(`/cash-summary?from=${D1}&to=${D2}`)).body as CashSummaryResult;
      expect(res.rows).toEqual([
        { day: D2, branch: 'CENTRAL', pointOfSale: 'Caja 1', totalSold: -1200, ticketCount: 2, voidedCount: 0, collectionsTotal: -700, cashIncome: 0, cashExpense: 0, cashCountAdjustments: 0, cashNet: -1900 },
        { day: D1, branch: 'CENTRAL', pointOfSale: 'Caja 1', totalSold: 1450, ticketCount: 2, voidedCount: 1, collectionsTotal: 700, cashIncome: 2000, cashExpense: 500, cashCountAdjustments: -150, cashNet: 3050 },
        { day: D1, branch: 'CENTRAL', pointOfSale: 'Caja 2', totalSold: 300, ticketCount: 1, voidedCount: 0, collectionsTotal: 0, cashIncome: 0, cashExpense: 0, cashCountAdjustments: 0, cashNet: 0 },
      ]);
      expect(res.totals).toEqual({ totalSold: 550, ticketCount: 5, voidedCount: 1, collectionsTotal: 0, cashIncome: 2000, cashExpense: 500, cashCountAdjustments: -150, cashNet: 1150 });
      const soloCaja2 = (await get(`/cash-summary?from=${D1}&to=${D2}&pointOfSale=Caja%202`)).body as CashSummaryResult;
      expect(soloCaja2.rows).toHaveLength(1);
    });

    it('el día de una caja cuadra con el /RESUMEN y trae sus movimientos', async () => {
      const res = (await get(`/cash-summary/day?day=${D1}&branch=CENTRAL&pointOfSale=Caja%201`)).body as DaySummaryResult;
      // Calculado a mano con las reglas del /RESUMEN: s1 + s2 (la anulación de s1 es de D2), cp1, m1, m2 y m3
      expect(res.summary).toEqual({
        totalSold: 1450,
        ticketCount: 2,
        voidedCount: 1,
        adjustmentTotal: -50,
        totalsByMethod: { cash: 1000, debit: 450, credit: 0, transfer: 0, qr: 0, account: 0, other: 0 },
        otherPayments: 450,
        cash: { sales: 1000, income: 2000, expense: 500, countAdjustments: -150, collections: 700 },
        collections: { total: 700, count: 1, voidedCount: 1 },
        collectionsByMethod: { cash: 700, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0, other: 0 },
      });
      expect(res.entries.map((e) => `${e.kind}:${e.kind === 'sale' ? e.sale.id : e.kind === 'movement' ? e.movement.id : e.payment.id}`)).toEqual([
        'movement:m3', 'movement:m2', 'collection:cp1', 'sale:s2', 'sale:s1', 'movement:m1',
      ]);
      expect((await get('/cash-summary/day?day=ayer')).status).toBe(400);
    });
  });
});
