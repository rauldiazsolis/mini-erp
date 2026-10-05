import type { Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { Container } from 'hardwired';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { MembershipService } from '../users/membership-service.ts';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';
import { createTenantScope } from '../di/container.ts';
import { isSuspended } from '../platform/suspensions.ts';
import { OPEN_WHEN_BLOCKED, tenantPath } from './tenant-path.ts';

/**
 * Resuelve el comercio del pedido y el rol con el que se opera (#19): la membresía activa, u owner
 * para root y support hasta M7. Sin rol, 403. Cada ruta exige después su capacidad. Un comercio
 * suspendido (#23) solo deja a sus usuarios lo abierto (Uso y pagos, estado de cobro y exportar).
 */
export function createTenantContextMiddleware(
  systemDb: DatabaseSync,
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

    if (req.user.globalRole === 'user' && isSuspended(systemDb, tenantId) && !OPEN_WHEN_BLOCKED.test(tenantPath(req))) {
      res.status(403).json({ code: 'tenant-suspended', error: 'Este comercio está suspendido: escribile a soporte' });
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
