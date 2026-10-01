import type { Response, NextFunction } from 'express';
import type { Container } from 'hardwired';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { MembershipService } from '../users/membership-service.ts';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';
import { createTenantScope } from '../di/container.ts';

/**
 * Resuelve el comercio del pedido y el rol con el que se opera (#19): la membresía activa, u owner
 * para root y support hasta M7. Sin rol, 403. Cada ruta exige después su capacidad.
 */
export function createTenantContextMiddleware(
  membershipService: MembershipService,
  tenantManager: TenantManager,
  rootContainer?: Container,
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

    const role = membershipService.resolveRole(req.user, tenantId);
    if (role === undefined) {
      res.status(403).json({ error: 'No tienes acceso a este tenant' });
      return;
    }

    const tenantDb = tenantManager.getTenantDb(tenantId);
    req.activeTenantId = tenantId;
    req.activeTenantDb = tenantDb;
    req.tenantRole = role;

    if (rootContainer !== undefined) {
      req.tenantScope = createTenantScope(rootContainer, tenantDb);
    }

    next();
  };
}
