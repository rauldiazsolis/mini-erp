import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import { sendError } from '../errors.ts';
import type { PortalService } from '../portal/portal-service.ts';

const redeemSchema = z.object({ token: z.string().min(1, 'Falta el link') });

/** Canje del link del portal (#24): sin sesión, con el límite de login. */
export function createPortalRoutes(portal: PortalService, limit: RequestHandler): Router {
  const router = Router();
  router.post('/redeem', limit, (req: Request, res: Response) => {
    const body: unknown = req.body;
    const parsed = redeemSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Payload inválido' });
      return;
    }
    try {
      res.status(200).json(portal.redeem(parsed.data.token));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });
  return router;
}
