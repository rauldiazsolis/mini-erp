import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import type { BillingService } from '../billing/billing-service.ts';
import { DAY_PATTERN } from '../../shared/argentina-day.ts';
import type { BillingStatus, CreditsResponse } from '../../shared/credits-types.ts';

const day = z.string().regex(DAY_PATTERN, 'La fecha tiene que ser AAAA-MM-DD');
const chargesQuerySchema = z.object({
  from: day.optional(),
  to: day.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Créditos del comercio (#21): saldos, consumo, movimientos y regalados para owner y admin; el estado
 * de cobro (para la franja y la restricción) para los tres roles. Siguen abiertas con el comercio restringido.
 */
export function createCreditsRoutes(billing: BillingService): Router {
  const router = Router({ mergeParams: true });
  const view = requirePermission('credits.view');
  const tenantOf = (req: AuthenticatedAdminRequest): string => req.activeTenantId ?? '';

  router.get('/credits', view, (req: AuthenticatedAdminRequest, res: Response) => {
    const body: CreditsResponse = { ...billing.summary(tenantOf(req)), paymentInfo: billing.paymentInfo() };
    res.status(200).json(body);
  });

  router.get('/credits/charges', view, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = chargesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Consulta inválida' });
      return;
    }
    res.status(200).json(billing.listCharges(tenantOf(req), parsed.data));
  });

  router.get('/credits/movements', view, (req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(billing.listMovements(tenantOf(req)));
  });

  router.get('/credits/gifts', view, (req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(billing.listGifts(tenantOf(req)));
  });

  router.get('/billing-status', requirePermission('tenant.use'), (req: AuthenticatedAdminRequest, res: Response) => {
    const summary = billing.summary(tenantOf(req));
    const body: BillingStatus = { state: summary.state, debt: summary.debt, deadline: summary.deadline };
    res.status(200).json(body);
  });

  return router;
}
