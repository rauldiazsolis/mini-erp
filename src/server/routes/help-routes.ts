import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import { requireOwnSession } from '../middleware/own-session-middleware.ts';
import type { HelpRequestService } from '../help/help-request-service.ts';
import { HELP_MESSAGE_MAX, type HelpRequestCreated } from '../../shared/help-types.ts';
import { sendError } from '../errors.ts';

const askSchema = z.object({
  path: z.string().trim().min(1, 'Falta la pantalla').max(300),
  message: z.string().trim().max(HELP_MESSAGE_MAX, `El mensaje puede tener hasta ${String(HELP_MESSAGE_MAX)} caracteres`).optional(),
});

/** "Pedir ayuda" (#23), en la cadena del comercio: cualquier rol, con su sesión propia. */
export function createHelpRoutes(help: HelpRequestService): Router {
  const router = Router({ mergeParams: true });

  router.post('/help-requests', requirePermission('tenant.use'), requireOwnSession, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = askSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      const created = help.create({
        tenantId: req.activeTenantId ?? '',
        userId: req.user?.id ?? '',
        path: parsed.data.path,
        message: parsed.data.message ?? '',
      });
      const body: HelpRequestCreated = { ...created, url: `${req.protocol}://${req.get('host') ?? ''}/ayuda/${created.id}` };
      res.status(201).json(body);
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
