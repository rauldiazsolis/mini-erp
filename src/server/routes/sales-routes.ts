import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import { salesQueryServiceDef } from '../di/container.ts';
import type { SalesQueryService } from '../sales/sales-query-service.ts';
import { DomainError, sendError } from '../errors.ts';
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

export const paymentsQuerySchema = z.object({ ...base, ...paging, method: optionalText, customerId: optionalText, status });

export const movementsQuerySchema = z.object({
  ...base,
  ...paging,
  direction: z.enum(['in', 'out']).optional(),
  source: z.enum(['manual', 'count-adjustment']).optional(),
});

export const summaryQuerySchema = z.object(base);
export const dayQuerySchema = z.object({ day, branch: optionalText, pointOfSale: optionalText });

function getService(req: AuthenticatedAdminRequest): SalesQueryService {
  if (req.tenantScope === undefined) {
    throw new Error('Scope del comercio no inicializado en la petición');
  }
  return req.tenantScope.use(salesQueryServiceDef);
}

/** Con una caja real desde el POS (M10), la caja la pone el servidor: nunca la query. */
function scoped<T extends { branch?: string | undefined; pointOfSale?: string | undefined }>(req: AuthenticatedAdminRequest, query: T): T {
  const a = req.anonymous;
  return a?.kind === 'register' ? { ...query, branch: a.branch, pointOfSale: a.pointOfSale } : query;
}

/** Valida la query con `schema` y responde lo que devuelve `run`; un error de negocio va con su estado. */
function handle<T extends { branch?: string | undefined; pointOfSale?: string | undefined }>(schema: z.ZodType<T>, run: (service: SalesQueryService, query: T) => unknown) {
  return (req: AuthenticatedAdminRequest, res: Response): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Consulta inválida' });
      return;
    }
    try {
      res.status(200).json(run(getService(req), scoped(req, parsed.data)));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  };
}

/** Ventas & Caja (#20): consultas de solo lectura, para los tres roles. */
export function createSalesRoutes(): Router {
  const router = Router({ mergeParams: true });
  const view = requirePermission('sales.view');

  router.get('/registers', view, (req: AuthenticatedAdminRequest, res: Response) => {
    const a = req.anonymous;
    try {
      res.status(200).json(a?.kind === 'register' ? [{ branch: a.branch, pointOfSale: a.pointOfSale }] : getService(req).registers());
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });
  router.get('/sales', view, handle(salesQuerySchema, (service, q) => service.listSales(q, { page: q.page, pageSize: q.pageSize })));
  router.get('/sales/:saleId', view, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const sale = getService(req).getSale(req.params['saleId'] ?? '');
      // Una venta de otra caja se ve igual que una que no existe
      const a = req.anonymous;
      if (a?.kind === 'register' && (sale.branch !== a.branch || sale.pointOfSale !== a.pointOfSale)) throw new DomainError(404, 'Venta no encontrada');
      res.status(200).json(sale);
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });
  router.get(
    '/customer-payments',
    view,
    handle(paymentsQuerySchema, (service, q) => service.listCustomerPayments(q, { page: q.page, pageSize: q.pageSize })),
  );
  router.get(
    '/cash-movements',
    view,
    handle(movementsQuerySchema, (service, q) => service.listCashMovements(q, { page: q.page, pageSize: q.pageSize })),
  );
  router.get('/cash-summary', view, handle(summaryQuerySchema, (service, q) => service.cashSummary(q)));
  router.get('/cash-summary/day', view, handle(dayQuerySchema, (service, q) => service.daySummary(q)));

  return router;
}
