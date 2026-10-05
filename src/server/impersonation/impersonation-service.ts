import type { DatabaseSync } from 'node:sqlite';
import type { AuthService, Impersonator, UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { DomainError } from '../errors.ts';

export type ImpersonationStart = { token: string; user: UserSession; impersonator: Impersonator; tenantSlug: string; path: string };

type TargetTenant = { id: string; slug: string };

/**
 * Impersonación de usuario (#23, M7b): root o soporte, con su sesión propia, entran como una cuenta
 * `user` activa con al menos una membresía activa. Nunca como root, soporte, desactivados ni demos.
 */
export class ImpersonationService {
  private db: DatabaseSync;
  private auth: AuthService;
  private audit: AuditLog;

  constructor(deps: { db: DatabaseSync; auth: AuthService; audit: AuditLog }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.audit = deps.audit;
  }

  start(p: { staff: UserSession; parentToken: string; userId: string; tenantSlug?: string | undefined }): ImpersonationStart {
    const { user, tenant } = this.target(p.userId, p.tenantSlug);
    return this.open({ staff: p.staff, parentToken: p.parentToken, user, tenant, path: `/admin/${tenant.slug}/dashboard`, helpRequestId: null });
  }

  /** "Salir": termina la impersonación del token. */
  end(token: string): void {
    if (!this.auth.endImpersonation(token, 'exit')) throw new DomainError(400, 'No estás viendo como otro usuario');
  }

  /** La cuenta y el comercio de entrada: el pedido o, si no, la membresía activa más reciente. */
  private target(userId: string, tenantSlug: string | undefined): { user: UserSession; tenant: TargetTenant } {
    const row = this.db.prepare('SELECT id, email, name, global_role, status FROM users WHERE id = ?').get(userId) as
      | { id: string; email: string; name: string; global_role: string; status: string }
      | undefined;
    if (row === undefined) throw new DomainError(404, 'Usuario no encontrado');
    if (row.global_role !== 'user') throw new DomainError(403, 'No se puede entrar como root o soporte');
    if (row.status !== 'active') throw new DomainError(409, 'La cuenta está desactivada');
    const tenants = this.db
      .prepare(
        `SELECT t.id, t.slug FROM memberships m JOIN tenants t ON t.id = m.tenant_id
         WHERE m.user_id = ? AND m.status = 'active' AND t.id NOT IN (SELECT tenant_id FROM demo_sessions)
         ORDER BY m.created_at DESC, m.rowid DESC`,
      )
      .all(userId) as TargetTenant[];
    if (tenants.length === 0) throw new DomainError(409, 'El usuario no tiene comercios activos');
    const tenant = tenantSlug === undefined ? tenants[0] : tenants.find((t) => t.slug === tenantSlug);
    if (tenant === undefined) throw new DomainError(409, 'El usuario no es miembro activo de ese comercio');
    return { user: { id: row.id, email: row.email, name: row.name, globalRole: 'user' }, tenant };
  }

  private open(p: {
    staff: UserSession;
    parentToken: string;
    user: UserSession;
    tenant: TargetTenant;
    path: string;
    helpRequestId: string | null;
  }): ImpersonationStart {
    const role = p.staff.globalRole;
    if (role !== 'root' && role !== 'support') throw new DomainError(403, 'Solo para la plataforma');
    const token = this.auth.createImpersonationSession({
      parentToken: p.parentToken,
      impersonatorId: p.staff.id,
      userId: p.user.id,
      tenantId: p.tenant.id,
      helpRequestId: p.helpRequestId,
    });
    this.audit.record({
      actorUserId: p.staff.id,
      tenantId: p.tenant.id,
      action: 'impersonation.started',
      targetUserId: p.user.id,
      details: p.helpRequestId === null ? {} : { helpRequestId: p.helpRequestId },
    });
    return {
      token,
      user: p.user,
      impersonator: { id: p.staff.id, name: p.staff.name, globalRole: role },
      tenantSlug: p.tenant.slug,
      path: p.path,
    };
  }
}
