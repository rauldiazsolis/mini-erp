import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthService, UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { MembershipService } from './membership-service.ts';
import { generateLinkToken, hashLinkToken } from '../auth/crypto.ts';
import { assignableRoles, isTenantRole, type TenantRole } from '../../shared/permissions.ts';
import { DomainError } from '../errors.ts';

/** Los links de invitación y de restablecimiento vencen a las 48 h (#19). */
export const LINK_TTL_MS = 48 * 60 * 60 * 1000;
export const LINK_GONE_MESSAGE = 'Este link ya no sirve: pedile uno nuevo a quien te lo mandó';

export type PendingInvitation = {
  id: string;
  email: string;
  role: TenantRole;
  createdAt: string;
  expiresAt: string;
  invitedByName: string;
};

export type InvitationInfo = {
  tenantName: string;
  role: TenantRole;
  email: string;
  invitedByName: string;
  accountExists: boolean;
  expiresAt: string;
};

type ValidInvitation = {
  id: string;
  tenantId: string;
  email: string;
  role: TenantRole;
  expiresAt: string;
  tenantName: string;
  invitedByName: string;
};

/** Invitaciones por link (#19): un solo uso, 48 h, sin mail. Aceptar crea la cuenta o suma la membresía. */
export class InvitationService {
  private db: DatabaseSync;
  private auth: AuthService;
  private members: MembershipService;
  private audit: AuditLog;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; auth: AuthService; members: MembershipService; audit: AuditLog; now: () => Date }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.members = deps.members;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  create(params: {
    tenantId: string;
    actor: { userId: string; role: TenantRole };
    email: string;
    role: TenantRole;
  }): { id: string; token: string; expiresAt: string } {
    if (!assignableRoles(params.actor.role).includes(params.role)) {
      throw new DomainError(403, 'No podés invitar con ese rol');
    }
    const email = params.email.trim().toLowerCase();
    const existing = this.auth.findUserByEmail(email);
    if (existing !== undefined && this.members.getMembership(params.tenantId, existing.id) !== undefined) {
      throw new DomainError(409, 'Ese correo ya es parte del comercio');
    }

    const now = this.now();
    // Una invitación nueva al mismo mail reemplaza a la pendiente
    this.db
      .prepare('UPDATE invitations SET revoked_at = ? WHERE tenant_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .run(now.toISOString(), params.tenantId, email);
    const id = `inv_${randomUUID()}`;
    const { raw, hash } = generateLinkToken();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    this.db
      .prepare(
        'INSERT INTO invitations (id, tenant_id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, params.tenantId, email, params.role, hash, params.actor.userId, now.toISOString(), expiresAt);
    this.audit.record({
      actorUserId: params.actor.userId,
      tenantId: params.tenantId,
      action: 'invitation.created',
      details: { email, role: params.role },
    });
    return { id, token: raw, expiresAt };
  }

  revoke(params: { tenantId: string; actor: { userId: string; role: TenantRole }; invitationId: string }): void {
    const row = this.db
      .prepare('SELECT email, role FROM invitations WHERE id = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .get(params.invitationId, params.tenantId) as { email: string; role: string } | undefined;
    if (row === undefined) throw new DomainError(404, 'La invitación no existe o ya no está pendiente');
    if (!isTenantRole(row.role) || !assignableRoles(params.actor.role).includes(row.role)) {
      throw new DomainError(403, 'No podés revocar esta invitación');
    }
    this.db.prepare('UPDATE invitations SET revoked_at = ? WHERE id = ?').run(this.now().toISOString(), params.invitationId);
    this.audit.record({
      actorUserId: params.actor.userId,
      tenantId: params.tenantId,
      action: 'invitation.revoked',
      details: { email: row.email, role: row.role },
    });
  }

  listPending(tenantId: string): PendingInvitation[] {
    const rows = this.db
      .prepare(
        `SELECT i.id, i.email, i.role, i.created_at, i.expires_at, u.name AS invited_by_name
         FROM invitations i LEFT JOIN users u ON u.id = i.created_by
         WHERE i.tenant_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
         ORDER BY i.created_at DESC`,
      )
      .all(tenantId, this.now().toISOString()) as {
      id: string;
      email: string;
      role: string;
      created_at: string;
      expires_at: string;
      invited_by_name: string | null;
    }[];
    return rows.flatMap((r) =>
      isTenantRole(r.role)
        ? [{ id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at, invitedByName: r.invited_by_name ?? '' }]
        : [],
    );
  }

  lookup(token: string): InvitationInfo {
    const inv = this.findValid(token);
    return {
      tenantName: inv.tenantName,
      role: inv.role,
      email: inv.email,
      invitedByName: inv.invitedByName,
      accountExists: this.auth.findUserByEmail(inv.email) !== undefined,
      expiresAt: inv.expiresAt,
    };
  }

  accept(params: { token: string; password: string; name?: string | undefined }): {
    token: string;
    user: UserSession;
    tenantId: string;
  } {
    const inv = this.findValid(params.token);
    const existing = this.auth.findUserByEmail(inv.email);
    let user: UserSession;
    let sessionToken: string;
    if (existing !== undefined) {
      if (!this.auth.verifyUserPassword(existing.id, params.password)) throw new DomainError(401, 'Contraseña incorrecta');
      if (this.members.getMembership(inv.tenantId, existing.id) !== undefined) {
        throw new DomainError(409, 'Ya sos parte de este comercio');
      }
      sessionToken = this.auth.createSession(existing.id);
      const session = this.auth.validateSession(sessionToken);
      if (session === undefined) throw new DomainError(401, 'No se pudo iniciar la sesión');
      user = session;
    } else {
      const name = params.name?.trim() ?? '';
      if (name.length < 2) throw new DomainError(400, 'El nombre debe tener al menos 2 caracteres');
      const created = this.auth.createUser({ email: inv.email, password: params.password, name });
      user = created.user;
      sessionToken = created.token;
    }

    this.members.addMembership(inv.tenantId, user.id, inv.role);
    this.db.prepare('UPDATE invitations SET accepted_at = ?, accepted_by = ? WHERE id = ?').run(this.now().toISOString(), user.id, inv.id);
    this.audit.record({ actorUserId: user.id, tenantId: inv.tenantId, action: 'invitation.accepted', details: { role: inv.role } });
    return { token: sessionToken, user, tenantId: inv.tenantId };
  }

  private findValid(token: string): ValidInvitation {
    const row = this.db
      .prepare(
        `SELECT i.id, i.tenant_id, i.email, i.role, i.expires_at, t.name AS tenant_name, COALESCE(u.name, '') AS invited_by_name
         FROM invitations i
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN users u ON u.id = i.created_by
         WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
      )
      .get(hashLinkToken(token), this.now().toISOString()) as
      | { id: string; tenant_id: string; email: string; role: string; expires_at: string; tenant_name: string; invited_by_name: string }
      | undefined;
    if (row === undefined || !isTenantRole(row.role)) throw new DomainError(410, LINK_GONE_MESSAGE);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at,
      tenantName: row.tenant_name,
      invitedByName: row.invited_by_name,
    };
  }
}
