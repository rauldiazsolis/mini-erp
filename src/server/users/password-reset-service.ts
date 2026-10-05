import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthService, UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { MembershipService } from './membership-service.ts';
import { generateLinkToken, hashLinkToken } from '../auth/crypto.ts';
import type { TenantRole } from '../../shared/permissions.ts';
import { DomainError } from '../errors.ts';
import { LINK_GONE_MESSAGE, LINK_TTL_MS } from './invitation-service.ts';

type ResetRow = { id: string; user_id: string; tenant_id: string | null; expires_at: string; email: string; name: string };

/**
 * Links de restablecimiento de contraseña (#19): un solo uso, 48 h. Los genera el owner para su
 * gente, solo si todas sus membresías activas son en comercios del owner; soporte, desde M7.
 */
export class PasswordResetService {
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

  create(params: { tenantId: string; actor: { userId: string; role: TenantRole }; targetUserId: string }): {
    token: string;
    expiresAt: string;
  } {
    if (params.targetUserId === params.actor.userId) {
      throw new DomainError(403, 'Para tu propia contraseña usá "Mi cuenta"');
    }
    if (this.members.getMembership(params.tenantId, params.targetUserId) === undefined) {
      throw new DomainError(404, 'El usuario no es miembro de este comercio');
    }
    if (!this.members.isFullyOwnedBy(params.targetUserId, params.actor.userId)) {
      throw new DomainError(403, 'Este usuario también está en otro comercio: pedíselo a soporte');
    }

    return this.issue(params.targetUserId, params.actor.userId, params.tenantId);
  }

  /** Desde la plataforma (#23): root y soporte, para cualquier cuenta de comercio; sin comercio. */
  createFromPlatform(params: { actorUserId: string; targetUserId: string }): { token: string; expiresAt: string } {
    const target = this.db.prepare('SELECT global_role FROM users WHERE id = ?').get(params.targetUserId) as { global_role: string } | undefined;
    if (target === undefined) throw new DomainError(404, 'Usuario no encontrado');
    if (target.global_role !== 'user') throw new DomainError(403, 'El equipo de soporte restablece su contraseña con root');
    return this.issue(params.targetUserId, params.actorUserId, null);
  }

  private issue(targetUserId: string, actorUserId: string, tenantId: string | null): { token: string; expiresAt: string } {
    const now = this.now();
    // Un link nuevo invalida los pendientes
    this.db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(targetUserId);
    const { raw, hash } = generateLinkToken();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    this.db
      .prepare(
        'INSERT INTO password_resets (id, user_id, token_hash, created_by, tenant_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(`pwr_${randomUUID()}`, targetUserId, hash, actorUserId, tenantId, now.toISOString(), expiresAt);
    this.audit.record({ actorUserId, tenantId, action: 'password.reset_link_created', targetUserId });
    return { token: raw, expiresAt };
  }

  lookup(token: string): { email: string; name: string; expiresAt: string } {
    const row = this.findValid(token);
    return { email: row.email, name: row.name, expiresAt: row.expires_at };
  }

  /** Fija la contraseña nueva, cierra todas las sesiones del usuario y abre una nueva. */
  complete(params: { token: string; password: string }): { token: string; user: UserSession } {
    const row = this.findValid(params.token);
    this.auth.setPassword(row.user_id, params.password);
    this.auth.revokeSessions(row.user_id);
    this.db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(this.now().toISOString(), row.id);
    this.audit.record({ actorUserId: row.user_id, tenantId: row.tenant_id, action: 'password.reset', targetUserId: row.user_id });
    const token = this.auth.createSession(row.user_id);
    const user = this.auth.validateSession(token);
    if (user === undefined) throw new DomainError(401, 'No se pudo iniciar la sesión');
    return { token, user };
  }

  private findValid(token: string): ResetRow {
    const row = this.db
      .prepare(
        `SELECT r.id, r.user_id, r.tenant_id, r.expires_at, u.email, u.name
         FROM password_resets r JOIN users u ON u.id = r.user_id
         WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?`,
      )
      .get(hashLinkToken(token), this.now().toISOString()) as ResetRow | undefined;
    if (row === undefined) throw new DomainError(410, LINK_GONE_MESSAGE);
    return row;
  }
}
