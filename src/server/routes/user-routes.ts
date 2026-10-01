import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import type { MembershipService } from '../users/membership-service.ts';
import type { InvitationService } from '../users/invitation-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { TENANT_ROLES, type TenantRole } from '../../shared/permissions.ts';
import { DomainError, sendError } from '../errors.ts';

const inviteSchema = z.object({
  email: z.string().trim().email('Email inválido'),
  role: z.enum(TENANT_ROLES),
});

const patchSchema = z.object({
  role: z.enum(TENANT_ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

function actorOf(req: AuthenticatedAdminRequest): { tenantId: string; actor: { userId: string; role: TenantRole } } {
  if (req.user === undefined || req.tenantRole === undefined || req.activeTenantId === undefined) {
    throw new DomainError(401, 'No autorizado');
  }
  return { tenantId: req.activeTenantId, actor: { userId: req.user.id, role: req.tenantRole } };
}

/** Usuarios del comercio, invitaciones y auditoría (#19), en la cadena de /api/tenants/:tenantId. */
export function createUserRoutes(deps: { members: MembershipService; invitations: InvitationService; audit: AuditLog }): Router {
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
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
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
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      res.status(200).json(deps.members.updateMember({ ...actorOf(req), targetUserId: req.params['userId'] ?? '', ...parsed.data }));
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
