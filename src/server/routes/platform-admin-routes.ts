import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePlatformRole } from '../middleware/platform-role-middleware.ts';
import type { SuspensionService } from '../platform/suspension-service.ts';
import type { UserStatusService } from '../platform/user-status-service.ts';
import type { PasswordResetService } from '../users/password-reset-service.ts';
import type { StaffInvitationService } from '../platform/staff-invitation-service.ts';
import type { PlatformQueryService } from '../platform/platform-query-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { HelpRequestService } from '../help/help-request-service.ts';
import { DomainError, sendError } from '../errors.ts';
import { routeParam } from '../http/route-param.ts';

const reasonSchema = z.object({ reason: z.string().trim().min(1, 'Falta el motivo').max(200) });
const searchSchema = z.object({ q: z.string().trim().max(100).optional() });
const usersQuerySchema = searchSchema.extend({ offset: z.coerce.number().int().min(0).optional() });
const auditQuerySchema = z.object({ tenantId: z.string().trim().max(100).optional(), tenantSlug: z.string().trim().max(100).optional() });
const staffInviteSchema = z.object({ email: z.string().trim().pipe(z.email('Email inválido')) });

export type PlatformAdminDeps = {
  suspensions: SuspensionService;
  userStatus: UserStatusService;
  resets: PasswordResetService;
  staffInvitations: StaffInvitationService;
  queries: PlatformQueryService;
  audit: AuditLog;
  help: HelpRequestService;
};

/** Panel de plataforma (#23, M7a), para root y soporte. Lo de cobro sigue en platform-routes.ts. */
export function createPlatformAdminRoutes(deps: PlatformAdminDeps): Router {
  const router = Router();
  const staff = requirePlatformRole('root', 'support');
  const rootOnly = requirePlatformRole('root');
  const actorOf = (req: AuthenticatedAdminRequest): string => req.user?.id ?? '';

  router.get('/tenants', staff, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = searchSchema.safeParse(req.query);
    res.status(200).json(deps.queries.listTenants(parsed.success ? parsed.data.q : undefined));
  });

  // Va antes de /tenants/:tenantId: el detalle que se abre desde la URL del panel
  router.get('/tenants/by-slug/:slug', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(200).json(await deps.queries.tenantDetail(deps.queries.tenantIdBySlug(routeParam(req, 'slug') ?? '')));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.get('/tenants/:tenantId', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(200).json(await deps.queries.tenantDetail(routeParam(req, 'tenantId') ?? ''));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.get('/users', staff, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = usersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Consulta inválida' });
      return;
    }
    res.status(200).json(deps.queries.listUsers(parsed.data.q, parsed.data.offset));
  });

  router.get('/audit', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Filtro inválido' });
      return;
    }
    try {
      const { tenantId, tenantSlug } = parsed.data;
      const id = tenantSlug !== undefined && tenantSlug !== '' ? deps.queries.tenantIdBySlug(tenantSlug) : tenantId === '' ? undefined : tenantId;
      res.status(200).json(await deps.audit.listPlatform({ tenantId: id }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/tenants/:tenantId/suspend', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = reasonSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      await deps.suspensions.suspend({ tenantId: routeParam(req, 'tenantId') ?? '', reason: parsed.data.reason, actorUserId: actorOf(req) });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/tenants/:tenantId/reactivate', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      await deps.suspensions.reactivate({ tenantId: routeParam(req, 'tenantId') ?? '', actorUserId: actorOf(req) });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  // Desactivar y reactivar cuentas: las reglas de quién a quién están en el servicio
  for (const [path, status] of [['disable', 'disabled'], ['enable', 'active']] as const) {
    router.post(`/users/:userId/${path}`, staff, async (req: AuthenticatedAdminRequest, res: Response) => {
      try {
        if (req.user === undefined) throw new DomainError(401, 'No autorizado');
        await deps.userStatus.setStatus({ actor: { id: req.user.id, globalRole: req.user.globalRole }, targetUserId: routeParam(req, 'userId') ?? '', status });
        res.status(200).json({ success: true });
      } catch (err: unknown) {
        sendError(res, err, 500);
      }
    });
  }

  router.post('/users/:userId/password-reset', staff, async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(201).json(await deps.resets.createFromPlatform({ actorUserId: actorOf(req), targetUserId: routeParam(req, 'userId') ?? '' }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  // Pedidos de ayuda de las últimas 48 h (#23)
  router.get('/help-requests', staff, (_req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(deps.help.listForPanel());
  });

  // El equipo de soporte (#23): solo root lo ve, lo invita y revoca invitaciones
  router.get('/staff', rootOnly, (_req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json({ members: deps.queries.listStaff(), invitations: deps.staffInvitations.listPending() });
  });

  router.post('/staff/invitations', rootOnly, async (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = staffInviteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      res.status(201).json(await deps.staffInvitations.create({ actorUserId: actorOf(req), email: parsed.data.email }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.delete('/staff/invitations/:invitationId', rootOnly, async (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      await deps.staffInvitations.revoke({ actorUserId: actorOf(req), invitationId: routeParam(req, 'invitationId') ?? '' });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
