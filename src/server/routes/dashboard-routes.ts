import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { DashboardService } from '../dashboard/dashboard-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import { dashboardSummaryServiceDef } from '../di/container.ts';

const summaryQuerySchema = z.object({
  period: z.enum(['today', 'week', 'month']).default('today'),
  /** Código de la sucursal (`CENTRAL`), no su id. */
  branchId: z.string().optional(),
});

function getDashboardService(req: AuthenticatedAdminRequest): DashboardService {
  if (req.tenantScope === undefined) {
    throw new Error('Scope del comercio no inicializado en la petición');
  }
  return req.tenantScope.use(dashboardSummaryServiceDef);
}

export function createDashboardRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/dashboard/summary', requirePermission('tenant.use'), async (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = summaryQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Parámetros inválidos' });
      return;
    }

    try {
      const service = getDashboardService(req);
      const summary = await service.getSummary({
        period: parseResult.data.period,
        branchId: parseResult.data.branchId,
      });

      res.status(200).json(summary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al obtener resumen del dashboard';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
