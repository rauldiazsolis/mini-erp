import type { NextFunction, Response } from 'express';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';
import type { BillingService } from '../billing/billing-service.ts';

/** Lo que sigue abierto con el comercio restringido (#21): Créditos, el estado de cobro y exportar. */
const OPEN = /^\/(credits(\/.*)?|billing-status|export\/[^/]+)\/?$/;

/** El camino dentro del comercio: `/products` en `/api/tenants/kiosco/products`. */
function tenantPath(req: AuthenticatedAdminRequest): string {
  return req.originalUrl.split('?')[0]?.replace(/^\/api\/tenants\/[^/]+/, '') ?? '';
}

/**
 * Pasada la gracia, el admin del comercio queda restringido (#21): `402 billing-restricted` en todo
 * menos lo abierto. Root y soporte (impersonando) no se restringen. El Connector API no pasa por acá:
 * el POS sigue vendiendo y sincronizando. Va después de `requireTenantContext`.
 */
export function createBillingRestriction(billing: BillingService) {
  return (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.globalRole;
    if (role === 'root' || role === 'support' || OPEN.test(tenantPath(req))) {
      next();
      return;
    }
    const summary = billing.summary(req.activeTenantId ?? '');
    if (summary.state === 'restricted') {
      res.status(402).json({
        code: 'billing-restricted',
        error: 'mini contax está restringido por deuda',
        debt: summary.debt,
        deadline: summary.deadline,
      });
      return;
    }
    next();
  };
}
