import { container, unbound, fn, type Container, type IContainer } from 'hardwired';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../db/system-db.ts';
import { TenantManager } from '../db/tenant-manager.ts';
import { AuthService } from '../auth/auth-service.ts';
import { ApiKeyService } from '../tenant/api-key-service.ts';
import { CatalogService } from '../catalog/catalog-service.ts';
import { StockService } from '../stock/stock-service.ts';
import { CustomerService } from '../customer/customer-service.ts';
import { BulkService } from '../bulk/bulk-service.ts';
import { ImportExportService } from '../io/import-export-service.ts';
import { DashboardService } from '../dashboard/dashboard-service.ts';
import { ConnectorService } from '../connector/connector-service.ts';

// --- DEFINICIONES DE BASE DE DATOS ---

/**
 * Definición singleton para la base de datos del sistema.
 * Por defecto abre el archivo configurado en SYSTEM_DB_PATH, y puede ser
 * sobreescrito con toValue() en createRootContainer (ej. en tests con :memory:).
 */
export const systemDbDef = fn.singleton<DatabaseSync>(() => {
  return openSystemDb(process.env['SYSTEM_DB_PATH'] ?? 'data/system.sqlite');
});
export const masterDbDef = systemDbDef;

/**
 * Definición no enlazada para la base de datos SQLite del tenant (scoped).
 * Si se intenta resolver en el contenedor raíz sin un scope por tenant, arroja un error explicativo
 * impidiendo cualquier fuga de aislamiento (tenant leakage).
 */
export const tenantDbDef = unbound<DatabaseSync>('tenantDb');

// --- DEFINICIONES SINGLETON DE APLICACIÓN ---

export const tenantManagerDef = fn.singleton((c) => new TenantManager(c.use(systemDbDef)));
export const authServiceDef = fn.singleton((c) => new AuthService(c.use(systemDbDef)));
export const apiKeyServiceDef = fn.singleton((c) => new ApiKeyService(c.use(systemDbDef)));

// --- DEFINICIONES SCOPED POR REQUEST / TENANT ---

export const catalogServiceDef = fn.scoped((c) => new CatalogService(c.use(tenantDbDef)));
export const stockServiceDef = fn.scoped((c) => new StockService(c.use(tenantDbDef)));
export const customerServiceDef = fn.scoped((c) => new CustomerService(c.use(tenantDbDef)));
export const bulkServiceDef = fn.scoped((c) => new BulkService(c.use(tenantDbDef)));
export const importExportServiceDef = fn.scoped((c) => new ImportExportService(c.use(tenantDbDef)));
export const dashboardSummaryServiceDef = fn.scoped((c) => new DashboardService(c.use(tenantDbDef)));
export const dashboardServiceDef = dashboardSummaryServiceDef;
export const connectorServiceDef = fn.scoped((c) => new ConnectorService(c.use(tenantDbDef)));

// --- FÁBRICAS DE CONTENEDOR Y SCOPES ---

export type ContainerDependencies = {
  systemDb?: DatabaseSync;
  tenantManager?: TenantManager;
};

/**
 * Crea e inicializa el contenedor raíz de Hardwired con las dependencias globales del sistema.
 */
export function createRootContainer(deps?: ContainerDependencies): Container {
  return container.new((c) => {
    if (deps?.systemDb !== undefined) {
      c.bindCascading(systemDbDef).toValue(deps.systemDb);
    }

    if (deps?.tenantManager !== undefined) {
      c.bindCascading(tenantManagerDef).toValue(deps.tenantManager);
    }
  });
}

/**
 * Genera un scope acotado al ciclo de vida de la request vinculando la base de datos del tenant activo.
 */
export function createTenantScope(root: Container, tenantDb: DatabaseSync): IContainer {
  return root.scope((s) => {
    s.bind(tenantDbDef).toValue(tenantDb);
  });
}
