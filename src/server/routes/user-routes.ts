import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import type { MembershipService } from '../users/membership-service.ts';
import type { InvitationService } from '../users/invitation-service.ts';
import type { PasswordResetService } from '../users/password-reset-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { TENANT_ROLES, type TenantRole } from '../../shared/permissions.ts';
import { DomainError, sendError } from '../errors.ts';
import { requireOwnSession, sendImpersonating } from '../middleware/own-session-middleware.ts';

const inviteSchema = z.object({
  email: z.string().trim().pipe(z.email('Email inválido')),
  role: z.enum(TENANT_ROLES),
});

const patchSchema = z.object({
  role: z.enum(TENANT_ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

function actorOf(req: AuthenticatedAdminRequest): {
  tenantId: string;
  actor: { userId: string; role: TenantRole; impersonatorUserId?: string | undefined };
} {
  if (req.user === undefined || req.tenantRole === undefined || req.activeTenantId === undefined) {
    throw new DomainError(401, 'No autorizado');
  }
  const actor = { userId: req.user.id, role: req.tenantRole };
  return {
    tenantId: req.activeTenantId,
    // Impersonando (#23), la auditoría guarda también a quien impersona
    actor: req.impersonator === undefined ? actor : { ...actor, impersonatorUserId: req.impersonator.id },
  };
}

/** Usuarios del comercio, invitaciones y auditoría (#19), en la cadena de /api/tenants/:tenantId. */
export function createUserRoutes(deps: {
  members: MembershipService;
  invitations: InvitationService;
  resets: PasswordResetService;
  audit: AuditLog;
}): Router {
  const router = Router({ mergeParams: true });

  router.get('/users', requirePermission('users.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { tenantId, actor } = actorOf(req);
      const members = deps.members.listMembers(tenantId).map((m) => ({
        ...m,
        canReset: actor.role === 'owner' && m.userId !== actor.userId && deps.members.isFullyOwnedBy(m.userId, actor.userId),
      }));
      res.status(200).json({ members, invitations: deps.invitations.listPending(tenantId) });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/invitations', requirePermission('users.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    // Quien impersona no nombra owners (#23)
    if (req.impersonator !== undefined && parsed.data.role === 'owner') {
      sendImpersonating(res);
      return;
    }
    try {
      res.status(201).json(deps.invitations.create({ ...actorOf(req), ...parsed.data }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.delete('/invitations/:invitationId', requirePermission('users.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      deps.invitations.revoke({ ...actorOf(req), invitationId: req.params['invitationId'] ?? '' });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.patch('/users/:userId', requirePermission('users.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    // Quien impersona no toca owners (#23): ni su rol ni su estado, ni nombra uno nuevo
    const current = deps.members.getMembership(req.activeTenantId ?? '', req.params['userId'] ?? '');
    if (req.impersonator !== undefined && (current?.role === 'owner' || parsed.data.role === 'owner')) {
      sendImpersonating(res);
      return;
    }
    try {
      res.status(200).json(deps.members.updateMember({ ...actorOf(req), targetUserId: req.params['userId'] ?? '', ...parsed.data }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/users/:userId/password-reset', requirePermission('owners.manage'), requireOwnSession, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(201).json(deps.resets.create({ ...actorOf(req), targetUserId: req.params['userId'] ?? '' }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.get('/audit', requirePermission('owners.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(200).json(deps.audit.listForTenant(actorOf(req).tenantId));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
