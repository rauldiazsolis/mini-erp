import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { DatabaseSync } from 'node:sqlite';
import { TenantManager } from './db/tenant-manager.ts';
import { AuthService } from './auth/auth-service.ts';
import { ApiKeyService } from './tenant/api-key-service.ts';
import { createAdminAuthMiddleware, createPosAuthMiddleware } from './middleware/auth-middleware.ts';
import { createTenantContextMiddleware } from './middleware/tenant-context-middleware.ts';
import { createAuthRoutes } from './routes/auth-routes.ts';
import { createTenantRoutes } from './routes/tenant-routes.ts';
import { createAltaRoutes } from './routes/alta-routes.ts';
import { createUserRoutes } from './routes/user-routes.ts';
import { createInvitationLinkRoutes, createPasswordResetLinkRoutes, createStaffInvitationLinkRoutes } from './routes/link-routes.ts';
import { createConnectorRoutes } from './routes/connector-routes.ts';
import { createCatalogRoutes } from './routes/catalog-routes.ts';
import { createStockRoutes } from './routes/stock-routes.ts';
import { createCustomerRoutes } from './routes/customer-routes.ts';
import { createBulkRoutes } from './routes/bulk-routes.ts';
import { createIoRoutes } from './routes/io-routes.ts';
import { createDashboardRoutes } from './routes/dashboard-routes.ts';
import { createSalesRoutes } from './routes/sales-routes.ts';
import { createDiscrepancyRoutes } from './routes/discrepancy-routes.ts';
import { createRegisterRoutes } from './routes/register-routes.ts';
import { createPlatformRoutes } from './routes/platform-routes.ts';
import { createPlatformAdminRoutes } from './routes/platform-admin-routes.ts';
import { createImpersonationRoutes } from './routes/impersonation-routes.ts';
import { createHelpRoutes } from './routes/help-routes.ts';
import { createMeRoutes } from './routes/me-routes.ts';
import { createCreditsRoutes } from './routes/credits-routes.ts';
import { createPortalRoutes } from './routes/portal-routes.ts';
import { createBillingRestriction } from './middleware/billing-restriction-middleware.ts';
import { requestLogger } from './middleware/logger.ts';
import { allowPrivateNetwork, CORS_OPTIONS } from './middleware/private-network.ts';
import { createRateLimit, readRateLimitConfig, type RateLimitConfig } from './middleware/rate-limit.ts';

import type { Container } from 'hardwired';
import {
  createRootContainer,
  systemDbDef,
  tenantManagerDef,
  authServiceDef,
  apiKeyServiceDef,
  demoSessionServiceDef,
  demoResetServiceDef,
  portalServiceDef,
  clockDef,
  membershipServiceDef,
  altaServiceDef,
  auditLogDef,
  invitationServiceDef,
  passwordResetServiceDef,
  registerServiceDef,
  billingServiceDef,
  suspensionServiceDef,
  userStatusServiceDef,
  staffInvitationServiceDef,
  platformQueryServiceDef,
  impersonationServiceDef,
  helpRequestServiceDef,
} from './di/container.ts';
import type { BillingService } from './billing/billing-service.ts';
import type { DemoConfig } from './demo/demo-config.ts';
import type { DemoSessionService } from './demo/demo-session-service.ts';
import type { DemoResetService } from './demo/demo-reset-service.ts';
import { APP_VERSION } from './app-version.ts';

export type AppDependencies = {
  systemDb?: DatabaseSync;
  tenantManager?: TenantManager;
  rootContainer?: Container;
  demoConfig?: DemoConfig | undefined;
  now?: (() => Date) | undefined;
  rateLimits?: RateLimitConfig | undefined;
};

export function createApp(deps?: AppDependencies): {
  app: Express;
  systemDb: DatabaseSync;
  tenantManager: TenantManager;
  authService: AuthService;
  apiKeyService: ApiKeyService;
  demoSessions: DemoSessionService;
  demoResets: DemoResetService;
  billing: BillingService;
  rootContainer: Container;
} {
  const app = express();
  // Detrás de Caddy en la misma máquina (#3): req.ip es la del cliente y req.protocol, https
  app.set('trust proxy', 'loopback');

  const rootContainer = deps?.rootContainer ?? createRootContainer({
    systemDb: deps?.systemDb,
    tenantManager: deps?.tenantManager,
    demoConfig: deps?.demoConfig,
    now: deps?.now,
  });

  const systemDb = rootContainer.use(systemDbDef);
  const tenantManager = rootContainer.use(tenantManagerDef);
  const authService = rootContainer.use(authServiceDef);
  const apiKeyService = rootContainer.use(apiKeyServiceDef);
  const demoSessions = rootContainer.use(demoSessionServiceDef);
  const demoResets = rootContainer.use(demoResetServiceDef);
  const membershipService = rootContainer.use(membershipServiceDef);
  const invitationService = rootContainer.use(invitationServiceDef);
  const auditLog = rootContainer.use(auditLogDef);
  const passwordResetService = rootContainer.use(passwordResetServiceDef);
  const registers = rootContainer.use(registerServiceDef);
  const billing = rootContainer.use(billingServiceDef);
  const staffInvitations = rootContainer.use(staffInvitationServiceDef);
  const helpRequests = rootContainer.use(helpRequestServiceDef);

  // Límite de pedidos por IP (#3): demos, y login y registro con un contador compartido
  const now = rootContainer.use(clockDef);
  const limits = deps?.rateLimits ?? readRateLimitConfig(process.env);
  const demoLimit = createRateLimit({ limit: limits.demoPerHour, windowMs: 60 * 60 * 1000, now, body: 'connector' });
  const authLimit = createRateLimit({ limit: limits.authPer15Min, windowMs: 15 * 60 * 1000, now, body: 'api' });

  const requireAdmin = createAdminAuthMiddleware(authService, tenantManager);
  // La cadena del comercio acepta también la sesión anónima de una demo (#24); el resto, solo usuarios
  const portal = rootContainer.use(portalServiceDef);
  const requireTenantSession = createAdminAuthMiddleware(authService, tenantManager, portal);
  const requirePos = createPosAuthMiddleware(apiKeyService, tenantManager, rootContainer, (key) => {
    demoSessions.touchRegister(key.registerId);
  });

  app.use(allowPrivateNetwork);
  app.use(cors(CORS_OPTIONS));
  app.use(express.json({ limit: '10mb' }));
  app.use(requestLogger);

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'mini-erp', version: APP_VERSION });
  });

  const requireTenantContext = createTenantContextMiddleware(systemDb, membershipService, tenantManager, rootContainer);

  // Rutas del Admin
  app.use('/api/auth', createAuthRoutes(authService, requireAdmin, authLimit, auditLog));
  // Impersonación de usuario (#23): una sesión aparte, por pestaña
  app.use('/api/impersonations', requireAdmin, createImpersonationRoutes(rootContainer.use(impersonationServiceDef)));
  // Lo del usuario de la sesión (#23): su pedido de ayuda y los accesos de soporte
  app.use('/api/me', requireAdmin, createMeRoutes(helpRequests));
  // Sin registro suelto (#19): una cuenta nace en el alta o aceptando una invitación
  app.use('/api/alta', createAltaRoutes(authService, rootContainer.use(altaServiceDef), authLimit));
  app.use('/api/invitations', createInvitationLinkRoutes(invitationService, authLimit, authService));
  // El portal (#24): canje del link del POS por la sesión anónima de la demo
  app.use('/api/portal', createPortalRoutes(portal, authLimit));
  app.use('/api/password-resets', createPasswordResetLinkRoutes(passwordResetService, authLimit));
  app.use('/api/staff-invitations', createStaffInvitationLinkRoutes(staffInvitations, authLimit, authService));
  app.use('/api/tenants', createTenantRoutes(authService, requireAdmin));
  app.use(
    '/api/tenants/:tenantId',
    requireTenantSession,
    requireTenantContext,
    createBillingRestriction(billing),
    createCatalogRoutes(),
    createStockRoutes(),
    createCustomerRoutes(),
    createDiscrepancyRoutes(),
    createBulkRoutes(),
    createIoRoutes(tenantManager),
    createDashboardRoutes(),
    createSalesRoutes(),
    createRegisterRoutes(registers, auditLog),
    createCreditsRoutes(billing),
    createUserRoutes({ members: membershipService, invitations: invitationService, resets: passwordResetService, audit: auditLog }),
    createHelpRoutes(helpRequests),
  );

  // Plataforma de cobro (#21): root y soporte
  app.use('/api/platform', requireAdmin, createPlatformRoutes({ billing, audit: auditLog }));
  // Panel de plataforma (#23): comercios, usuarios, soporte y registro
  app.use(
    '/api/platform',
    requireAdmin,
    createPlatformAdminRoutes({
      suspensions: rootContainer.use(suspensionServiceDef),
      userStatus: rootContainer.use(userStatusServiceDef),
      resets: passwordResetService,
      staffInvitations,
      queries: rootContainer.use(platformQueryServiceDef),
      audit: auditLog,
      help: helpRequests,
    }),
  );

  // Rutas para terminales POS (Connector API 4.5.0, #2, #58)
  app.use('/connector', createConnectorRoutes(requirePos, demoSessions, demoLimit, { registers, billing, tenants: tenantManager, portal }));

  // Manejador centralizado de errores
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Error interno desconocido';
    console.error('[mini-erp error]:', err);
    res.status(500).json({ error: message });
  });

  return {
    app,
    systemDb,
    tenantManager,
    authService,
    apiKeyService,
    demoSessions,
    demoResets,
    billing,
    rootContainer,
  };
}
