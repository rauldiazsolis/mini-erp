import { Router, type Response } from 'express';
import type { AuthService } from '../auth/auth-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';

export function createTenantRoutes(
  authService: AuthService,
  requireAdmin: (req: AuthenticatedAdminRequest, res: Response, next: () => void) => void,
): Router {
  const router = Router();

  router.use(requireAdmin);

  // Listar tenants a los que el usuario tiene acceso
  router.get('/', (req: AuthenticatedAdminRequest, res: Response) => {
    if (req.user === undefined) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }
    const tenants = authService.listUserTenants(req.user.id, req.user.globalRole);
    res.status(200).json(tenants);
  });

  return router;
}
