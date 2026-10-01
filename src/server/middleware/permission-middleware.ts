import type { NextFunction, RequestHandler, Response } from 'express';
import { can, type Capability } from '../../shared/permissions.ts';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';

/**
 * Exige una capacidad del comercio (#19). Va en cada ruta de /api/tenants/:tenantId; lleva la
 * capacidad a la vista para que el test de la matriz la compare con su tabla.
 */
export function requirePermission(capability: Capability): RequestHandler & { capability: Capability } {
  const handler = (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    if (req.tenantRole === undefined || !can(req.tenantRole, capability)) {
      res.status(403).json({ error: 'No tenés permiso para esto' });
      return;
    }
    next();
  };
  return Object.assign(handler, { capability });
}
