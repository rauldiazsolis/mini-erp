import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import { fitsMoneyColumn } from '../../shared/money.ts';
import type { BulkService } from '../bulk/bulk-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import { bulkServiceDef } from '../di/container.ts';
import { sendError } from '../errors.ts';

const bulkPriceSchema = z.object({
  action: z.enum(['percentage', 'fixed', 'items'], {
    error: "La acción debe ser 'percentage', 'fixed' o 'items'",
  }),
  value: z.number().optional(),
  category: z.string().optional(),
  rounding: z.enum(['none', '10', '50', '100']).optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1, 'ID de producto requerido'),
        price: z.number().nonnegative('El precio no puede ser negativo').refine(fitsMoneyColumn, 'Importe inválido'),
      }),
    )
    .optional(),
  dryRun: z.boolean().optional(),
});

const bulkInterestSchema = z.object({
  interestRatePercent: z.number().positive('El porcentaje de interés debe ser mayor a 0'),
  description: z.string().min(1, 'Descripción requerida para el asiento contable'),
  minimumBalance: z.number().nonnegative().optional(),
  customerIds: z.array(z.string()).optional(),
  dryRun: z.boolean().optional(),
});

function getBulkService(req: AuthenticatedAdminRequest): BulkService {
  if (req.tenantScope === undefined) {
    throw new Error('Scope del comercio no inicializado en la petición');
  }
  return req.tenantScope.use(bulkServiceDef);
}

export function createBulkRoutes(): Router {
  const router = Router({ mergeParams: true });

  // POST /bulk/prices - Actualización masiva de precios
  router.post('/bulk/prices', requirePermission('bulk'), async (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = bulkPriceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const service = getBulkService(req);
      const result = await service.previewOrApplyPrices(parseResult.data);
      res.status(200).json(result);
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  // POST /bulk/interests - Devengamiento masivo de intereses en cuentas corrientes
  router.post('/bulk/interests', requirePermission('bulk'), async (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = bulkInterestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const service = getBulkService(req);
      const result = await service.previewOrApplyInterests(parseResult.data);
      res.status(200).json(result);
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
