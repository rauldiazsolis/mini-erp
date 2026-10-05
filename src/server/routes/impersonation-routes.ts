import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePlatformRole } from '../middleware/platform-role-middleware.ts';
import type { ImpersonationService } from '../impersonation/impersonation-service.ts';
import { DomainError, sendError } from '../errors.ts';

const startSchema = z.object({
  userId: z.string().trim().min(1, 'Falta el usuario'),
  tenantSlug: z.string().trim().min(1).optional(),
});

/** Impersonación de usuario (#23): empezar (root o soporte, con su sesión propia) y "Salir". */
export function createImpersonationRoutes(impersonations: ImpersonationService): Router {
  const router = Router();

  router.post('/', requirePlatformRole('root', 'support'), (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      if (req.user === undefined || req.sessionToken === undefined) throw new DomainError(401, 'No autorizado');
      res.status(201).json(impersonations.start({ staff: req.user, parentToken: req.sessionToken, ...parsed.data }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.delete('/current', (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      impersonations.end(req.sessionToken ?? '');
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
