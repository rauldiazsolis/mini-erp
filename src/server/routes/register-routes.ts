import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import type { RegisterService } from '../registers/register-service.ts';
import type { AuditAction, AuditLog } from '../audit/audit-log.ts';
import { sendError } from '../errors.ts';
import { auditActor } from '../audit/audit-actor.ts';

const createSchema = z.object({
  name: z.string().trim().min(2, 'Nombre de la caja requerido'),
  branch: z.string().trim().min(1, 'Sucursal requerida'),
  pointOfSale: z.string().trim().min(1, 'Punto de venta requerido'),
});
const transferSchema = z.object({ deviceId: z.string().min(1, 'Equipo requerido') });

/**
 * Cajas del POS (#21), en la cadena del comercio: owner y admin. `/registers` (sin `pos-`) es la
 * lista de cajas de Ventas & Caja (#20).
 */
export function createRegisterRoutes(registers: RegisterService, audit: AuditLog): Router {
  const router = Router({ mergeParams: true });
  const manage = requirePermission('settings.manage');

  const record = (req: AuthenticatedAdminRequest, action: AuditAction, registerId: string, extra?: Record<string, unknown>): void => {
    audit.record({ ...auditActor(req), tenantId: req.activeTenantId ?? null, action, details: { registerId, ...extra } });
  };

  /** Corre una acción sobre una caja: audita si sale bien y traduce los errores de negocio. */
  const act = (
    req: AuthenticatedAdminRequest,
    res: Response,
    action: AuditAction,
    run: (tenantId: string, registerId: string) => Record<string, unknown> | undefined,
  ): void => {
    try {
      const registerId = req.params['registerId'] ?? '';
      const result = run(req.activeTenantId ?? '', registerId);
      record(req, action, registerId);
      res.status(200).json(result ?? { success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  };

  router.get('/pos-registers', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(registers.list(req.activeTenantId ?? ''));
  });

  router.post('/pos-registers', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    const created = registers.create({ tenantId: req.activeTenantId ?? '', ...parsed.data });
    record(req, 'register.created', created.id, { name: parsed.data.name });
    res.status(201).json({ ...created, key: created.rawKey });
  });

  router.post('/pos-registers/:registerId/rotate-key', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    act(req, res, 'register.key_rotated', (tenantId, registerId) => {
      const key = registers.rotateKey(tenantId, registerId);
      return { ...key, key: key.rawKey };
    });
  });

  router.post('/pos-registers/:registerId/transfer', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    act(req, res, 'register.transferred', (tenantId, registerId) => {
      registers.transferTo(tenantId, registerId, parsed.data.deviceId);
      return undefined;
    });
  });

  router.post('/pos-registers/:registerId/unbind', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    act(req, res, 'register.unbound', (tenantId, registerId) => {
      registers.unbind(tenantId, registerId);
      return undefined;
    });
  });

  router.delete('/pos-registers/:registerId', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    act(req, res, 'register.deactivated', (tenantId, registerId) => {
      registers.deactivate(tenantId, registerId);
      return undefined;
    });
  });

  return router;
}
