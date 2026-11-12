import { container, unbound, fn, type Container, type IContainer } from 'hardwired';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import { createDatabase, databaseUrl, type Database } from '../db/pg/database.ts';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
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
import { ImportService } from '../io/import-service.ts';
import { DashboardService } from '../dashboard/dashboard-service.ts';
import { ConnectorService } from '../connector/connector-service.ts';
import { readDemoConfig, type DemoConfig } from '../demo/demo-config.ts';
import { DemoSessionService } from '../demo/demo-session-service.ts';
import { DemoResetService } from '../demo/demo-reset-service.ts';
import { PortalService } from '../portal/portal-service.ts';
import { AuditLog } from '../audit/audit-log.ts';
import { MembershipService } from '../users/membership-service.ts';
import { AltaService } from '../alta/alta-service.ts';
import { InvitationService } from '../users/invitation-service.ts';
import { PasswordResetService } from '../users/password-reset-service.ts';
import { DiscrepancyService } from '../discrepancy/discrepancy-service.ts';
import { SalesQueryService } from '../sales/sales-query-service.ts';
import { RegisterService } from '../registers/register-service.ts';
import { SuspensionService } from '../platform/suspension-service.ts';
import { UserStatusService } from '../platform/user-status-service.ts';
import { StaffInvitationService } from '../platform/staff-invitation-service.ts';
import { PlatformQueryService } from '../platform/platform-query-service.ts';
import { BillingService } from '../billing/billing-service.ts';
import { sqliteBillingBridge } from '../billing/legacy-bridge.ts';
import { ImpersonationService } from '../impersonation/impersonation-service.ts';
import { HelpRequestService } from '../help/help-request-service.ts';
import { FunnelService } from '../funnel/funnel-service.ts';
import { FunnelQueryService } from '../funnel/funnel-query-service.ts';

// --- DEFINICIONES DE BASE DE DATOS ---

/**
 * La base de PostgreSQL (un solo pool, de `DATABASE_URL`). En tests y en el arranque se pasa con
 * `database` en `createRootContainer`. Los servicios nunca la reciben entera: los de sistema usan
 * `systemKyselyDef`.
 */
export const databaseDef = fn.singleton<Database>(() => createDatabase({ connectionString: databaseUrl() }));

/** Lo global en PostgreSQL (`Database.system`): lo que reciben los servicios de sistema ya migrados. */
export const systemKyselyDef = fn.singleton((c): Kysely<SystemDatabase> => c.use(databaseDef).system);

/**
 * Definición singleton para la base de datos del sistema: `<DATA_DIR>/system.sqlite`, la misma que
 * migra el arranque (#47). En tests se sobreescribe con toValue() en createRootContainer.
 * Fase 3 de PostgreSQL: la usan los servicios de sistema que todavía no se migraron; se borra con el último.
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
  (c) => new TenantManager(c.use(systemKyselyDef), { baseDir: join(dataDir(), 'tenants') }),
);
export const apiKeyServiceDef = fn.singleton((c) => new ApiKeyService(c.use(systemKyselyDef)));

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

export const demoResetServiceDef = fn.singleton(
  (c) =>
    new DemoResetService({
      systemDb: c.use(systemDbDef),
      tenantManager: c.use(tenantManagerDef),
      sessions: c.use(demoSessionServiceDef),
      now: c.use(clockDef),
    }),
);

// --- CAJAS (#21) ---

export const registerServiceDef = fn.singleton((c) => new RegisterService(c.use(systemKyselyDef), c.use(clockDef)));

// --- COBRO (#21) ---

// Las suspensiones y la marca de demo siguen en SQLite hasta los dominios 5 y 7 (puente temporal)
export const billingServiceDef = fn.singleton(
  (c) => new BillingService({ db: c.use(systemKyselyDef), now: c.use(clockDef), legacy: sqliteBillingBridge(c.use(systemDbDef)) }),
);

// --- USUARIOS Y AUDITORÍA (#19) ---

export const auditLogDef = fn.singleton((c) => new AuditLog(c.use(systemKyselyDef), c.use(clockDef)));

// El embudo (#25): eventos, totales del landing y contactos
export const funnelServiceDef = fn.singleton((c) => new FunnelService({ db: c.use(systemDbDef), now: c.use(clockDef) }));
export const funnelQueryServiceDef = fn.singleton((c) => new FunnelQueryService({ db: c.use(systemDbDef) }));

// El portal y el acceso anónimo (#24, M10): demos y cajas reales; audita las aperturas de las cajas
export const portalServiceDef = fn.singleton(
  (c) =>
    new PortalService({
      systemDb: c.use(systemDbDef),
      now: c.use(clockDef),
      demos: c.use(demoSessionServiceDef),
      audit: c.use(auditLogDef),
      funnel: c.use(funnelServiceDef),
      apiKeys: c.use(apiKeyServiceDef),
    }),
);
export const authServiceDef = fn.singleton((c) => new AuthService(c.use(systemKyselyDef), { now: c.use(clockDef), audit: c.use(auditLogDef) }));
export const membershipServiceDef = fn.singleton((c) => new MembershipService(c.use(systemKyselyDef), c.use(auditLogDef)));
export const invitationServiceDef = fn.singleton(
  (c) =>
    new InvitationService({
      db: c.use(systemKyselyDef),
      auth: c.use(authServiceDef),
      members: c.use(membershipServiceDef),
      audit: c.use(auditLogDef),
      now: c.use(clockDef),
    }),
);
// --- IMPERSONACIÓN (#23, M7b) ---

export const helpRequestServiceDef = fn.singleton(
  (c) => new HelpRequestService({ db: c.use(systemDbDef), now: c.use(clockDef), billing: c.use(billingServiceDef) }),
);
export const impersonationServiceDef = fn.singleton(
  (c) =>
    new ImpersonationService({ db: c.use(systemDbDef), auth: c.use(authServiceDef), audit: c.use(auditLogDef), help: c.use(helpRequestServiceDef) }),
);

// --- PLATAFORMA (#23) ---

export const suspensionServiceDef = fn.singleton(
  (c) => new SuspensionService({ db: c.use(systemDbDef), audit: c.use(auditLogDef), now: c.use(clockDef) }),
);
export const userStatusServiceDef = fn.singleton(
  (c) => new UserStatusService({ db: c.use(systemDbDef), auth: c.use(authServiceDef), audit: c.use(auditLogDef) }),
);
export const staffInvitationServiceDef = fn.singleton(
  (c) => new StaffInvitationService({ db: c.use(systemDbDef), auth: c.use(authServiceDef), audit: c.use(auditLogDef), now: c.use(clockDef) }),
);
export const platformQueryServiceDef = fn.singleton(
  (c) => new PlatformQueryService({ db: c.use(systemDbDef), billing: c.use(billingServiceDef), members: c.use(membershipServiceDef) }),
);
export const altaServiceDef = fn.singleton(
  (c) =>
    new AltaService({
      auth: c.use(authServiceDef),
      tenants: c.use(tenantManagerDef),
      apiKeys: c.use(apiKeyServiceDef),
      audit: c.use(auditLogDef),
      billing: c.use(billingServiceDef),
      funnel: c.use(funnelServiceDef),
    }),
);

export const passwordResetServiceDef = fn.singleton(
  (c) =>
    new PasswordResetService({
      db: c.use(systemKyselyDef),
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
export const importServiceDef = fn.scoped((c) => new ImportService(c.use(tenantDbDef)));
export const dashboardSummaryServiceDef = fn.scoped((c) => new DashboardService(c.use(tenantDbDef), c.use(clockDef)));
export const dashboardServiceDef = dashboardSummaryServiceDef;
export const connectorServiceDef = fn.scoped((c) => new ConnectorService(c.use(tenantDbDef)));
export const discrepancyServiceDef = fn.scoped((c) => new DiscrepancyService(c.use(tenantDbDef)));
export const salesQueryServiceDef = fn.scoped((c) => new SalesQueryService(c.use(tenantDbDef)));

// --- FÁBRICAS DE CONTENEDOR Y SCOPES ---

export type ContainerDependencies = {
  database?: Database | undefined;
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
    if (deps?.database !== undefined) {
      c.bindCascading(databaseDef).toValue(deps.database);
    }

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
