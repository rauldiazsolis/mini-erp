import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthService, UserSession } from '../auth/auth-service.ts';
import type { ApiKeyService, ValidatedPosKey } from '../tenant/api-key-service.ts';
import type { TenantManager } from '../db/tenant-manager.ts';

export interface AuthenticatedAdminRequest extends Request {
  user?: UserSession;
  activeTenantId?: string;
  activeTenantDb?: DatabaseSync;
}

export interface AuthenticatedPosRequest extends Request {
  posContext?: ValidatedPosKey & {
    tenantDb: DatabaseSync;
  };
}

export function createAdminAuthMiddleware(
  authService: AuthService,
  tenantManager: TenantManager,
) {
  return (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Falta cabecera Authorization: Bearer <token>' });
      return;
    }

    const token = authHeader.slice(7).trim();
    const user = authService.validateSession(token);
    if (user === undefined) {
      res.status(401).json({ error: 'Sesión expirada o token inválido' });
      return;
    }

    req.user = user;

    // Tenant opcional solicitado por el admin
    const tenantHeader = req.headers['x-tenant-id'];
    if (typeof tenantHeader === 'string' && tenantHeader.trim() !== '') {
      const requestedTenantId = tenantHeader.trim();
      const accessibleTenants = authService.listUserTenants(user.id, user.globalRole);
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

    const tenantDb = tenantManager.getTenantDb(validated.tenantId);

    req.posContext = {
      ...validated,
      tenantDb,
    };

    next();
  };
}
