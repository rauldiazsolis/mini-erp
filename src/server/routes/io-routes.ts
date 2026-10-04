import { Router, type Response } from 'express';
import { z } from 'zod';
import { ImportExportService } from '../io/import-export-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import { importExportServiceDef, importServiceDef } from '../di/container.ts';
import { DomainError, sendError } from '../errors.ts';
import { isImportFieldName, type ImportMapping } from '../../shared/import-fields.ts';

const importBodySchema = z.object({
  csv: z.string({ required_error: 'Falta el contenido del archivo' }),
  mapping: z.record(z.string().nullable()).optional(),
  dryRun: z.boolean({ required_error: 'Falta indicar si es una vista previa' }),
});

/** El mapeo que manda el cliente, con nombres de campo conocidos (el servicio valida el resto). */
function toMapping(raw: Record<string, string | null>): ImportMapping {
  const out: ImportMapping = {};
  for (const [column, field] of Object.entries(raw)) {
    if (field !== null && !isImportFieldName(field)) throw new DomainError(400, `Campo desconocido: ${field}`);
    out[column] = field;
  }
  return out;
}

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
  router.get('/export/:entity', requirePermission('bulk'), (req: AuthenticatedAdminRequest, res: Response) => {
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

  // POST /import/:entity - CSV con mapeo de columnas (#22): vista previa (dryRun) o confirmación
  router.post('/import/:entity', requirePermission('bulk'), (req: AuthenticatedAdminRequest, res: Response) => {
    const entity = req.params['entity'];
    if (entity !== 'customers' && entity !== 'products') {
      res.status(400).json({ error: "Entidad de importación inválida. Debe ser 'products' o 'customers'" });
      return;
    }
    const parsed = importBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos de importación inválidos' });
      return;
    }
    try {
      const service = req.tenantScope?.use(importServiceDef);
      if (service === undefined) throw new Error('Tenant Scope no inicializado en la petición');
      const { csv, mapping, dryRun } = parsed.data;
      res.status(200).json(service.run(entity, { csv, dryRun, mapping: mapping === undefined ? undefined : toMapping(mapping) }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
