import { Router, type Response } from 'express';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import type { HelpRequestService } from '../help/help-request-service.ts';

/** Lo del usuario de la sesión (#23): su pedido de ayuda y los accesos de soporte a su cuenta. */
export function createMeRoutes(help: HelpRequestService): Router {
  const router = Router();

  router.get('/support-access', (req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(help.supportAccess(req.user?.id ?? ''));
  });

  return router;
}
