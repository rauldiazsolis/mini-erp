import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import { discrepancyServiceDef } from '../di/container.ts';
import type { DiscrepancyService } from '../discrepancy/discrepancy-service.ts';
import { sendError } from '../errors.ts';

const dismissSchema = z.object({
  note: z.string().trim().min(1, 'El motivo es obligatorio').max(500, 'El motivo puede tener hasta 500 caracteres'),
});

function getService(req: AuthenticatedAdminRequest): DiscrepancyService {
  if (req.tenantScope === undefined) {
    throw new Error('Scope del comercio no inicializado en la petición');
  }
  return req.tenantScope.use(discrepancyServiceDef);
}

/** Discrepancias del push (#2): las ve cualquiera del comercio; las descartan owner y admin. */
export function createDiscrepancyRoutes(): Router {
  const router = Router({ mergeParams: true });

  router.get('/discrepancies', requirePermission('tenant.use'), (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(200).json(getService(req).listOpen());
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post(
    '/discrepancies/:discrepancyId/dismiss',
    requirePermission('settings.manage'),
    (req: AuthenticatedAdminRequest, res: Response) => {
      const parsed = dismissSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Motivo inválido' });
        return;
      }
      const id = req.params['discrepancyId'];
      if (id === undefined || req.user === undefined) {
        res.status(400).json({ error: 'Pedido inválido' });
        return;
      }
      try {
        getService(req).dismiss(id, req.user.id, parsed.data.note);
        res.status(200).json({ ok: true });
      } catch (err: unknown) {
        sendError(res, err, 500);
      }
    },
  );

  return router;
}
