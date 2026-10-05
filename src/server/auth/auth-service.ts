import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, generateSessionToken } from './crypto.ts';
import { DomainError } from '../errors.ts';
import type { MembershipRole } from '../../shared/permissions.ts';

export type UserRole = 'root' | 'support' | 'user';

export type UserSession = {
  id: string;
  email: string;
  name: string;
  globalRole: UserRole;
};

export type TenantMembershipInfo = {
  tenantId: string;
  slug: string;
  name: string;
  status: 'active' | 'maintenance' | 'suspended';
  role: MembershipRole;
};

export class AuthService {
  private systemDb: DatabaseSync;

  constructor(systemDb: DatabaseSync) {
    this.systemDb = systemDb;
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
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 días

    this.systemDb
      .prepare(
        'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(token, userId, expiresAt, now.toISOString());

    return token;
  }

  validateSession(token: string): UserSession | undefined {
    const now = new Date().toISOString();
    const row = this.systemDb
      .prepare(
        `SELECT u.id, u.email, u.name, u.global_role, s.expires_at 
         FROM sessions s 
         JOIN users u ON s.user_id = u.id 
         WHERE s.token = ? AND u.status = 'active'`,
      )
      .get(token) as
      | { id: string; email: string; name: string; global_role: string; expires_at: string }
      | undefined;

    if (row === undefined) {
      return undefined;
    }

    if (row.expires_at < now) {
      this.systemDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return undefined;
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      globalRole: row.global_role as UserRole,
    };
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

  listUserTenants(userId: string, globalRole: UserRole): TenantMembershipInfo[] {
    if (globalRole === 'root' || globalRole === 'support') {
      // Impersonación: root y support tienen acceso a todos los tenants
      const rows = this.systemDb
        .prepare(
          // Las demos (#9) no se listan: en la web serían cientos
          `SELECT id, slug, name, status FROM tenants
           WHERE id NOT IN (SELECT tenant_id FROM demo_sessions)
           ORDER BY created_at DESC`,
        )
        .all() as { id: string; slug: string; name: string; status: string }[];

      const role = globalRole === 'root' ? 'root_impersonator' : 'support_impersonator';

      return rows.map((r) => ({
        tenantId: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status as TenantMembershipInfo['status'],
        role,
      }));
    }

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
