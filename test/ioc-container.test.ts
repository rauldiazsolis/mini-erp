import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
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

describe('IoC Container (Hardwired) - Inversión de Control y Aislamiento Multitenant (Fase 5)', () => {
  let systemDb: DatabaseSync;
  let tenant1Db: DatabaseSync;
  let tenant2Db: DatabaseSync;

  beforeEach(() => {
    systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);

    tenant1Db = new DatabaseSync(':memory:');
    initTenantDb(tenant1Db);

    tenant2Db = new DatabaseSync(':memory:');
    initTenantDb(tenant2Db);
  });

  describe('Contenedor Raíz y Dependencias de Infraestructura', () => {
    it('crea el contenedor raíz y resuelve los singletons de infraestructura', () => {
      const root = createRootContainer({ systemDb });

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
      const root = createRootContainer({ systemDb });

      expect(() => {
        root.use(tenantDbDef);
      }).toThrow(/Cannot instantiate unbound definition "tenantDb"/);
    });

    it('falla inmediatamente si se intenta resolver cualquier servicio dependiente de tenantDb en el contenedor raíz (prevención de fugas)', () => {
      const root = createRootContainer({ systemDb });

      expect(() => root.use(catalogServiceDef)).toThrow(/tenantDb/);
      expect(() => root.use(stockServiceDef)).toThrow(/tenantDb/);
      expect(() => root.use(customerServiceDef)).toThrow(/tenantDb/);
      expect(() => root.use(bulkServiceDef)).toThrow(/tenantDb/);
      expect(() => root.use(importExportServiceDef)).toThrow(/tenantDb/);
      expect(() => root.use(dashboardSummaryServiceDef)).toThrow(/tenantDb/);
      expect(() => root.use(connectorServiceDef)).toThrow(/tenantDb/);
    });
  });

  describe('Scopes por Request / Tenant y Resolución de Servicios', () => {
    it('crea un scope con tenantDb vinculado y resuelve todos los servicios scoped con su DB', () => {
      const root = createRootContainer({ systemDb });
      const scope1 = createTenantScope(root, tenant1Db);

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

    it('cachea la instancia dentro del mismo scope (ciclo de vida scoped)', () => {
      const root = createRootContainer({ systemDb });
      const scope1 = createTenantScope(root, tenant1Db);

      const catalogSvcA = scope1.use(catalogServiceDef);
      const catalogSvcB = scope1.use(catalogServiceDef);

      expect(catalogSvcA).toBe(catalogSvcB);
    });

    it('garantiza aislamiento total entre tenants: dos scopes tienen instancias y bases de datos diferentes', () => {
      const root = createRootContainer({ systemDb });
      const scopeTenant1 = createTenantScope(root, tenant1Db);
      const scopeTenant2 = createTenantScope(root, tenant2Db);

      const catalog1 = scopeTenant1.use(catalogServiceDef);
      const catalog2 = scopeTenant2.use(catalogServiceDef);

      expect(catalog1).not.toBe(catalog2);

      // Crear un producto en tenant 1 a través de su servicio resuelto
      catalog1.createProduct({
        name: 'Yerba Mate 1Kg',
        sku: 'YM-1KG',
        price: 2500,
        category: 'Almacén',
      });

      // El producto debe existir en tenant 1
      const prodsTenant1 = catalog1.listProducts();
      expect(prodsTenant1).toHaveLength(1);
      expect(prodsTenant1[0]?.name).toBe('Yerba Mate 1Kg');

      // En tenant 2, el catálogo debe permanecer completamente vacío (cero leakage)
      const prodsTenant2 = catalog2.listProducts();
      expect(prodsTenant2).toHaveLength(0);
    });
  });
});
