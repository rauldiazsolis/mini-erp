import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import { argentinaToday, DAY_PATTERN, shiftDay } from '../../shared/argentina-day.ts';
import { FUNNEL_RUBROS, FUNNEL_STAGES, FUNNEL_VISITOR_FILTERS, type FunnelVisitorList } from '../../shared/funnel-types.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePlatformRole } from '../middleware/platform-role-middleware.ts';
import type { FunnelService } from '../funnel/funnel-service.ts';
import type { FunnelQueryService } from '../funnel/funnel-query-service.ts';
import { auditActor } from '../audit/audit-actor.ts';
import { sendError } from '../errors.ts';
import { routeParam } from '../http/route-param.ts';

const day = z.string().regex(DAY_PATTERN, 'Fecha inválida');
const rangeSchema = z.object({
  desde: day.optional(),
  hasta: day.optional(),
  rubro: z.enum(FUNNEL_RUBROS, { error: 'Rubro desconocido' }).optional(),
});
const visitorsSchema = rangeSchema.extend({
  etapa: z.enum(FUNNEL_STAGES, { error: 'Etapa desconocida' }).optional(),
  filtro: z.enum(FUNNEL_VISITOR_FILTERS, { error: 'Filtro desconocido' }).optional(),
  q: z.string().max(80).optional(),
});

/** El embudo de la plataforma (#25), para root y soporte: el reporte, los visitantes y sus contactos. */
export function createPlatformFunnelRoutes(deps: { funnel: FunnelService; queries: FunnelQueryService; now: () => Date }): Router {
  const router = Router();
  const staff = requirePlatformRole('root', 'support');
  /** Por omisión, los últimos 30 días argentinos. */
  const range = (desde: string | undefined, hasta: string | undefined): { from: string; to: string } => {
    const to = hasta ?? argentinaToday(deps.now());
    return { from: desde ?? shiftDay(to, -29), to };
  };

  router.get('/funnel', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    const query: unknown = req.query;
    const parsed = rangeSchema.safeParse(query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Filtros inválidos' });
      return;
    }
    res.status(200).json(await deps.queries.report({ ...range(parsed.data.desde, parsed.data.hasta), rubro: parsed.data.rubro }));
  });

  router.get('/visitors', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    const query: unknown = req.query;
    const parsed = visitorsSchema.safeParse(query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Filtros inválidos' });
      return;
    }
    const { desde, hasta, rubro, etapa, filtro, q } = parsed.data;
    const pending = filtro === 'pending';
    const { from, to } = range(desde, hasta);
    const body: FunnelVisitorList = {
      from: pending ? null : from,
      to: pending ? null : to,
      items: await deps.queries.visitors({ from, to, rubro, stage: etapa, filter: filtro, q }),
    };
    res.status(200).json(body);
  });

  router.get('/visitors/:visitorId', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    const detail = await deps.queries.visitor(routeParam(req, 'visitorId') ?? '');
    if (detail === undefined) {
      res.status(404).json({ error: 'No existe ese visitante' });
      return;
    }
    res.status(200).json(detail);
  });

  router.get('/contacts/pending-count', staff, async (_req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json({ count: await deps.funnel.pendingCount() });
  });

  router.post('/contacts/:contactId/handled', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    const contactId = routeParam(req, 'contactId') ?? '';
    try {
      // Marca y audita en una transacción
      await deps.funnel.markHandled(contactId, auditActor(req));
      res.status(200).json({ ok: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
