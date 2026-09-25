import { Router, type Response } from 'express';
import { z } from 'zod';
import { BulkService } from '../bulk/bulk-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';

const bulkPriceSchema = z.object({
  action: z.enum(['percentage', 'fixed', 'items'], {
    errorMap: () => ({ message: "La acción debe ser 'percentage', 'fixed' o 'items'" }),
  }),
  value: z.number().optional(),
  category: z.string().optional(),
  rounding: z.enum(['none', '10', '50', '100']).optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1, 'ID de producto requerido'),
        price: z.number().nonnegative('El precio no puede ser negativo'),
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
  if (req.activeTenantDb === undefined) {
    throw new Error('Tenant DB no inicializada en la petición');
  }
  return new BulkService(req.activeTenantDb);
}

export function createBulkRoutes(): Router {
  const router = Router({ mergeParams: true });

  // POST /bulk/prices - Actualización masiva de precios
  router.post('/bulk/prices', (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = bulkPriceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const service = getBulkService(req);
      const result = service.previewOrApplyPrices(parseResult.data);
      res.status(200).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error en actualización masiva de precios';
      res.status(400).json({ error: msg });
    }
  });

  // POST /bulk/interests - Devengamiento masivo de intereses en cuentas corrientes
  router.post('/bulk/interests', (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = bulkInterestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const service = getBulkService(req);
      const result = service.previewOrApplyInterests(parseResult.data);
      res.status(200).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error en cálculo masivo de intereses';
      res.status(400).json({ error: msg });
    }
  });

  return router;
}
