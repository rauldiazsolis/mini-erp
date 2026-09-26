import { Router, type Response } from 'express';
import { z } from 'zod';
import { StockService } from '../stock/stock-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { stockServiceDef } from '../di/container.ts';

const adjustStockSchema = z.object({
  productId: z.string().min(1, 'El ID de producto es requerido'),
  branchId: z.string().min(1, 'El ID de sucursal es requerido'),
  type: z.enum(['set', 'delta'], {
    errorMap: () => ({ message: "El tipo de ajuste debe ser 'set' o 'delta'" }),
  }),
  quantity: z.number({ invalid_type_error: 'La cantidad debe ser numérica' }),
  reason: z.string().min(1, 'El motivo del ajuste es requerido para auditoría'),
  notes: z.string().optional(),
});

function getStockService(req: AuthenticatedAdminRequest): StockService {
  if (req.tenantScope !== undefined) {
    return req.tenantScope.use(stockServiceDef);
  }
  if (req.activeTenantDb !== undefined) {
    return new StockService(req.activeTenantDb);
  }
  throw new Error('Tenant DB o Scope no inicializado en la petición');
}

export function createStockRoutes(): Router {
  const router = Router({ mergeParams: true });

  // GET /stock - Matriz de stock consolidada y por sucursal
  router.get('/stock', (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const service = getStockService(req);
      const search =
        typeof req.query['search'] === 'string'
          ? req.query['search']
          : typeof req.query['q'] === 'string'
            ? req.query['q']
            : undefined;
      const category = typeof req.query['category'] === 'string' ? req.query['category'] : undefined;
      const limit = typeof req.query['limit'] === 'string' ? parseInt(req.query['limit'], 10) : undefined;
      const offset = typeof req.query['offset'] === 'string' ? parseInt(req.query['offset'], 10) : undefined;

      const matrix = service.getStockMatrix({
        search,
        category,
        limit: Number.isNaN(limit) ? undefined : limit,
        offset: Number.isNaN(offset) ? undefined : offset,
      });

      res.status(200).json(matrix);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al obtener matriz de stock';
      res.status(500).json({ error: msg });
    }
  });

  // POST /stock/adjust - Ajuste manual auditado de stock (Kardex)
  router.post('/stock/adjust', (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = adjustStockSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos de ajuste inválidos' });
      return;
    }

    try {
      const service = getStockService(req);
      const result = service.adjustStock(parseResult.data);
      res.status(200).json(result);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? 400;
      const msg = err instanceof Error ? err.message : 'Error al ajustar stock';
      res.status(statusCode).json({ error: msg });
    }
  });

  // GET /stock/kardex - Historial de movimientos de stock con filtros
  router.get('/stock/kardex', (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const service = getStockService(req);
      const productId = typeof req.query['productId'] === 'string' ? req.query['productId'] : undefined;
      const branchId = typeof req.query['branchId'] === 'string' ? req.query['branchId'] : undefined;
      const reason = typeof req.query['reason'] === 'string' ? req.query['reason'] : undefined;
      const from = typeof req.query['from'] === 'string' ? req.query['from'] : undefined;
      const to = typeof req.query['to'] === 'string' ? req.query['to'] : undefined;
      const limit = typeof req.query['limit'] === 'string' ? parseInt(req.query['limit'], 10) : undefined;
      const offset = typeof req.query['offset'] === 'string' ? parseInt(req.query['offset'], 10) : undefined;

      const movements = service.getKardex({
        productId,
        branchId,
        reason,
        from,
        to,
        limit: Number.isNaN(limit) ? undefined : limit,
        offset: Number.isNaN(offset) ? undefined : offset,
      });

      res.status(200).json(movements);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al obtener historial Kardex';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
