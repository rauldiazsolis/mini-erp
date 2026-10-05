import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import { FUNNEL_DAILY_KINDS } from '../../shared/funnel-types.ts';
import { funnelContactSchema } from '../../shared/funnel-contact.ts';
import type { FunnelService } from '../funnel/funnel-service.ts';
import { sendError } from '../errors.ts';

const beaconSchema = z.object({ kind: z.enum(FUNNEL_DAILY_KINDS), demoSessionId: z.string().max(64).optional() });

/**
 * Lo público del embudo (#25), sin sesión: los beacons del landing y del alta (siempre 204: nunca
 * rompen la página) y el contacto. Sin IP guardada: los límites viven en memoria.
 */
export function createFunnelRoutes(funnel: FunnelService, limits: { beacon: RequestHandler; contact: RequestHandler }): Router {
  const router = Router();

  router.post('/beacon', limits.beacon, (req: Request, res: Response) => {
    const body: unknown = req.body;
    const parsed = beaconSchema.safeParse(body);
    if (parsed.success) {
      try {
        const { kind, demoSessionId } = parsed.data;
        if (kind === 'alta-open' && demoSessionId !== undefined && funnel.isDemoSession(demoSessionId)) {
          funnel.record('alta-opened', { demoSessionId });
        } else {
          funnel.bump(kind);
        }
      } catch (err: unknown) {
        console.error('[embudo] beacon:', err);
      }
    }
    res.status(204).end();
  });

  router.post('/contacts', limits.contact, (req: Request, res: Response) => {
    const body: unknown = req.body;
    const parsed = funnelContactSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      res.status(201).json(funnel.saveContact(parsed.data));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
