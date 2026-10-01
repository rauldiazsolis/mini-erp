import { Router, type Response } from 'express';
import { z } from 'zod';
import type { ApiKeyService } from '../tenant/api-key-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';

const createApiKeySchema = z.object({
  name: z.string().min(2, 'Nombre de la terminal/caja requerido'),
  branch: z.string().min(1, 'Sucursal requerida'),
  pointOfSale: z.string().min(1, 'Punto de venta requerido'),
});

/** Keys de las cajas del POS, en la cadena del comercio (#19): owner y admin. */
export function createApiKeyRoutes(apiKeyService: ApiKeyService): Router {
  const router = Router({ mergeParams: true });

  router.get('/api-keys', requirePermission('settings.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(apiKeyService.listApiKeys(req.activeTenantId ?? ''));
  });

  router.post('/api-keys', requirePermission('settings.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = createApiKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    const key = apiKeyService.createApiKey({
      tenantId: req.activeTenantId ?? '',
      name: parseResult.data.name,
      branch: parseResult.data.branch,
      pointOfSale: parseResult.data.pointOfSale,
    });

    res.status(201).json({
      ...key,
      key: key.rawKey,
    });
  });

  router.delete('/api-keys/:keyId', requirePermission('settings.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    const keyId = req.params['keyId'];
    if (keyId === undefined || !apiKeyService.revokeApiKey(keyId, req.activeTenantId ?? '')) {
      res.status(404).json({ error: 'API key no encontrada' });
      return;
    }
    res.status(200).json({ success: true });
  });

  return router;
}
