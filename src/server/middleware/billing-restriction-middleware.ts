import type { NextFunction, Response } from 'express';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';
import type { BillingService } from '../billing/billing-service.ts';
import { OPEN_WHEN_BLOCKED, tenantPath } from './tenant-path.ts';

/**
 * Pasada la gracia, el admin del comercio queda restringido (#21): `402 billing-restricted` en todo
 * menos lo abierto. Root y soporte (impersonando) no se restringen. El Connector API no pasa por acá:
 * el POS sigue vendiendo y sincronizando. Va después de `requireTenantContext`.
 */
export function createBillingRestriction(billing: BillingService) {
  return (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.globalRole;
    if (role === 'root' || role === 'support' || OPEN_WHEN_BLOCKED.test(tenantPath(req))) {
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
