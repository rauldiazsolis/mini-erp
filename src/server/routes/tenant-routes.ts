import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.ts';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';

const createTenantSchema = z.object({
  id: z.string().min(3).regex(/^[a-z0-9-]+$/, 'El id debe contener solo minúsculas, números y guiones'),
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/, 'El slug debe contener solo minúsculas, números y guiones'),
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  seedDemoData: z.boolean().optional(),
});


export function createTenantRoutes(
  authService: AuthService,
  tenantManager: TenantManager,
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

  // Crear nuevo tenant (Onboarding wizard)
  router.post('/', (req: AuthenticatedAdminRequest, res: Response) => {
    if (req.user === undefined) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    const parseResult = createTenantSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const tenant = tenantManager.createTenant({
        id: parseResult.data.id,
        slug: parseResult.data.slug,
        name: parseResult.data.name,
        ownerUserId: req.user.id,
        seedDemoData: parseResult.data.seedDemoData ?? true,
      });

      res.status(201).json(tenant);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear tenant';
      res.status(400).json({ error: msg });
    }
  });

  return router;
}
