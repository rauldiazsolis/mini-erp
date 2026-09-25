import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.ts';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { ApiKeyService } from '../tenant/api-key-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';

const createTenantSchema = z.object({
  id: z.string().min(3).regex(/^[a-z0-9-]+$/, 'El id debe contener solo minúsculas, números y guiones'),
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/, 'El slug debe contener solo minúsculas, números y guiones'),
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  seedDemoData: z.boolean().optional(),
});

const createApiKeySchema = z.object({
  name: z.string().min(2, 'Nombre de la terminal/caja requerido'),
  branch: z.string().min(1, 'Sucursal requerida'),
  pointOfSale: z.string().min(1, 'Punto de venta requerido'),
});

export function createTenantRoutes(
  authService: AuthService,
  tenantManager: TenantManager,
  apiKeyService: ApiKeyService,
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

  // Helper de permiso para acceder al tenant
  function checkTenantAccess(req: AuthenticatedAdminRequest, tenantId: string): boolean {
    if (req.user === undefined) return false;
    const list = authService.listUserTenants(req.user.id, req.user.globalRole);
    return list.some((t) => t.tenantId === tenantId);
  }

  // Listar API Keys de un tenant
  router.get('/:id/api-keys', (req: AuthenticatedAdminRequest, res: Response) => {
    const tenantId = req.params['id'];
    if (tenantId === undefined || !checkTenantAccess(req, tenantId)) {
      res.status(403).json({ error: 'No tienes acceso a este tenant' });
      return;
    }

    const keys = apiKeyService.listApiKeys(tenantId);
    res.status(200).json(keys);
  });

  // Crear API Key para una terminal de un tenant
  router.post('/:id/api-keys', (req: AuthenticatedAdminRequest, res: Response) => {
    const tenantId = req.params['id'];
    if (tenantId === undefined || !checkTenantAccess(req, tenantId)) {
      res.status(403).json({ error: 'No tienes acceso a este tenant' });
      return;
    }

    const parseResult = createApiKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    const key = apiKeyService.createApiKey({
      tenantId,
      name: parseResult.data.name,
      branch: parseResult.data.branch,
      pointOfSale: parseResult.data.pointOfSale,
    });

    res.status(201).json(key);
  });

  // Revocar API Key
  router.delete('/:id/api-keys/:keyId', (req: AuthenticatedAdminRequest, res: Response) => {
    const tenantId = req.params['id'];
    const keyId = req.params['keyId'];
    if (tenantId === undefined || keyId === undefined || !checkTenantAccess(req, tenantId)) {
      res.status(403).json({ error: 'No tienes acceso a este tenant' });
      return;
    }

    const success = apiKeyService.revokeApiKey(keyId, tenantId);
    if (!success) {
      res.status(404).json({ error: 'API key no encontrada' });
      return;
    }

    res.status(200).json({ success: true });
  });

  return router;
}
