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
import { createApiKeyRoutes } from './routes/api-key-routes.ts';
import { createAltaRoutes } from './routes/alta-routes.ts';
import { createUserRoutes } from './routes/user-routes.ts';
import { createInvitationLinkRoutes, createPasswordResetLinkRoutes } from './routes/link-routes.ts';
import { createConnectorRoutes } from './routes/connector-routes.ts';
import { createCatalogRoutes } from './routes/catalog-routes.ts';
import { createStockRoutes } from './routes/stock-routes.ts';
import { createCustomerRoutes } from './routes/customer-routes.ts';
import { createBulkRoutes } from './routes/bulk-routes.ts';
import { createIoRoutes } from './routes/io-routes.ts';
import { createDashboardRoutes } from './routes/dashboard-routes.ts';
import { createSalesRoutes } from './routes/sales-routes.ts';
import { createDiscrepancyRoutes } from './routes/discrepancy-routes.ts';
import { requestLogger } from './middleware/logger.ts';
import { allowPrivateNetwork } from './middleware/private-network.ts';
import { createRateLimit, readRateLimitConfig, type RateLimitConfig } from './middleware/rate-limit.ts';

import type { Container } from 'hardwired';
import {
  createRootContainer,
  systemDbDef,
  tenantManagerDef,
  authServiceDef,
  apiKeyServiceDef,
  demoSessionServiceDef,
  clockDef,
  membershipServiceDef,
  altaServiceDef,
  auditLogDef,
  invitationServiceDef,
  passwordResetServiceDef,
} from './di/container.ts';
import type { DemoConfig } from './demo/demo-config.ts';
import type { DemoSessionService } from './demo/demo-session-service.ts';
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
  const membershipService = rootContainer.use(membershipServiceDef);
  const invitationService = rootContainer.use(invitationServiceDef);
  const auditLog = rootContainer.use(auditLogDef);
  const passwordResetService = rootContainer.use(passwordResetServiceDef);

  // Límite de pedidos por IP (#3): demos, y login y registro con un contador compartido
  const now = rootContainer.use(clockDef);
  const limits = deps?.rateLimits ?? readRateLimitConfig(process.env);
  const demoLimit = createRateLimit({ limit: limits.demoPerHour, windowMs: 60 * 60 * 1000, now });
  const authLimit = createRateLimit({ limit: limits.authPer15Min, windowMs: 15 * 60 * 1000, now });

  const requireAdmin = createAdminAuthMiddleware(authService, tenantManager);
  const requirePos = createPosAuthMiddleware(apiKeyService, tenantManager, rootContainer, (tenantId) => {
    demoSessions.touch(tenantId);
  });

  app.use(allowPrivateNetwork);
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(requestLogger);

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'mini-erp', version: APP_VERSION });
  });

  const requireTenantContext = createTenantContextMiddleware(membershipService, tenantManager, rootContainer);

  // Rutas del Admin
  app.use('/api/auth', createAuthRoutes(authService, requireAdmin, authLimit, auditLog));
  // Sin registro suelto (#19): una cuenta nace en el alta o aceptando una invitación
  app.use('/api/alta', createAltaRoutes(authService, rootContainer.use(altaServiceDef), authLimit));
  app.use('/api/invitations', createInvitationLinkRoutes(invitationService, authLimit));
  app.use('/api/password-resets', createPasswordResetLinkRoutes(passwordResetService, authLimit));
  app.use('/api/tenants', createTenantRoutes(authService, requireAdmin));
  app.use(
    '/api/tenants/:tenantId',
    requireAdmin,
    requireTenantContext,
    createCatalogRoutes(),
    createStockRoutes(),
    createCustomerRoutes(),
    createDiscrepancyRoutes(),
    createBulkRoutes(),
    createIoRoutes(),
    createDashboardRoutes(),
    createSalesRoutes(),
    createApiKeyRoutes(apiKeyService),
    createUserRoutes({ members: membershipService, invitations: invitationService, resets: passwordResetService, audit: auditLog }),
  );

  // Rutas para terminales POS (Connector API 4.4.0, #2)
  app.use('/connector', createConnectorRoutes(requirePos, demoSessions, demoLimit));

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
    rootContainer,
  };
}
