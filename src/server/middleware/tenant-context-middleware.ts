import type { Response, NextFunction } from 'express';
import type { AuthService } from '../auth/auth-service.ts';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';

export function createTenantContextMiddleware(
  authService: AuthService,
  tenantManager: TenantManager,
) {
  return (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    if (req.user === undefined) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    const tenantId = req.params['tenantId'] ?? req.params['id'] ?? (typeof req.headers['x-tenant-id'] === 'string' ? req.headers['x-tenant-id'].trim() : undefined);

    if (tenantId === undefined || tenantId === '') {
      res.status(400).json({ error: 'Tenant ID requerido' });
      return;
    }

    const accessibleTenants = authService.listUserTenants(req.user.id, req.user.globalRole);
    const isAllowed = accessibleTenants.some((t) => t.tenantId === tenantId);

    if (!isAllowed) {
      res.status(403).json({ error: 'No tienes acceso a este tenant' });
      return;
    }

    req.activeTenantId = tenantId;
    req.activeTenantDb = tenantManager.getTenantDb(tenantId);
    next();
  };
}
