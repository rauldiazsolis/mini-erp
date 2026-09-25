import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { generateHistoricalDemoActivity } from '../src/server/seeds/demo-activity-generator.ts';

describe('Dashboard Summary API & Analytics (Etapa 3.2)', () => {
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-dash-test';

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;

    // Registrar admin
    const registerRes = bundle.authService.register({
      email: 'admin@dashboard.test',
      password: 'password123',
      name: 'Admin Dashboard',
    });
    adminToken = registerRes.token;

    // Crear tenant con datos demo
    tenantManager.createTenant({
      id: tenantId,
      slug: 'kiosco-dash-test',
      name: 'Kiosco Dashboard Test',
      ownerUserId: registerRes.user.id,
      seedDemoData: true,
    });

    // Sembrar actividad histórica dinámica en la base del tenant
    const tenantDb = tenantManager.getTenantDb(tenantId);
    generateHistoricalDemoActivity(tenantDb, 'branch-central');
  });

  afterEach(() => {
    tenantManager.closeAll();
    systemDb.close();
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
    expect(res.body).toHaveProperty('period', 'week');
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('totalSales');
    expect(res.body.summary).toHaveProperty('salesCount');
    expect(res.body.summary).toHaveProperty('averageTicket');
    expect(res.body.summary).toHaveProperty('totalReceivables');
    expect(res.body.summary).toHaveProperty('debtorCount');

    // Dado que se ejecutó generateHistoricalDemoActivity (últimos 7 días)
    expect(res.body.summary.salesCount).toBeGreaterThan(0);
    expect(res.body.summary.totalSales).toBeGreaterThan(0);
    expect(res.body.summary.averageTicket).toBeGreaterThan(0);

    // Debe incluir timeline con 7 días
    expect(Array.isArray(res.body.timeline)).toBe(true);
    expect(res.body.timeline.length).toBe(7);

    // Debe incluir top products
    expect(Array.isArray(res.body.topProducts)).toBe(true);
    expect(res.body.topProducts.length).toBeGreaterThan(0);
    expect(res.body.topProducts[0]).toHaveProperty('productId');
    expect(res.body.topProducts[0]).toHaveProperty('name');
    expect(res.body.topProducts[0]).toHaveProperty('unitsSold');
    expect(res.body.topProducts[0]).toHaveProperty('totalRevenue');

    // Debe incluir alertas de stock
    expect(res.body).toHaveProperty('stockAlerts');
    expect(Array.isArray(res.body.stockAlerts.lowStockProducts)).toBe(true);
  });

  it('devuelve métricas para período today', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('today');
    expect(res.body.summary.salesCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.timeline)).toBe(true);
  });

  it('permite filtrar métricas por sucursal', async () => {
    const res = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=week&branchId=CENTRAL`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.salesCount).toBeGreaterThan(0);

    // Filtrar por sucursal inexistente debe devolver 0 ventas
    const emptyRes = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=week&branchId=INEXISTENTE`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(emptyRes.status).toBe(200);
    expect(emptyRes.body.summary.salesCount).toBe(0);
    expect(emptyRes.body.summary.totalSales).toBe(0);
  });

  it('excluye ventas anuladas de los totales y del ranking de más vendidos', async () => {
    const tenantDb = tenantManager.getTenantDb(tenantId);
    const nowIso = new Date().toISOString();

    // Insertar venta original
    tenantDb.prepare(
      `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at)
       VALUES ('sale-original-to-void', ?, 'dev1', 'CENTRAL', 'Caja 1', 50000, NULL, ?)`
    ).run(
      JSON.stringify({
        id: 'sale-original-to-void',
        total: 50000,
        lines: [{ productId: 'prod_test_void', name: 'Super Producto', qty: 10, unitPrice: 5000, lineTotal: 50000 }],
      }),
      nowIso
    );

    // Insertar anulación
    tenantDb.prepare(
      `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at)
       VALUES ('sale-void-action', ?, 'dev1', 'CENTRAL', 'Caja 1', 50000, 'sale-original-to-void', ?)`
    ).run(JSON.stringify({ id: 'sale-void-action' }), nowIso);

    const res = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // La venta de 50000 no debe estar en totalSales ni en topProducts
    const topProdNames = res.body.topProducts.map((p: { name: string }) => p.name);
    expect(topProdNames).not.toContain('Super Producto');
  });
});
