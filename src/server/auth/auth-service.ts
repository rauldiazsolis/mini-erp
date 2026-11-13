import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
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

export type TenantMembershipInfo = {
  tenantId: string;
  slug: string;
  name: string;
  status: 'active' | 'maintenance' | 'suspended';
  role: TenantRole;
};

/**
 * Usuarios y sesiones, en `system` de PostgreSQL. Los métodos de escritura aceptan, como último
 * argumento, el `trx` de quien los llama (aceptar una invitación, restablecer la contraseña): así
 * quedan en su transacción.
 */
export class AuthService {
  private db: Kysely<SystemDatabase>;
  private now: () => Date;
  private audit: AuditLog | undefined;

  constructor(db: Kysely<SystemDatabase>, deps: { now?: (() => Date) | undefined; audit?: AuditLog | undefined } = {}) {
    this.db = db;
    this.now = deps.now ?? (() => new Date());
    this.audit = deps.audit;
  }

  /** Crea una cuenta con su sesión. Solo la usan el alta y las invitaciones (#19): no hay registro suelto. */
  async createUser(
    params: { email: string; password: string; name: string; whatsapp?: string | undefined },
    db: Kysely<SystemDatabase> = this.db,
  ): Promise<{
    token: string;
    user: UserSession;
  }> {
    const email = params.email.trim().toLowerCase();
    const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    if (existing !== undefined) {
      throw new Error('El correo electrónico ya está registrado');
    }

    // El root sale de ensureRoot (#3): publicado, el primero en registrarse sería root
    const globalRole: UserRole = 'user';

    const userId = `usr_${randomUUID()}`;
    const passwordHash = hashPassword(params.password);
    const name = params.name.trim();

    await db
      .insertInto('users')
      .values({
        id: userId,
        email,
        password_hash: passwordHash,
        name,
        global_role: globalRole,
        created_at: new Date().toISOString(),
        whatsapp: params.whatsapp ?? null,
      })
      .execute();

    const token = await this.createSession(userId, db);

    return { token, user: { id: userId, email, name, globalRole } };
  }

  /** Root inicial (#3): crea el usuario como root o promueve uno existente con la contraseña dada. */
  async ensureRoot(params: { email: string; password: string; name: string }): Promise<{ user: UserSession; created: boolean }> {
    const email = params.email.trim().toLowerCase();
    const name = params.name.trim();
    const passwordHash = hashPassword(params.password);
    const existing = await this.db.selectFrom('users').select(['id', 'name']).where('email', '=', email).executeTakeFirst();

    if (existing !== undefined) {
      await this.db.updateTable('users').set({ global_role: 'root', password_hash: passwordHash }).where('id', '=', existing.id).execute();
      return { user: { id: existing.id, email, name: existing.name, globalRole: 'root' }, created: false };
    }

    const id = `usr_${randomUUID()}`;
    await this.db
      .insertInto('users')
      .values({ id, email, password_hash: passwordHash, name, global_role: 'root', created_at: new Date().toISOString() })
      .execute();
    return { user: { id, email, name, globalRole: 'root' }, created: true };
  }

  async login(params: { email: string; password: string }): Promise<{
    token: string;
    user: UserSession;
  }> {
    const email = params.email.trim().toLowerCase();
    const userRow = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'password_hash', 'name', 'global_role', 'status'])
      .where('email', '=', email)
      .executeTakeFirst();

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

    const token = await this.createSession(userRow.id);

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

  async createSession(userId: string, db: Kysely<SystemDatabase> = this.db): Promise<string> {
    const token = generateSessionToken();
    const now = this.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString(); // 30 días

    await db.insertInto('sessions').values({ token, user_id: userId, expires_at: expiresAt, created_at: now.toISOString() }).execute();

    return token;
  }

  /** El usuario de la sesión, propia o impersonada. Para saber si es una impersonación, `resolveSession`. */
  async validateSession(token: string, db: Kysely<SystemDatabase> = this.db): Promise<UserSession | undefined> {
    return (await this.resolveSession(token, db))?.user;
  }

  /**
   * Resuelve el token (#23): una impersonación vence a las 2 h sin uso y muere si su sesión padre ya no
   * existe, venció o es de una cuenta desactivada. Las dos cosas la borran y se auditan.
   */
  async resolveSession(token: string, db: Kysely<SystemDatabase> = this.db): Promise<ResolvedSession | undefined> {
    const row = await db
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .leftJoin('users as imp', 'imp.id', 's.impersonator_user_id')
      .leftJoin('sessions as p', 'p.token', 's.parent_token')
      .select([
        'u.id',
        'u.email',
        'u.name',
        'u.global_role',
        's.expires_at',
        's.impersonator_user_id',
        's.help_request_id',
        's.tenant_id',
        's.last_used_at',
        'imp.name as imp_name',
        'imp.global_role as imp_role',
        'imp.status as imp_status',
        'p.expires_at as parent_expires_at',
      ])
      .where('s.token', '=', token)
      .where('u.status', '=', 'active')
      .executeTakeFirst();
    if (row === undefined) return undefined;

    const now = this.now();
    if (row.expires_at < now.toISOString()) {
      await db.deleteFrom('sessions').where('token', '=', token).execute();
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
      await this.endImpersonation(token, 'parent-ended', db);
      return undefined;
    }
    const idle = now.getTime() - Date.parse(row.last_used_at ?? '');
    if (!(idle <= IMPERSONATION_IDLE_MS)) {
      await this.endImpersonation(token, 'expired', db);
      return undefined;
    }
    if (idle >= TOUCH_EVERY_MS) {
      await db.updateTable('sessions').set({ last_used_at: now.toISOString() }).where('token', '=', token).execute();
    }
    return {
      user,
      impersonator: { id: row.impersonator_user_id, name: row.imp_name ?? '', globalRole: impRole },
      tenantId: row.tenant_id,
      helpRequestId: row.help_request_id,
    };
  }

  /** Una sesión de impersonación (#23): un token propio, hijo de la sesión de quien impersona. */
  async createImpersonationSession(
    p: {
      parentToken: string;
      impersonatorId: string;
      userId: string;
      tenantId: string;
      helpRequestId: string | null;
    },
    db: Kysely<SystemDatabase> = this.db,
  ): Promise<string> {
    const token = generateSessionToken();
    const now = this.now();
    await db
      .insertInto('sessions')
      .values({
        token,
        user_id: p.userId,
        expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
        created_at: now.toISOString(),
        impersonator_user_id: p.impersonatorId,
        parent_token: p.parentToken,
        help_request_id: p.helpRequestId,
        tenant_id: p.tenantId,
        last_used_at: now.toISOString(),
      })
      .execute();
    return token;
  }

  /** Termina una impersonación y la audita; `false` si el token no es una. */
  async endImpersonation(token: string, reason: 'exit' | 'expired' | 'parent-ended', db: Kysely<SystemDatabase> = this.db): Promise<boolean> {
    const row = await db
      .deleteFrom('sessions')
      .where('token', '=', token)
      .where('impersonator_user_id', 'is not', null)
      .returning(['user_id', 'impersonator_user_id', 'tenant_id'])
      .executeTakeFirst();
    if (row === undefined || row.impersonator_user_id === null) return false;
    await this.audit?.record(
      {
        actorUserId: row.impersonator_user_id,
        tenantId: row.tenant_id,
        action: 'impersonation.ended',
        targetUserId: row.user_id,
        details: { reason },
      },
      db,
    );
    return true;
  }

  /** "Cerrar sesión" (#23): borra la sesión del token; sus impersonaciones mueren en el próximo pedido. */
  async deleteSession(token: string): Promise<void> {
    if (await this.endImpersonation(token, 'exit')) return;
    await this.db.deleteFrom('sessions').where('token', '=', token).execute();
  }

  async findUserByEmail(email: string, db: Kysely<SystemDatabase> = this.db): Promise<{ id: string; email: string; name: string } | undefined> {
    return await db.selectFrom('users').select(['id', 'email', 'name']).where('email', '=', email.trim().toLowerCase()).executeTakeFirst();
  }

  async verifyUserPassword(userId: string, password: string, db: Kysely<SystemDatabase> = this.db): Promise<boolean> {
    const row = await db.selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirst();
    return row !== undefined && verifyPassword(password, row.password_hash);
  }

  async setPassword(userId: string, password: string, db: Kysely<SystemDatabase> = this.db): Promise<void> {
    await db.updateTable('users').set({ password_hash: hashPassword(password) }).where('id', '=', userId).execute();
  }

  /** Cierra las sesiones del usuario, salvo la indicada (la del equipo que cambió la contraseña). */
  async revokeSessions(userId: string, exceptToken?: string, db: Kysely<SystemDatabase> = this.db): Promise<void> {
    let query = db.deleteFrom('sessions').where('user_id', '=', userId);
    if (exceptToken !== undefined) {
      query = query.where('token', '<>', exceptToken);
    }
    await query.execute();
  }

  /** Deshace un usuario recién creado (alta fallida): sus sesiones y membresías se van con él (`ON DELETE CASCADE`). */
  async deleteUser(userId: string, db: Kysely<SystemDatabase> = this.db): Promise<void> {
    await db.deleteFrom('users').where('id', '=', userId).execute();
  }

  async changePassword(params: { userId: string; currentPassword: string; newPassword: string; currentToken: string }): Promise<void> {
    if (!(await this.verifyUserPassword(params.userId, params.currentPassword))) {
      throw new DomainError(400, 'La contraseña actual no es correcta');
    }
    await this.db.transaction().execute(async (trx) => {
      await this.setPassword(params.userId, params.newPassword, trx);
      await this.revokeSessions(params.userId, params.currentToken, trx);
    });
  }

  /** "Tus comercios": las membresías activas. Root y soporte no son miembros implícitos (#16). */
  async listUserTenants(userId: string): Promise<TenantMembershipInfo[]> {
    const rows = await this.db
      .selectFrom('memberships as m')
      .innerJoin('tenants as t', 't.id', 'm.tenant_id')
      .select(['t.id', 't.slug', 't.name', 't.status', 'm.role'])
      .where('m.user_id', '=', userId)
      .where('m.status', '=', 'active')
      .orderBy('m.created_at', 'desc')
      .orderBy('m.seq', 'desc')
      .execute();

    return rows.map((r) => ({
      tenantId: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status as TenantMembershipInfo['status'],
      role: r.role as TenantMembershipInfo['role'],
    }));
  }
}
