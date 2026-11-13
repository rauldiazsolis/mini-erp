import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.ts';
import {
  createRootContainer,
  createTenantScope,
  tenantDbDef,
  catalogServiceDef,
  stockServiceDef,
  customerServiceDef,
  bulkServiceDef,
  importExportServiceDef,
  dashboardSummaryServiceDef,
  connectorServiceDef,
  authServiceDef,
  tenantManagerDef,
  apiKeyServiceDef,
} from '../src/server/di/container.ts';
import { CatalogService } from '../src/server/catalog/catalog-service.ts';
import { StockService } from '../src/server/stock/stock-service.ts';
import { CustomerService } from '../src/server/customer/customer-service.ts';
import { BulkService } from '../src/server/bulk/bulk-service.ts';
import { ImportExportService } from '../src/server/io/import-export-service.ts';
import { DashboardService } from '../src/server/dashboard/dashboard-service.ts';
import { ConnectorService } from '../src/server/connector/connector-service.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

describe('IoC Container (Hardwired) - Inversión de Control y Aislamiento Multitenant (Fase 5)', () => {
  /** Un contenedor con dos comercios ya creados (`t1` y `t2`), cada uno con su esquema. */
  async function rootWithTenants() {
    const root = createRootContainer({ database: db(), tenantManager: new TenantManager(db()) });
    const tenants = root.use(tenantManagerDef);
    await tenants.createTenant({ id: 't1', slug: 't1', name: 'Uno' });
    await tenants.createTenant({ id: 't2', slug: 't2', name: 'Dos' });
    return root;
  }

  describe('Contenedor Raíz y Dependencias de Infraestructura', () => {
    it('crea el contenedor raíz y resuelve los singletons de infraestructura', () => {
      const root = createRootContainer({ database: db() });

      const authService = root.use(authServiceDef);
      const tenantManager = root.use(tenantManagerDef);
      const apiKeyService = root.use(apiKeyServiceDef);

      expect(authService).toBeInstanceOf(AuthService);
      expect(tenantManager).toBeInstanceOf(TenantManager);
      expect(apiKeyService).toBeInstanceOf(ApiKeyService);

      // Los singletons deben ser la misma instancia en sucesivas llamadas
      expect(root.use(authServiceDef)).toBe(authService);
      expect(root.use(tenantManagerDef)).toBe(tenantManager);
    });

    it('falla inmediatamente con error descriptivo si se intenta resolver tenantDbDef en el contenedor raíz', () => {
      const root = createRootContainer({ database: db() });

      expect(() => {
        root.use(tenantDbDef);
      }).toThrow(/Cannot instantiate unbound definition "tenantDb"/);
    });

    it('falla inmediatamente si se intenta resolver cualquier servicio dependiente de tenantDb en el contenedor raíz (prevención de fugas)', () => {
      const root = createRootContainer({ database: db() });

      expect(() => root.use(catalogServiceDef)).toThrow(/unbound definition/);
      expect(() => root.use(stockServiceDef)).toThrow(/unbound definition/);
      expect(() => root.use(customerServiceDef)).toThrow(/unbound definition/);
      expect(() => root.use(bulkServiceDef)).toThrow(/unbound definition/);
      expect(() => root.use(importExportServiceDef)).toThrow(/unbound definition/);
      expect(() => root.use(dashboardSummaryServiceDef)).toThrow(/unbound definition/);
      expect(() => root.use(connectorServiceDef)).toThrow(/unbound definition/);
    });
  });

  describe('Scopes por Request / Tenant y Resolución de Servicios', () => {
    it('crea un scope con tenantDb vinculado y resuelve todos los servicios scoped con su DB', async () => {
      const root = await rootWithTenants();
      const scope1 = createTenantScope(root, 't1');

      const catalogSvc = scope1.use(catalogServiceDef);
      const stockSvc = scope1.use(stockServiceDef);
      const customerSvc = scope1.use(customerServiceDef);
      const bulkSvc = scope1.use(bulkServiceDef);
      const ioSvc = scope1.use(importExportServiceDef);
      const dashSvc = scope1.use(dashboardSummaryServiceDef);
      const connSvc = scope1.use(connectorServiceDef);

      expect(catalogSvc).toBeInstanceOf(CatalogService);
      expect(stockSvc).toBeInstanceOf(StockService);
      expect(customerSvc).toBeInstanceOf(CustomerService);
      expect(bulkSvc).toBeInstanceOf(BulkService);
      expect(ioSvc).toBeInstanceOf(ImportExportService);
      expect(dashSvc).toBeInstanceOf(DashboardService);
      expect(connSvc).toBeInstanceOf(ConnectorService);
    });

    it('cachea la instancia dentro del mismo scope (ciclo de vida scoped)', async () => {
      const root = await rootWithTenants();
      const scope1 = createTenantScope(root, 't1');

      const catalogSvcA = scope1.use(catalogServiceDef);
      const catalogSvcB = scope1.use(catalogServiceDef);

      expect(catalogSvcA).toBe(catalogSvcB);
    });

    it('garantiza aislamiento total entre tenants: dos scopes tienen instancias y bases de datos diferentes', async () => {
      const root = await rootWithTenants();
      const scopeTenant1 = createTenantScope(root, 't1');
      const scopeTenant2 = createTenantScope(root, 't2');

      const catalog1 = scopeTenant1.use(catalogServiceDef);
      const catalog2 = scopeTenant2.use(catalogServiceDef);

      expect(catalog1).not.toBe(catalog2);

      // Crear un producto en tenant 1 a través de su servicio resuelto
      await catalog1.createProduct({
        name: 'Yerba Mate 1Kg',
        sku: 'YM-1KG',
        price: 2500,
        category: 'Almacén',
      });

      // El producto debe existir en tenant 1
      const prodsTenant1 = await catalog1.listProducts();
      expect(prodsTenant1).toHaveLength(1);
      expect(prodsTenant1[0]?.name).toBe('Yerba Mate 1Kg');

      // En tenant 2, el catálogo debe permanecer completamente vacío (cero leakage)
      const prodsTenant2 = await catalog2.listProducts();
      expect(prodsTenant2).toHaveLength(0);
    });
  });

  describe('Integración HTTP con Express y Scopes de Request IoC', () => {
    it('aisla las peticiones HTTP entre tenants a través del middleware y req.tenantScope', async () => {
      const tenantManager = new TenantManager(db());
      const { app, rootContainer } = createApp({ database: db(), tenantManager });

      expect(rootContainer).toBeDefined();

      // 1. Crear usuario root y obtener token
      const t1Res = await request(app)
        .post('/api/alta')
        .send({ email: 'owner@sistema.com', password: 'password123', name: 'Dueño Sistema', businessName: 'Kiosco Alfa', businessType: 'otro', whatsapp: '1155550000' });
      expect(t1Res.status).toBe(201);
      const token = (t1Res.body as unknown as { token: string }).token;

      // 2. Un segundo comercio vacío para la misma cuenta
      const t2Res = await request(app)
        .post('/api/alta')
        .set('Authorization', `Bearer ${token}`)
        .send({ businessName: 'Kiosco Beta', businessType: 'otro', whatsapp: '1155550000' });
      expect(t2Res.status).toBe(201);

      // 3. Crear producto en Kiosco Alfa vía API HTTP
      const prodRes = await request(app)
        .post('/api/tenants/kiosco-alfa/products')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sku: 'ALF-CHOCO',
          name: 'Alfajor de Chocolate',
          price: 1200,
          category: 'Golosinas',
        });
      expect(prodRes.status).toBe(201);
      expect((prodRes.body as unknown as { sku: string }).sku).toBe('ALF-CHOCO');

      // 4. Consultar catálogo de Kiosco Beta vía API HTTP -> DEBE ESTAR VACÍO (aislamiento total)
      const betaCatalogRes = await request(app)
        .get('/api/tenants/kiosco-beta/products')
        .set('Authorization', `Bearer ${token}`);
      expect(betaCatalogRes.status).toBe(200);
      expect(betaCatalogRes.body).toHaveLength(0);

      // 5. Consultar catálogo de Kiosco Alfa vía API HTTP -> DEBE CONTENER EL PRODUCTO
      const alfaCatalogRes = await request(app)
        .get('/api/tenants/kiosco-alfa/products')
        .set('Authorization', `Bearer ${token}`);
      expect(alfaCatalogRes.status).toBe(200);
      expect(alfaCatalogRes.body).toHaveLength(1);
      expect((alfaCatalogRes.body as unknown as Array<{ sku: string }>)[0]?.sku).toBe('ALF-CHOCO');
    });
  });
});

