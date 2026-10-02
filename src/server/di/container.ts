import { container, unbound, fn, type Container, type IContainer } from 'hardwired';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../db/system-db.ts';
import { dataDir } from '../db/data-dir.ts';
import { join } from 'node:path';
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
import { readDemoConfig, type DemoConfig } from '../demo/demo-config.ts';
import { DemoSessionService } from '../demo/demo-session-service.ts';
import { AuditLog } from '../audit/audit-log.ts';
import { MembershipService } from '../users/membership-service.ts';
import { AltaService } from '../alta/alta-service.ts';
import { InvitationService } from '../users/invitation-service.ts';
import { PasswordResetService } from '../users/password-reset-service.ts';
import { DiscrepancyService } from '../discrepancy/discrepancy-service.ts';
import { SalesQueryService } from '../sales/sales-query-service.ts';

// --- DEFINICIONES DE BASE DE DATOS ---

/**
 * Definición singleton para la base de datos del sistema: `<DATA_DIR>/system.sqlite`, la misma que
 * migra el arranque (#47). En tests se sobreescribe con toValue() en createRootContainer.
 */
export const systemDbDef = fn.singleton<DatabaseSync>(() => {
  return openSystemDb(join(dataDir(), 'system.sqlite'));
});
export const masterDbDef = systemDbDef;

/**
 * Definición no enlazada para la base de datos SQLite del tenant (scoped).
 * Si se intenta resolver en el contenedor raíz sin un scope por tenant, arroja un error explicativo
 * impidiendo cualquier fuga de aislamiento (tenant leakage).
 */
export const tenantDbDef = unbound<DatabaseSync>('tenantDb');

// --- DEFINICIONES SINGLETON DE APLICACIÓN ---

export const tenantManagerDef = fn.singleton(
  (c) => new TenantManager(c.use(systemDbDef), { baseDir: join(dataDir(), 'tenants') }),
);
export const authServiceDef = fn.singleton((c) => new AuthService(c.use(systemDbDef)));
export const apiKeyServiceDef = fn.singleton((c) => new ApiKeyService(c.use(systemDbDef)));

// --- DEMOS (#9) ---

export const demoConfigDef = fn.singleton((): DemoConfig => readDemoConfig(process.env));
export const clockDef = fn.singleton((): (() => Date) => () => new Date());
export const demoSessionServiceDef = fn.singleton(
  (c) =>
    new DemoSessionService({
      systemDb: c.use(systemDbDef),
      tenantManager: c.use(tenantManagerDef),
      apiKeyService: c.use(apiKeyServiceDef),
      config: c.use(demoConfigDef),
      now: c.use(clockDef),
    }),
);

// --- USUARIOS Y AUDITORÍA (#19) ---

export const auditLogDef = fn.singleton((c) => new AuditLog(c.use(systemDbDef), c.use(clockDef)));
export const membershipServiceDef = fn.singleton((c) => new MembershipService(c.use(systemDbDef), c.use(auditLogDef)));
export const invitationServiceDef = fn.singleton(
  (c) =>
    new InvitationService({
      db: c.use(systemDbDef),
      auth: c.use(authServiceDef),
      members: c.use(membershipServiceDef),
      audit: c.use(auditLogDef),
      now: c.use(clockDef),
    }),
);
export const altaServiceDef = fn.singleton(
  (c) =>
    new AltaService({
      auth: c.use(authServiceDef),
      tenants: c.use(tenantManagerDef),
      apiKeys: c.use(apiKeyServiceDef),
      audit: c.use(auditLogDef),
    }),
);

export const passwordResetServiceDef = fn.singleton(
  (c) =>
    new PasswordResetService({
      db: c.use(systemDbDef),
      auth: c.use(authServiceDef),
      members: c.use(membershipServiceDef),
      audit: c.use(auditLogDef),
      now: c.use(clockDef),
    }),
);

// --- DEFINICIONES SCOPED POR REQUEST / TENANT ---

export const catalogServiceDef = fn.scoped((c) => new CatalogService(c.use(tenantDbDef)));
export const stockServiceDef = fn.scoped((c) => new StockService(c.use(tenantDbDef)));
export const customerServiceDef = fn.scoped((c) => new CustomerService(c.use(tenantDbDef)));
export const bulkServiceDef = fn.scoped((c) => new BulkService(c.use(tenantDbDef)));
export const importExportServiceDef = fn.scoped((c) => new ImportExportService(c.use(tenantDbDef)));
export const dashboardSummaryServiceDef = fn.scoped((c) => new DashboardService(c.use(tenantDbDef)));
export const dashboardServiceDef = dashboardSummaryServiceDef;
export const connectorServiceDef = fn.scoped((c) => new ConnectorService(c.use(tenantDbDef)));
export const discrepancyServiceDef = fn.scoped((c) => new DiscrepancyService(c.use(tenantDbDef)));
export const salesQueryServiceDef = fn.scoped((c) => new SalesQueryService(c.use(tenantDbDef)));

// --- FÁBRICAS DE CONTENEDOR Y SCOPES ---

export type ContainerDependencies = {
  systemDb?: DatabaseSync | undefined;
  tenantManager?: TenantManager | undefined;
  demoConfig?: DemoConfig | undefined;
  now?: (() => Date) | undefined;
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

    if (deps?.demoConfig !== undefined) {
      c.bindCascading(demoConfigDef).toValue(deps.demoConfig);
    }

    if (deps?.now !== undefined) {
      c.bindCascading(clockDef).toValue(deps.now);
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
