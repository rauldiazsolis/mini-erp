import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import type { RegisterService } from '../registers/register-service.ts';
import type { AuditAction, AuditLog } from '../audit/audit-log.ts';
import { sendError } from '../errors.ts';
import { auditActor } from '../audit/audit-actor.ts';
import { routeParam } from '../http/route-param.ts';

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

  const record = async (req: AuthenticatedAdminRequest, action: AuditAction, registerId: string, extra?: Record<string, unknown>): Promise<void> => {
    await audit.record({ ...auditActor(req), tenantId: req.activeTenantId ?? null, action, details: { registerId, ...extra } });
  };

  /** Corre una acción sobre una caja: audita si sale bien y traduce los errores de negocio. */
  const act = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    action: AuditAction,
    run: (tenantId: string, registerId: string) => Promise<Record<string, unknown> | undefined>,
  ): Promise<void> => {
    try {
      const registerId = routeParam(req, 'registerId') ?? '';
      const result = await run(req.activeTenantId ?? '', registerId);
      await record(req, action, registerId);
      res.status(200).json(result ?? { success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  };

  router.get('/pos-registers', manage, async (req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(await registers.list(req.activeTenantId ?? ''));
  });

  router.post('/pos-registers', manage, async (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    const created = await registers.create({ tenantId: req.activeTenantId ?? '', ...parsed.data });
    await record(req, 'register.created', created.id, { name: parsed.data.name });
    res.status(201).json({ ...created, key: created.rawKey });
  });

  router.post('/pos-registers/:registerId/rotate-key', manage, async (req: AuthenticatedAdminRequest, res: Response) => {
    await act(req, res, 'register.key_rotated', async (tenantId, registerId) => {
      const key = await registers.rotateKey(tenantId, registerId);
      return { ...key, key: key.rawKey };
    });
  });

  router.post('/pos-registers/:registerId/transfer', manage, async (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    await act(req, res, 'register.transferred', async (tenantId, registerId) => {
      await registers.transferTo(tenantId, registerId, parsed.data.deviceId);
      return undefined;
    });
  });

  router.post('/pos-registers/:registerId/unbind', manage, async (req: AuthenticatedAdminRequest, res: Response) => {
    await act(req, res, 'register.unbound', async (tenantId, registerId) => {
      await registers.unbind(tenantId, registerId);
      return undefined;
    });
  });

  router.delete('/pos-registers/:registerId', manage, async (req: AuthenticatedAdminRequest, res: Response) => {
    await act(req, res, 'register.deactivated', async (tenantId, registerId) => {
      await registers.deactivate(tenantId, registerId);
      return undefined;
    });
  });

  return router;
}
