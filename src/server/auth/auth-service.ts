import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, generateSessionToken } from './crypto.ts';
import { DomainError } from '../errors.ts';
import type { TenantRole } from '../../shared/permissions.ts';
import type { AuditLog } from '../audit/audit-log.ts';

export type UserRole = 'root' | 'support' | 'user';

export type UserSession = {
  id: string;
  email: string;
  name: string;
  globalRole: UserRole;
};

export type Impersonator = { id: string; name: string; globalRole: 'root' | 'support' };

/** Una sesión resuelta (#23): la del usuario o una impersonación, con quién la abrió. */
export type ResolvedSession = {
  user: UserSession;
  impersonator: Impersonator | null;
  tenantId: string | null;
  helpRequestId: string | null;
};

/** Una impersonación vence a las 2 h sin uso; el último uso se escribe a lo sumo una vez por minuto. */
export const IMPERSONATION_IDLE_MS = 2 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type SessionRow = {
  id: string;
  email: string;
  name: string;
  global_role: string;
  expires_at: string;
  impersonator_user_id: string | null;
  help_request_id: string | null;
  tenant_id: string | null;
  last_used_at: string | null;
  imp_name: string | null;
  imp_role: string | null;
  imp_status: string | null;
  parent_expires_at: string | null;
};

export type TenantMembershipInfo = {
  tenantId: string;
  slug: string;
  name: string;
  status: 'active' | 'maintenance' | 'suspended';
  role: TenantRole;
};

export class AuthService {
  private systemDb: DatabaseSync;
  private now: () => Date;
  private audit: AuditLog | undefined;

  constructor(systemDb: DatabaseSync, deps: { now?: (() => Date) | undefined; audit?: AuditLog | undefined } = {}) {
    this.systemDb = systemDb;
    this.now = deps.now ?? (() => new Date());
    this.audit = deps.audit;
  }

  /** Crea una cuenta con su sesión. Solo la usan el alta y las invitaciones (#19): no hay registro suelto. */
  createUser(params: { email: string; password: string; name: string; whatsapp?: string | undefined }): {
    token: string;
    user: UserSession;
  } {
    const email = params.email.trim().toLowerCase();
    const existing = this.systemDb
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(email);
    if (existing !== undefined) {
      throw new Error('El correo electrónico ya está registrado');
    }

    // El root sale de ensureRoot (#3): publicado, el primero en registrarse sería root
    const globalRole: UserRole = 'user';

    const userId = `usr_${randomUUID()}`;
    const passwordHash = hashPassword(params.password);
    const now = new Date().toISOString();

    this.systemDb
      .prepare(
        'INSERT INTO users (id, email, password_hash, name, global_role, created_at, whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(userId, email, passwordHash, params.name.trim(), globalRole, now, params.whatsapp ?? null);

    const token = this.createSession(userId);

    return {
      token,
      user: {
        id: userId,
        email,
        name: params.name.trim(),
        globalRole,
      },
    };
  }

  /** Root inicial (#3): crea el usuario como root o promueve uno existente con la contraseña dada. */
  ensureRoot(params: { email: string; password: string; name: string }): { user: UserSession; created: boolean } {
    const email = params.email.trim().toLowerCase();
    const name = params.name.trim();
    const passwordHash = hashPassword(params.password);
    const existing = this.systemDb
      .prepare('SELECT id, name FROM users WHERE email = ?')
      .get(email) as { id: string; name: string } | undefined;

    if (existing !== undefined) {
      this.systemDb
        .prepare("UPDATE users SET global_role = 'root', password_hash = ? WHERE id = ?")
        .run(passwordHash, existing.id);
      return { user: { id: existing.id, email, name: existing.name, globalRole: 'root' }, created: false };
    }

    const id = `usr_${randomUUID()}`;
    this.systemDb
      .prepare(
        'INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, email, passwordHash, name, 'root', new Date().toISOString());
    return { user: { id, email, name, globalRole: 'root' }, created: true };
  }

  login(params: { email: string; password: string }): {
    token: string;
    user: UserSession;
  } {
    const email = params.email.trim().toLowerCase();
    const userRow = this.systemDb
      .prepare('SELECT id, email, password_hash, name, global_role, status FROM users WHERE email = ?')
      .get(email) as
      | { id: string; email: string; password_hash: string; name: string; global_role: string; status: string }
      | undefined;

    if (userRow === undefined) {
      throw new Error('Credenciales inválidas');
    }

    const valid = verifyPassword(params.password, userRow.password_hash);
    if (!valid) {
      throw new Error('Credenciales inválidas');
    }
    // Cuenta desactivada desde la plataforma (#23): solo se avisa con la contraseña correcta
    if (userRow.status === 'disabled') {
      throw new Error('Cuenta desactivada: escribile a soporte');
    }

    const token = this.createSession(userRow.id);

    return {
      token,
      user: {
        id: userRow.id,
        email: userRow.email,
        name: userRow.name,
        globalRole: userRow.global_role as UserRole,
      },
    };
  }

  createSession(userId: string): string {
    const token = generateSessionToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString(); // 30 días

    this.systemDb
      .prepare(
        'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(token, userId, expiresAt, now.toISOString());

    return token;
  }

  /** El usuario de la sesión, propia o impersonada. Para saber si es una impersonación, `resolveSession`. */
  validateSession(token: string): UserSession | undefined {
    return this.resolveSession(token)?.user;
  }

  /**
   * Resuelve el token (#23): una impersonación vence a las 2 h sin uso y muere si su sesión padre ya no
   * existe, venció o es de una cuenta desactivada. Las dos cosas la borran y se auditan.
   */
  resolveSession(token: string): ResolvedSession | undefined {
    const row = this.systemDb
      .prepare(
        `SELECT u.id, u.email, u.name, u.global_role, s.expires_at, s.impersonator_user_id, s.help_request_id,
           s.tenant_id, s.last_used_at, imp.name AS imp_name, imp.global_role AS imp_role, imp.status AS imp_status,
           p.expires_at AS parent_expires_at
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN users imp ON imp.id = s.impersonator_user_id
         LEFT JOIN sessions p ON p.token = s.parent_token
         WHERE s.token = ? AND u.status = 'active'`,
      )
      .get(token) as SessionRow | undefined;
    if (row === undefined) return undefined;

    const now = this.now();
    if (row.expires_at < now.toISOString()) {
      this.systemDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return undefined;
    }
    const user: UserSession = { id: row.id, email: row.email, name: row.name, globalRole: row.global_role as UserRole };
    if (row.impersonator_user_id === null) return { user, impersonator: null, tenantId: null, helpRequestId: null };

    const impRole = row.imp_role;
    const parentAlive =
      row.parent_expires_at !== null &&
      row.parent_expires_at >= now.toISOString() &&
      row.imp_status === 'active' &&
      (impRole === 'root' || impRole === 'support');
    if (!parentAlive) {
      this.endImpersonation(token, 'parent-ended');
      return undefined;
    }
    const idle = now.getTime() - Date.parse(row.last_used_at ?? '');
    if (!(idle <= IMPERSONATION_IDLE_MS)) {
      this.endImpersonation(token, 'expired');
      return undefined;
    }
    if (idle >= TOUCH_EVERY_MS) {
      this.systemDb.prepare('UPDATE sessions SET last_used_at = ? WHERE token = ?').run(now.toISOString(), token);
    }
    return {
      user,
      impersonator: { id: row.impersonator_user_id, name: row.imp_name ?? '', globalRole: impRole },
      tenantId: row.tenant_id,
      helpRequestId: row.help_request_id,
    };
  }

  /** Una sesión de impersonación (#23): un token propio, hijo de la sesión de quien impersona. */
  createImpersonationSession(p: {
    parentToken: string;
    impersonatorId: string;
    userId: string;
    tenantId: string;
    helpRequestId: string | null;
  }): string {
    const token = generateSessionToken();
    const now = this.now();
    this.systemDb
      .prepare(
        `INSERT INTO sessions (token, user_id, expires_at, created_at, impersonator_user_id, parent_token, help_request_id, tenant_id, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token,
        p.userId,
        new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
        now.toISOString(),
        p.impersonatorId,
        p.parentToken,
        p.helpRequestId,
        p.tenantId,
        now.toISOString(),
      );
    return token;
  }

  /** Termina una impersonación y la audita; `false` si el token no es una. */
  endImpersonation(token: string, reason: 'exit' | 'expired' | 'parent-ended'): boolean {
    const row = this.systemDb
      .prepare('SELECT user_id, impersonator_user_id, tenant_id FROM sessions WHERE token = ? AND impersonator_user_id IS NOT NULL')
      .get(token) as { user_id: string; impersonator_user_id: string; tenant_id: string | null } | undefined;
    if (row === undefined) return false;
    this.systemDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    this.audit?.record({
      actorUserId: row.impersonator_user_id,
      tenantId: row.tenant_id,
      action: 'impersonation.ended',
      targetUserId: row.user_id,
      details: { reason },
    });
    return true;
  }

  /** "Cerrar sesión" (#23): borra la sesión del token; sus impersonaciones mueren en el próximo pedido. */
  deleteSession(token: string): void {
    if (this.endImpersonation(token, 'exit')) return;
    this.systemDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  findUserByEmail(email: string): { id: string; email: string; name: string } | undefined {
    return this.systemDb
      .prepare('SELECT id, email, name FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as { id: string; email: string; name: string } | undefined;
  }

  verifyUserPassword(userId: string, password: string): boolean {
    const row = this.systemDb.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
      | { password_hash: string }
      | undefined;
    return row !== undefined && verifyPassword(password, row.password_hash);
  }

  setPassword(userId: string, password: string): void {
    this.systemDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
  }

  /** Cierra las sesiones del usuario, salvo la indicada (la del equipo que cambió la contraseña). */
  revokeSessions(userId: string, exceptToken?: string): void {
    if (exceptToken === undefined) {
      this.systemDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      return;
    }
    this.systemDb.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, exceptToken);
  }

  /** Deshace un usuario recién creado (alta fallida). */
  deleteUser(userId: string): void {
    this.systemDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    this.systemDb.prepare('DELETE FROM memberships WHERE user_id = ?').run(userId);
    this.systemDb.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  changePassword(params: { userId: string; currentPassword: string; newPassword: string; currentToken: string }): void {
    if (!this.verifyUserPassword(params.userId, params.currentPassword)) {
      throw new DomainError(400, 'La contraseña actual no es correcta');
    }
    this.setPassword(params.userId, params.newPassword);
    this.revokeSessions(params.userId, params.currentToken);
  }

  /** "Tus comercios": las membresías activas. Root y soporte no son miembros implícitos (#16). */
  listUserTenants(userId: string): TenantMembershipInfo[] {
    const rows = this.systemDb
      .prepare(
        `SELECT t.id, t.slug, t.name, t.status, m.role 
         FROM memberships m 
         JOIN tenants t ON m.tenant_id = t.id 
         WHERE m.user_id = ? AND m.status = 'active'
         ORDER BY m.created_at DESC`,
      )
      .all(userId) as {
      id: string;
      slug: string;
      name: string;
      status: string;
      role: string;
    }[];

    return rows.map((r) => ({
      tenantId: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status as TenantMembershipInfo['status'],
      role: r.role as TenantMembershipInfo['role'],
    }));
  }
}
