import { Router, type Response } from 'express';
import type { AuthService } from '../auth/auth-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';

export function createTenantRoutes(
  authService: AuthService,
  requireAdmin: (req: AuthenticatedAdminRequest, res: Response, next: () => void) => void,
): Router {
  const router = Router();

  // Listar tenants a los que el usuario tiene acceso. Solo esta ruta pide usuario: con `router.use`
  // cortaría también la cadena de /api/tenants/:tenantId, que acepta la sesión anónima de una demo (#24)
  router.get('/', requireAdmin, (req: AuthenticatedAdminRequest, res: Response) => {
    if (req.user === undefined) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }
    const tenants = authService.listUserTenants(req.user.id);
    res.status(200).json(tenants);
  });

  return router;
}
