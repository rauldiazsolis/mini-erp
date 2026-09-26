import { Router, type Response } from 'express';
import { z } from 'zod';
import { ImportExportService } from '../io/import-export-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { importExportServiceDef } from '../di/container.ts';

const importBodySchema = z.object({
  items: z.array(z.record(z.unknown())).optional(),
  csv: z.string().optional(),
  updateExisting: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

const seedPresetSchema = z.object({
  preset: z.enum(['kiosco', 'ferreteria', 'almacen'], {
    errorMap: () => ({ message: "El preset debe ser 'kiosco', 'ferreteria' o 'almacen'" }),
  }),
});

function getImportExportService(req: AuthenticatedAdminRequest): ImportExportService {
  if (req.tenantScope !== undefined) {
    return req.tenantScope.use(importExportServiceDef);
  }
  if (req.activeTenantDb !== undefined) {
    return new ImportExportService(req.activeTenantDb);
  }
  throw new Error('Tenant DB o Scope no inicializado en la petición');
}

export function createIoRoutes(): Router {
  const router = Router({ mergeParams: true });

  // GET /export/:entity - Exportar datos en CSV o JSON
  router.get('/export/:entity', (req: AuthenticatedAdminRequest, res: Response) => {
    const entity = req.params['entity'];
    const format = req.query['format'] === 'csv' ? 'csv' : 'json';
    const tenantId = req.activeTenantId ?? 'tenant';

    try {
      const service = getImportExportService(req);
      let result: { content: string | unknown[]; isCsv: boolean };

      switch (entity) {
        case 'products':
          result = service.exportProducts(format);
          break;
        case 'customers':
          result = service.exportCustomers(format);
          break;
        case 'stock':
          result = service.exportStock(format);
          break;
        default:
          res.status(400).json({ error: "Entidad inválida. Debe ser 'products', 'customers' o 'stock'" });
          return;
      }

      if (result.isCsv) {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${entity}-${tenantId}.csv"`);
        res.status(200).send(result.content);
      } else {
        res.status(200).json(result.content);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al exportar datos';
      res.status(500).json({ error: msg });
    }
  });

  // POST /import/:entity - Importar datos en lote con preview (dryRun)
  router.post('/import/:entity', (req: AuthenticatedAdminRequest, res: Response) => {
    const entity = req.params['entity'];

    const parseResult = importBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos de importación inválidos' });
      return;
    }

    try {
      const service = getImportExportService(req);

      if (entity === 'products') {
        const result = service.importProducts(parseResult.data);
        res.status(200).json(result);
        return;
      }

      if (entity === 'customers') {
        const result = service.importCustomers(parseResult.data);
        res.status(200).json(result);
        return;
      }

      res.status(400).json({ error: "Entidad de importación inválida. Debe ser 'products' o 'customers'" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al importar datos';
      res.status(400).json({ error: msg });
    }
  });

  // POST /seed-preset - Poblar datos iniciales según rubro comercial
  router.post('/seed-preset', (req: AuthenticatedAdminRequest, res: Response) => {
    const parseResult = seedPresetSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Preset inválido' });
      return;
    }

    try {
      const service = getImportExportService(req);
      const result = service.applyBusinessPreset(parseResult.data.preset);
      res.status(200).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al aplicar preset de negocio';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
