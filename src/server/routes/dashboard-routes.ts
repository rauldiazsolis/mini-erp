import { Router, type Response } from 'express';
import { z } from 'zod';
import { DashboardService } from '../dashboard/dashboard-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { dashboardSummaryServiceDef } from '../di/container.ts';

const summaryQuerySchema = z.object({
  period: z.enum(['today', 'week', 'month']).default('today'),
  branchId: z.string().optional(),
});

function getDashboardService(req: AuthenticatedAdminRequest): DashboardService {
  if (req.tenantScope !== undefined) {
    return req.tenantScope.use(dashboardSummaryServiceDef);
  }
  if (req.activeTenantDb !== undefined) {
    return new DashboardService(req.activeTenantDb);
  }
  throw new Error('Tenant DB o Scope no inicializado en la petición');
}

export function createDashboardRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/dashboard/summary', (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = summaryQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Parámetros inválidos' });
      return;
    }

    try {
      const service = getDashboardService(req);
      const summary = service.getSummary({
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
