import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, generateSessionToken } from './crypto.ts';

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
  role: 'owner' | 'admin' | 'member' | 'root_impersonator' | 'support_impersonator';
};

export class AuthService {
  private systemDb: DatabaseSync;

  constructor(systemDb: DatabaseSync) {
    this.systemDb = systemDb;
  }

  register(params: { email: string; password: string; name: string }): {
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

    const countRow = this.systemDb
      .prepare('SELECT COUNT(*) as count FROM users')
      .get() as { count: number };
    const globalRole: UserRole = countRow.count === 0 ? 'root' : 'user';

    const userId = `usr_${randomUUID()}`;
    const passwordHash = hashPassword(params.password);
    const now = new Date().toISOString();

    this.systemDb
      .prepare(
        'INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(userId, email, passwordHash, params.name.trim(), globalRole, now);

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

  login(params: { email: string; password: string }): {
    token: string;
    user: UserSession;
  } {
    const email = params.email.trim().toLowerCase();
    const userRow = this.systemDb
      .prepare('SELECT id, email, password_hash, name, global_role FROM users WHERE email = ?')
      .get(email) as
      | { id: string; email: string; password_hash: string; name: string; global_role: string }
      | undefined;

    if (userRow === undefined) {
      throw new Error('Credenciales inválidas');
    }

    const valid = verifyPassword(params.password, userRow.password_hash);
    if (!valid) {
      throw new Error('Credenciales inválidas');
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

  private createSession(userId: string): string {
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
         WHERE s.token = ?`,
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

  listUserTenants(userId: string, globalRole: UserRole): TenantMembershipInfo[] {
    if (globalRole === 'root' || globalRole === 'support') {
      // Impersonación: root y support tienen acceso a todos los tenants
      const rows = this.systemDb
        .prepare('SELECT id, slug, name, status FROM tenants ORDER BY created_at DESC')
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
         WHERE m.user_id = ? 
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
