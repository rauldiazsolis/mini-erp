import type { DatabaseSync } from 'node:sqlite';
import type { AuthService, UserRole } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { DomainError } from '../errors.ts';

export type UserStatus = 'active' | 'disabled';

/**
 * Desactivar y reactivar cuentas desde la plataforma (#23). Nadie toca a root ni a sí mismo; al
 * equipo de soporte lo maneja solo root. Desactivar cierra todas las sesiones de la cuenta.
 */
export class UserStatusService {
  private db: DatabaseSync;
  private auth: AuthService;
  private audit: AuditLog;

  constructor(deps: { db: DatabaseSync; auth: AuthService; audit: AuditLog }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.audit = deps.audit;
  }

  setStatus(p: { actor: { id: string; globalRole: UserRole }; targetUserId: string; status: UserStatus }): void {
    const target = this.db.prepare('SELECT global_role, status FROM users WHERE id = ?').get(p.targetUserId) as
      | { global_role: string; status: string }
      | undefined;
    if (target === undefined) throw new DomainError(404, 'Usuario no encontrado');
    if (p.targetUserId === p.actor.id) throw new DomainError(403, 'No podés cambiar tu propia cuenta');
    if (target.global_role === 'root') throw new DomainError(403, 'Root no se desactiva');
    if (target.global_role === 'support' && p.actor.globalRole !== 'root') {
      throw new DomainError(403, 'Solo root maneja al equipo de soporte');
    }
    if (target.status === p.status) return;
    this.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(p.status, p.targetUserId);
    if (p.status === 'disabled') this.auth.revokeSessions(p.targetUserId);
    this.audit.record({
      actorUserId: p.actor.id,
      tenantId: null,
      action: p.status === 'disabled' ? 'user.disabled' : 'user.enabled',
      targetUserId: p.targetUserId,
    });
  }
}
