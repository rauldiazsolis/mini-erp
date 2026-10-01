import type { DatabaseSync } from 'node:sqlite';
import type { UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { assignableRoles, can, isTenantRole, type TenantRole } from '../../shared/permissions.ts';
import { DomainError } from '../errors.ts';

export type MemberStatus = 'active' | 'disabled';

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: TenantRole;
  status: MemberStatus;
  joinedAt: string;
};

function toStatus(value: string): MemberStatus {
  return value === 'disabled' ? 'disabled' : 'active';
}

/** Membresías de los comercios (#19): rol activo, miembros y la regla de "todo suyo". */
export class MembershipService {
  private db: DatabaseSync;
  private audit: AuditLog | undefined;

  constructor(db: DatabaseSync, audit?: AuditLog) {
    this.db = db;
    this.audit = audit;
  }

  /** El rol con el que el usuario opera el comercio; root y support, owner hasta M7. */
  resolveRole(user: UserSession, tenantId: string): TenantRole | undefined {
    if (user.globalRole === 'root' || user.globalRole === 'support') {
      // Las demos (#9) no se impersonan desde el admin
      const tenant = this.db
        .prepare('SELECT id FROM tenants WHERE id = ? AND id NOT IN (SELECT tenant_id FROM demo_sessions)')
        .get(tenantId);
      return tenant === undefined ? undefined : 'owner';
    }
    const membership = this.getMembership(tenantId, user.id);
    return membership?.status === 'active' ? membership.role : undefined;
  }

  getMembership(tenantId: string, userId: string): { role: TenantRole; status: MemberStatus } | undefined {
    const row = this.db
      .prepare('SELECT role, status FROM memberships WHERE tenant_id = ? AND user_id = ?')
      .get(tenantId, userId) as { role: string; status: string } | undefined;
    if (row === undefined || !isTenantRole(row.role)) return undefined;
    return { role: row.role, status: toStatus(row.status) };
  }

  addMembership(tenantId: string, userId: string, role: TenantRole): void {
    this.db
      .prepare("INSERT INTO memberships (user_id, tenant_id, role, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(userId, tenantId, role, new Date().toISOString());
  }

  listMembers(tenantId: string): MemberRow[] {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.name, u.email, m.role, m.status, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = ?
         ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all(tenantId) as { id: string; name: string; email: string; role: string; status: string; created_at: string }[];
    return rows.flatMap((r) =>
      isTenantRole(r.role)
        ? [{ userId: r.id, name: r.name, email: r.email, role: r.role, status: toStatus(r.status), joinedAt: r.created_at }]
        : [],
    );
  }

  countActiveOwners(tenantId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ? AND role = 'owner' AND status = 'active'")
      .get(tenantId) as { n: number };
    return row.n;
  }

  /** Todas las membresías activas del usuario están en comercios donde el actor es owner activo. */
  isFullyOwnedBy(targetUserId: string, actorUserId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM memberships t
         WHERE t.user_id = ? AND t.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM memberships a
             WHERE a.tenant_id = t.tenant_id AND a.user_id = ? AND a.role = 'owner' AND a.status = 'active'
           )`,
      )
      .get(targetUserId, actorUserId) as { n: number };
    return row.n === 0;
  }

  /**
   * Cambia el rol o el estado de un miembro (#19). Nadie cambia su propia membresía, solo un owner
   * toca owners, el rol nuevo tiene que estar entre los que el actor puede asignar y el comercio
   * nunca se queda sin un owner activo.
   */
  updateMember(params: {
    tenantId: string;
    actor: { userId: string; role: TenantRole };
    targetUserId: string;
    role?: TenantRole | undefined;
    status?: MemberStatus | undefined;
  }): MemberRow {
    const { tenantId, actor, targetUserId } = params;
    if (targetUserId === actor.userId) throw new DomainError(403, 'No podés cambiar tu propia membresía');
    const current = this.getMembership(tenantId, targetUserId);
    if (current === undefined) throw new DomainError(404, 'El usuario no es miembro de este comercio');

    const touchesOwner = current.role === 'owner' || params.role === 'owner';
    if (touchesOwner && !can(actor.role, 'owners.manage')) {
      throw new DomainError(403, 'Solo un owner puede cambiar a otro owner');
    }
    if (params.role !== undefined && !assignableRoles(actor.role).includes(params.role)) {
      throw new DomainError(403, 'No podés asignar ese rol');
    }
    const losesOwner =
      current.role === 'owner' &&
      current.status === 'active' &&
      ((params.role !== undefined && params.role !== 'owner') || params.status === 'disabled');
    if (losesOwner && this.countActiveOwners(tenantId) <= 1) {
      throw new DomainError(409, 'El comercio necesita al menos un owner activo');
    }

    if (params.role !== undefined && params.role !== current.role) {
      this.db.prepare('UPDATE memberships SET role = ? WHERE tenant_id = ? AND user_id = ?').run(params.role, tenantId, targetUserId);
      this.audit?.record({
        actorUserId: actor.userId,
        tenantId,
        action: 'member.role_changed',
        targetUserId,
        details: { from: current.role, to: params.role },
      });
    }
    if (params.status !== undefined && params.status !== current.status) {
      this.db.prepare('UPDATE memberships SET status = ? WHERE tenant_id = ? AND user_id = ?').run(params.status, tenantId, targetUserId);
      this.audit?.record({
        actorUserId: actor.userId,
        tenantId,
        action: params.status === 'disabled' ? 'member.disabled' : 'member.enabled',
        targetUserId,
      });
    }
    const updated = this.listMembers(tenantId).find((m) => m.userId === targetUserId);
    if (updated === undefined) throw new DomainError(404, 'El usuario no es miembro de este comercio');
    return updated;
  }
}
