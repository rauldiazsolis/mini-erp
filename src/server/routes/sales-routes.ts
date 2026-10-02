import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import { salesQueryServiceDef } from '../di/container.ts';
import type { SalesQueryService } from '../sales/sales-query-service.ts';
import { sendError } from '../errors.ts';
import { DAY_PATTERN } from '../../shared/argentina-day.ts';

const day = z.string().regex(DAY_PATTERN, 'La fecha tiene que ser AAAA-MM-DD');
const optionalText = z.string().optional();
const base = { from: day, to: day, branch: optionalText, pointOfSale: optionalText };
const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};
const status = z.enum(['all', 'valid', 'voided']).optional();

export const salesQuerySchema = z.object({
  ...base,
  ...paging,
  method: optionalText,
  customerId: optionalText,
  productId: optionalText,
  kind: z.enum(['sale', 'return', 'void']).optional(),
  status,
});

function getService(req: AuthenticatedAdminRequest): SalesQueryService {
  if (req.tenantScope === undefined) {
    throw new Error('Scope del comercio no inicializado en la petición');
  }
  return req.tenantScope.use(salesQueryServiceDef);
}

/** Valida la query con `schema` y responde lo que devuelve `run`; un error de negocio va con su estado. */
function handle<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, run: (service: SalesQueryService, query: T) => unknown) {
  return (req: AuthenticatedAdminRequest, res: Response): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Consulta inválida' });
      return;
    }
    try {
      res.status(200).json(run(getService(req), parsed.data));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  };
}

/** Ventas & Caja (#20): consultas de solo lectura, para los tres roles. */
export function createSalesRoutes(): Router {
  const router = Router({ mergeParams: true });
  const use = requirePermission('tenant.use');

  router.get('/registers', use, handle(z.object({}), (service) => service.registers()));
  router.get('/sales', use, handle(salesQuerySchema, (service, q) => service.listSales(q, { page: q.page, pageSize: q.pageSize })));
  router.get('/sales/:saleId', use, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(200).json(getService(req).getSale(req.params['saleId'] ?? ''));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
