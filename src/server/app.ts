import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from './db/system-db.ts';
import { TenantManager } from './db/tenant-manager.ts';
import { AuthService } from './auth/auth-service.ts';
import { ApiKeyService } from './tenant/api-key-service.ts';
import { createAdminAuthMiddleware, createPosAuthMiddleware } from './middleware/auth-middleware.ts';
import { createTenantContextMiddleware } from './middleware/tenant-context-middleware.ts';
import { createAuthRoutes } from './routes/auth-routes.ts';
import { createTenantRoutes } from './routes/tenant-routes.ts';
import { createConnectorRoutes } from './routes/connector-routes.ts';
import { createCatalogRoutes } from './routes/catalog-routes.ts';
import { createStockRoutes } from './routes/stock-routes.ts';
import { createCustomerRoutes } from './routes/customer-routes.ts';
import { createBulkRoutes } from './routes/bulk-routes.ts';
import { requestLogger } from './middleware/logger.ts';

export type AppDependencies = {
  systemDb?: DatabaseSync;
  tenantManager?: TenantManager;
};

export function createApp(deps?: AppDependencies): {
  app: Express;
  systemDb: DatabaseSync;
  tenantManager: TenantManager;
  authService: AuthService;
  apiKeyService: ApiKeyService;
} {
  const app = express();

  const systemDb = deps?.systemDb ?? openSystemDb(process.env['SYSTEM_DB_PATH'] ?? 'data/system.sqlite');
  const tenantManager = deps?.tenantManager ?? new TenantManager(systemDb);
  const authService = new AuthService(systemDb);
  const apiKeyService = new ApiKeyService(systemDb);

  const requireAdmin = createAdminAuthMiddleware(authService, tenantManager);
  const requirePos = createPosAuthMiddleware(apiKeyService, tenantManager);

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(requestLogger);

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'mini-erp' });
  });

  const requireTenantContext = createTenantContextMiddleware(authService, tenantManager);

  // Rutas del Admin
  app.use('/api/auth', createAuthRoutes(authService, requireAdmin));
  app.use('/api/tenants', createTenantRoutes(authService, tenantManager, apiKeyService, requireAdmin));
  app.use(
    '/api/tenants/:tenantId',
    requireAdmin,
    requireTenantContext,
    createCatalogRoutes(),
    createStockRoutes(),
    createCustomerRoutes(),
    createBulkRoutes(),
  );

  // Rutas para terminales POS (Connector API 4.0.0)
  app.use('/connector', createConnectorRoutes(requirePos));

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
  };
}
