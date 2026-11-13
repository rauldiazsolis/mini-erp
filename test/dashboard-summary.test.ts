import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { jsonValue } from '../src/server/db/pg/sql-helpers.ts';
import { saveSale } from '../src/server/sales/records.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

interface DashboardSummaryResponse {
  period: string;
  summary: {
    totalSales: number;
    salesCount: number;
    averageTicket: number;
    totalReceivables: number;
    debtorCount: number;
  };
  timeline: Array<{ date: string; salesCount: number; totalSales: number }>;
  topProducts: Array<{
    productId: string;
    name: string;
    unitsSold: number;
    totalRevenue: number;
  }>;
  stockAlerts: {
    lowStockProducts: unknown[];
  };
}

describe('Dashboard Summary API & Analytics (Etapa 3.2)', () => {
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-dash-test';

  beforeEach(async () => {
    tenantManager = new TenantManager(db(), { inMemory: true });
    const bundle = createApp({ database: db(), tenantManager });
    app = bundle.app;

    // Registrar admin
    const registerRes = await bundle.authService.createUser({
      email: 'admin@dashboard.test',
      password: 'password123',
      name: 'Admin Dashboard',
    });
    adminToken = registerRes.token;

    // Crear tenant con datos demo
    await tenantManager.createTenant({
      id: tenantId,
      slug: 'kiosco-dash-test',
      name: 'Kiosco Dashboard Test',
      ownerUserId: registerRes.user.id,
    });

    // Catálogo y ventas de los últimos días en PostgreSQL (la semilla y su generador todavía escriben
    // SQLite): fechas relativas a ahora, en la caja de CENTRAL
    const tenantDb = db().forTenant(tenantId);
    const nowIso = new Date().toISOString();
    await tenantDb
      .insertInto('products')
      .values([
        { id: 'p-alfajor', sku: 'ALF', name: 'Alfajor', price: 1000, tracks_stock: true, created_at: nowIso, updated_at: nowIso },
        { id: 'p-gaseosa', sku: 'GAS', name: 'Gaseosa', price: 1500, tracks_stock: true, created_at: nowIso, updated_at: nowIso },
      ])
      .execute();
    await tenantDb
      .insertInto('stock')
      .values([
        { product_id: 'p-alfajor', branch_id: 'branch-central', quantity: 3, updated_at: nowIso },
        { product_id: 'p-gaseosa', branch_id: 'branch-central', quantity: 40, updated_at: nowIso },
      ])
      .execute();
    const caja = { deviceId: 'pos_caja_1', branch: 'CENTRAL', pointOfSale: 'Caja 1' };
    for (const daysAgo of [0, 1, 2, 3]) {
      const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
      await saveSale(
        tenantDb,
        {
          id: `venta-${String(daysAgo)}`,
          status: 'closed',
          createdAt,
          total: 3500,
          lines: [
            { kind: 'product', productId: 'p-alfajor', qty: 2, unitPrice: 1000 },
            { kind: 'product', productId: 'p-gaseosa', qty: 1, unitPrice: 1500 },
          ],
          payments: [{ method: 'cash', amount: 3500 }],
        },
        caja,
        createdAt,
      );
    }
  });

  afterEach(() => {
    tenantManager.closeAll();
  });

  it('requiere autenticación admin para consultar el resumen del dashboard', async () => {
    const res = await request(app).get(`/api/tenants/${tenantId}/dashboard/summary`);
    expect(res.status).toBe(401);
  });

  it('devuelve métricas consolidadas con período week por defecto o solicitado', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=week`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const body = res.body as unknown as DashboardSummaryResponse;
    expect(body).toHaveProperty('period', 'week');
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('totalSales');
    expect(body.summary).toHaveProperty('salesCount');
    expect(body.summary).toHaveProperty('averageTicket');
    expect(body.summary).toHaveProperty('totalReceivables');
    expect(body.summary).toHaveProperty('debtorCount');

    // Dado que se ejecutó generateHistoricalDemoActivity (últimos 7 días)
    expect(body.summary.salesCount).toBeGreaterThan(0);
    expect(body.summary.totalSales).toBeGreaterThan(0);
    expect(body.summary.averageTicket).toBeGreaterThan(0);

    // Debe incluir timeline con 7 días
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(body.timeline.length).toBe(7);

    // Debe incluir top products
    expect(Array.isArray(body.topProducts)).toBe(true);
    expect(body.topProducts.length).toBeGreaterThan(0);
    expect(body.topProducts[0]).toHaveProperty('productId');
    expect(body.topProducts[0]).toHaveProperty('name');
    expect(body.topProducts[0]).toHaveProperty('unitsSold');
    expect(body.topProducts[0]).toHaveProperty('totalRevenue');

    // Debe incluir alertas de stock
    expect(body).toHaveProperty('stockAlerts');
    expect(Array.isArray(body.stockAlerts.lowStockProducts)).toBe(true);
  });

  it('devuelve métricas para período today', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const body = res.body as unknown as DashboardSummaryResponse;
    expect(body.period).toBe('today');
    expect(body.summary.salesCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.timeline)).toBe(true);
  });

  it('permite filtrar métricas por sucursal', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=week&branchId=CENTRAL`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const body = res.body as unknown as DashboardSummaryResponse;
    expect(body.summary.salesCount).toBeGreaterThan(0);

    // Filtrar por sucursal inexistente debe devolver 0 ventas
    const emptyRes = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=week&branchId=INEXISTENTE`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(emptyRes.status).toBe(200);
    const emptyBody = emptyRes.body as unknown as DashboardSummaryResponse;
    expect(emptyBody.summary.salesCount).toBe(0);
    expect(emptyBody.summary.totalSales).toBe(0);
  });

  it('la sucursal es su código, también para las alertas de stock (#59)', async () => {
    const tenantDb = db().forTenant(tenantId);
    const now = new Date().toISOString();
    const central = await tenantDb.selectFrom('branches').select('id').where('code', '=', 'CENTRAL').executeTakeFirstOrThrow();
    await tenantDb.insertInto('branches').values({ id: 'branch-norte', name: 'Sucursal Norte', code: 'NORTE', created_at: now }).execute();
    await tenantDb
      .insertInto('products')
      .values({ id: 'p-solo-norte', sku: 'SOLO-NORTE', name: 'Solo en Norte', price: 100, category: 'General', tracks_stock: true, created_at: now, updated_at: now })
      .execute();
    await tenantDb
      .insertInto('stock')
      .values([
        { product_id: 'p-solo-norte', branch_id: central.id, quantity: 0, updated_at: now },
        { product_id: 'p-solo-norte', branch_id: 'branch-norte', quantity: 50, updated_at: now },
      ])
      .execute();

    const alerted = async (query: string): Promise<boolean> => {
      const res = await request(app).get(`/api/tenants/${tenantId}/dashboard/summary?period=week${query}`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const body = res.body as unknown as { stockAlerts: { lowStockProducts: Array<{ id: string }> } };
      return body.stockAlerts.lowStockProducts.some((p) => p.id === 'p-solo-norte');
    };

    expect(await alerted('')).toBe(false);
    expect(await alerted('&branchId=CENTRAL')).toBe(true);
    expect(await alerted('&branchId=NORTE')).toBe(false);
  });

  it('excluye ventas anuladas de los totales y del ranking de más vendidos', async () => {
    const tenantDb = db().forTenant(tenantId);
    const nowIso = new Date().toISOString();
    const base = { device_id: 'dev1', branch: 'CENTRAL', point_of_sale: 'Caja 1', total: 50000, created_at: nowIso };

    // Insertar venta original y su anulación
    await tenantDb
      .insertInto('sales')
      .values([
        {
          ...base,
          id: 'sale-original-to-void',
          payload: jsonValue({
            id: 'sale-original-to-void',
            total: 50000,
            lines: [{ productId: 'prod_test_void', name: 'Super Producto', qty: 10, unitPrice: 5000, lineTotal: 50000 }],
          }),
          voids_sale_id: null,
        },
        { ...base, id: 'sale-void-action', payload: jsonValue({ id: 'sale-void-action' }), voids_sale_id: 'sale-original-to-void' },
      ])
      .execute();

    const res = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const body = res.body as unknown as DashboardSummaryResponse;
    // La venta de 50000 no debe estar en totalSales ni en topProducts
    const topProdNames = body.topProducts.map((p) => p.name);
    expect(topProdNames).not.toContain('Super Producto');
  });
});
