import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePlatformRole } from '../middleware/platform-role-middleware.ts';
import type { SuspensionService } from '../platform/suspension-service.ts';
import type { UserStatusService } from '../platform/user-status-service.ts';
import type { PasswordResetService } from '../users/password-reset-service.ts';
import type { StaffInvitationService } from '../platform/staff-invitation-service.ts';
import type { PlatformQueryService } from '../platform/platform-query-service.ts';
import { DomainError, sendError } from '../errors.ts';

const reasonSchema = z.object({ reason: z.string().trim().min(1, 'Falta el motivo').max(200) });
const staffInviteSchema = z.object({ email: z.string().trim().pipe(z.email('Email inválido')) });

export type PlatformAdminDeps = {
  suspensions: SuspensionService;
  userStatus: UserStatusService;
  resets: PasswordResetService;
  staffInvitations: StaffInvitationService;
  queries: PlatformQueryService;
};

/** Panel de plataforma (#23, M7a), para root y soporte. Lo de cobro sigue en platform-routes.ts. */
export function createPlatformAdminRoutes(deps: PlatformAdminDeps): Router {
  const router = Router();
  const staff = requirePlatformRole('root', 'support');
  const rootOnly = requirePlatformRole('root');
  const actorOf = (req: AuthenticatedAdminRequest): string => req.user?.id ?? '';

  router.post('/tenants/:tenantId/suspend', staff, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = reasonSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      deps.suspensions.suspend({ tenantId: req.params['tenantId'] ?? '', reason: parsed.data.reason, actorUserId: actorOf(req) });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/tenants/:tenantId/reactivate', staff, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      deps.suspensions.reactivate({ tenantId: req.params['tenantId'] ?? '', actorUserId: actorOf(req) });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  // Desactivar y reactivar cuentas: las reglas de quién a quién están en el servicio
  for (const [path, status] of [['disable', 'disabled'], ['enable', 'active']] as const) {
    router.post(`/users/:userId/${path}`, staff, (req: AuthenticatedAdminRequest, res: Response) => {
      try {
        if (req.user === undefined) throw new DomainError(401, 'No autorizado');
        deps.userStatus.setStatus({ actor: { id: req.user.id, globalRole: req.user.globalRole }, targetUserId: req.params['userId'] ?? '', status });
        res.status(200).json({ success: true });
      } catch (err: unknown) {
        sendError(res, err, 500);
      }
    });
  }

  router.post('/users/:userId/password-reset', staff, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(201).json(deps.resets.createFromPlatform({ actorUserId: actorOf(req), targetUserId: req.params['userId'] ?? '' }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  // El equipo de soporte (#23): solo root lo ve, lo invita y revoca invitaciones
  router.get('/staff', rootOnly, (_req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json({ members: deps.queries.listStaff(), invitations: deps.staffInvitations.listPending() });
  });

  router.post('/staff/invitations', rootOnly, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = staffInviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      res.status(201).json(deps.staffInvitations.create({ actorUserId: actorOf(req), email: parsed.data.email }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.delete('/staff/invitations/:invitationId', rootOnly, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      deps.staffInvitations.revoke({ actorUserId: actorOf(req), invitationId: req.params['invitationId'] ?? '' });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
