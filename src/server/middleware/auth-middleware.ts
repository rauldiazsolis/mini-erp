import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { IContainer, Container } from 'hardwired';
import type { AuthService, Impersonator, UserSession } from '../auth/auth-service.ts';
import type { ApiKeyService, ValidatedPosKey } from '../tenant/api-key-service.ts';
import type { TenantManager } from '../db/tenant-manager.ts';
import { createTenantScope } from '../di/container.ts';
import type { TenantRole } from '../../shared/permissions.ts';

export interface AuthenticatedAdminRequest extends Request {
  user?: UserSession;
  /** Quién impersona (#23): está solo en una sesión de impersonación; `user` es el impersonado. */
  impersonator?: Impersonator;
  /** El token Bearer del pedido. */
  sessionToken?: string;
  activeTenantId?: string;
  activeTenantDb?: DatabaseSync;
  tenantScope?: IContainer;
  /** El rol con el que opera el comercio activo (#19); lo pone requireTenantContext. */
  tenantRole?: TenantRole;
}

export interface AuthenticatedPosRequest extends Request {
  posContext?: ValidatedPosKey & {
    tenantDb: DatabaseSync;
  };
  tenantScope?: IContainer;
}

/** El token Bearer del pedido, si hay uno. */
export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice(7).trim();
  return token === '' ? undefined : token;
}

export function createAdminAuthMiddleware(
  authService: AuthService,
  tenantManager: TenantManager,
) {
  return (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    const token = bearerToken(req);
    if (token === undefined) {
      res.status(401).json({ error: 'Falta cabecera Authorization: Bearer <token>' });
      return;
    }

    const session = authService.resolveSession(token);
    if (session === undefined) {
      res.status(401).json({ error: 'Sesión expirada o token inválido' });
      return;
    }

    const user = session.user;
    req.user = user;
    req.sessionToken = token;
    if (session.impersonator !== null) req.impersonator = session.impersonator;

    // Tenant opcional solicitado por el admin
    const tenantHeader = req.headers['x-tenant-id'];
    if (typeof tenantHeader === 'string' && tenantHeader.trim() !== '') {
      const requestedTenantId = tenantHeader.trim();
      const accessibleTenants = authService.listUserTenants(user.id);
      const isAllowed = accessibleTenants.some((t) => t.tenantId === requestedTenantId);

      if (!isAllowed) {
        res.status(403).json({ error: 'No tienes acceso a este tenant' });
        return;
      }

      req.activeTenantId = requestedTenantId;
      req.activeTenantDb = tenantManager.getTenantDb(requestedTenantId);
    }

    next();
  };
}

export function createPosAuthMiddleware(
  apiKeyService: ApiKeyService,
  tenantManager: TenantManager,
  rootContainer?: Container,
  /** Se llama con cada key válida: así una caja de demo en uso no se revoca (#24). */
  onAuthenticated?: (key: ValidatedPosKey) => void,
) {
  return (req: AuthenticatedPosRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Falta cabecera Authorization: Bearer <api_key>' });
      return;
    }

    const rawKey = authHeader.slice(7).trim();
    const validated = apiKeyService.validateApiKey(rawKey);
    if (validated === undefined) {
      res.status(401).json({ error: 'API key de terminal POS inválida o inactiva' });
      return;
    }

    onAuthenticated?.(validated);

    const tenantDb = tenantManager.getTenantDb(validated.tenantId);

    req.posContext = {
      ...validated,
      tenantDb,
    };

    if (rootContainer !== undefined) {
      req.tenantScope = createTenantScope(rootContainer, tenantDb);
    }

    next();
  };
}
