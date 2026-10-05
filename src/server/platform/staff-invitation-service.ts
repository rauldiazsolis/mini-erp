import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthService, UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { generateLinkToken, hashLinkToken } from '../auth/crypto.ts';
import { DomainError } from '../errors.ts';
import { LINK_GONE_MESSAGE, LINK_TTL_MS } from '../users/invitation-service.ts';
import type { StaffInvitationInfo, StaffInvitationItem } from '../../shared/platform-types.ts';

type ValidInvitation = { id: string; email: string; expiresAt: string; invitedByName: string };

/**
 * Invitaciones al equipo de soporte (#23), solo de root: link de un solo uso, 48 h, sin comercio.
 * Aceptar crea una cuenta de soporte o promueve una existente que no sea de ningún comercio.
 */
export class StaffInvitationService {
  private db: DatabaseSync;
  private auth: AuthService;
  private audit: AuditLog;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; auth: AuthService; audit: AuditLog; now: () => Date }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  create(params: { actorUserId: string; email: string }): { id: string; token: string; expiresAt: string } {
    const email = params.email.trim().toLowerCase();
    const existing = this.db.prepare('SELECT global_role FROM users WHERE email = ?').get(email) as { global_role: string } | undefined;
    if (existing !== undefined && existing.global_role !== 'user') throw new DomainError(409, 'Esa cuenta ya es del equipo');

    const now = this.now();
    // Una invitación nueva al mismo mail reemplaza a la pendiente
    this.db
      .prepare('UPDATE staff_invitations SET revoked_at = ? WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .run(now.toISOString(), email);
    const id = `sinv_${randomUUID()}`;
    const { raw, hash } = generateLinkToken();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    this.db
      .prepare('INSERT INTO staff_invitations (id, email, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, email, hash, params.actorUserId, now.toISOString(), expiresAt);
    this.audit.record({ actorUserId: params.actorUserId, tenantId: null, action: 'staff.invited', details: { email } });
    return { id, token: raw, expiresAt };
  }

  revoke(params: { actorUserId: string; invitationId: string }): void {
    const row = this.db
      .prepare('SELECT email FROM staff_invitations WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .get(params.invitationId) as { email: string } | undefined;
    if (row === undefined) throw new DomainError(404, 'La invitación no existe o ya no está pendiente');
    this.db.prepare('UPDATE staff_invitations SET revoked_at = ? WHERE id = ?').run(this.now().toISOString(), params.invitationId);
    this.audit.record({ actorUserId: params.actorUserId, tenantId: null, action: 'staff.invitation_revoked', details: { email: row.email } });
  }

  listPending(): StaffInvitationItem[] {
    const rows = this.db
      .prepare(
        `SELECT i.id, i.email, i.created_at, i.expires_at, COALESCE(u.name, '') AS invited_by_name
         FROM staff_invitations i LEFT JOIN users u ON u.id = i.created_by
         WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
         ORDER BY i.created_at DESC`,
      )
      .all(this.now().toISOString()) as { id: string; email: string; created_at: string; expires_at: string; invited_by_name: string }[];
    return rows.map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at, expiresAt: r.expires_at, invitedByName: r.invited_by_name }));
  }

  lookup(token: string): StaffInvitationInfo {
    const inv = this.findValid(token);
    return {
      email: inv.email,
      invitedByName: inv.invitedByName,
      accountExists: this.auth.findUserByEmail(inv.email) !== undefined,
      expiresAt: inv.expiresAt,
    };
  }

  accept(params: { token: string; password: string; name?: string | undefined }): { token: string; user: UserSession } {
    const inv = this.findValid(params.token);
    const existing = this.auth.findUserByEmail(inv.email);
    let userId: string;
    if (existing !== undefined) {
      if (!this.auth.verifyUserPassword(existing.id, params.password)) throw new DomainError(401, 'Contraseña incorrecta');
      // Soporte no es miembro de comercios (#16): una cuenta de comercio no pasa al equipo
      if (this.db.prepare('SELECT 1 FROM memberships WHERE user_id = ?').get(existing.id) !== undefined) {
        throw new DomainError(409, 'Esa cuenta es de un comercio: usá otro mail');
      }
      userId = existing.id;
    } else {
      const name = params.name?.trim() ?? '';
      if (name.length < 2) throw new DomainError(400, 'El nombre debe tener al menos 2 caracteres');
      userId = this.auth.createUser({ email: inv.email, password: params.password, name }).user.id;
    }

    this.db.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(userId);
    this.db.prepare('UPDATE staff_invitations SET accepted_at = ?, accepted_by = ? WHERE id = ?').run(this.now().toISOString(), userId, inv.id);
    this.audit.record({ actorUserId: userId, tenantId: null, action: 'staff.joined' });
    const token = this.auth.createSession(userId);
    const user = this.auth.validateSession(token);
    if (user === undefined) throw new DomainError(401, 'No se pudo iniciar la sesión');
    return { token, user };
  }

  private findValid(token: string): ValidInvitation {
    const row = this.db
      .prepare(
        `SELECT i.id, i.email, i.expires_at, COALESCE(u.name, '') AS invited_by_name
         FROM staff_invitations i LEFT JOIN users u ON u.id = i.created_by
         WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
      )
      .get(hashLinkToken(token), this.now().toISOString()) as
      | { id: string; email: string; expires_at: string; invited_by_name: string }
      | undefined;
    if (row === undefined) throw new DomainError(410, LINK_GONE_MESSAGE);
    return { id: row.id, email: row.email, expiresAt: row.expires_at, invitedByName: row.invited_by_name };
  }
}
