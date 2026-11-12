import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
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
  private db: Kysely<SystemDatabase>;
  private auth: AuthService;
  private members: MembershipService;
  private audit: AuditLog;
  private now: () => Date;

  constructor(deps: { db: Kysely<SystemDatabase>; auth: AuthService; members: MembershipService; audit: AuditLog; now: () => Date }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.members = deps.members;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  async create(params: { tenantId: string; actor: { userId: string; role: TenantRole }; targetUserId: string }): Promise<{
    token: string;
    expiresAt: string;
  }> {
    if (params.targetUserId === params.actor.userId) {
      throw new DomainError(403, 'Para tu propia contraseña usá "Mi cuenta"');
    }
    if ((await this.members.getMembership(params.tenantId, params.targetUserId)) === undefined) {
      throw new DomainError(404, 'El usuario no es miembro de este comercio');
    }
    if (!(await this.members.isFullyOwnedBy(params.targetUserId, params.actor.userId))) {
      throw new DomainError(403, 'Este usuario también está en otro comercio: pedíselo a soporte');
    }

    return await this.issue(params.targetUserId, params.actor.userId, params.tenantId);
  }

  /** Desde la plataforma (#23): root y soporte, para cualquier cuenta de comercio; sin comercio. */
  async createFromPlatform(params: { actorUserId: string; targetUserId: string }): Promise<{ token: string; expiresAt: string }> {
    const target = await this.db.selectFrom('users').select('global_role').where('id', '=', params.targetUserId).executeTakeFirst();
    if (target === undefined) throw new DomainError(404, 'Usuario no encontrado');
    if (target.global_role !== 'user') throw new DomainError(403, 'El equipo de soporte restablece su contraseña con root');
    return await this.issue(params.targetUserId, params.actorUserId, null);
  }

  private async issue(targetUserId: string, actorUserId: string, tenantId: string | null): Promise<{ token: string; expiresAt: string }> {
    const now = this.now();
    const { raw, hash } = generateLinkToken();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    await this.db.transaction().execute(async (trx) => {
      // Un link nuevo invalida los pendientes
      await trx.deleteFrom('password_resets').where('user_id', '=', targetUserId).where('used_at', 'is', null).execute();
      await trx
        .insertInto('password_resets')
        .values({
          id: `pwr_${randomUUID()}`,
          user_id: targetUserId,
          token_hash: hash,
          created_by: actorUserId,
          tenant_id: tenantId,
          created_at: now.toISOString(),
          expires_at: expiresAt,
        })
        .execute();
      await this.audit.record({ actorUserId, tenantId, action: 'password.reset_link_created', targetUserId }, trx);
    });
    return { token: raw, expiresAt };
  }

  async lookup(token: string): Promise<{ email: string; name: string; expiresAt: string }> {
    const row = await this.findValid(token);
    return { email: row.email, name: row.name, expiresAt: row.expires_at };
  }

  /** Fija la contraseña nueva, cierra todas las sesiones del usuario y abre una nueva. */
  async complete(params: { token: string; password: string }): Promise<{ token: string; user: UserSession }> {
    // Todo o nada: la contraseña, las sesiones cerradas, el link usado, la auditoría y la sesión nueva
    return await this.db.transaction().execute(async (trx) => {
      const row = await this.findValid(params.token, trx);
      // Si otro pedido lo usó mientras tanto, este se deshace entero
      const used = await trx
        .updateTable('password_resets')
        .set({ used_at: this.now().toISOString() })
        .where('id', '=', row.id)
        .where('used_at', 'is', null)
        .executeTakeFirst();
      if (Number(used.numUpdatedRows) === 0) throw new DomainError(410, LINK_GONE_MESSAGE);
      await this.auth.setPassword(row.user_id, params.password, trx);
      await this.auth.revokeSessions(row.user_id, undefined, trx);
      await this.audit.record({ actorUserId: row.user_id, tenantId: row.tenant_id, action: 'password.reset', targetUserId: row.user_id }, trx);
      const token = await this.auth.createSession(row.user_id, trx);
      const user = await this.auth.validateSession(token, trx);
      if (user === undefined) throw new DomainError(401, 'No se pudo iniciar la sesión');
      return { token, user };
    });
  }

  private async findValid(token: string, db: Kysely<SystemDatabase> = this.db): Promise<ResetRow> {
    const row = await db
      .selectFrom('password_resets as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['r.id', 'r.user_id', 'r.tenant_id', 'r.expires_at', 'u.email', 'u.name'])
      .where('r.token_hash', '=', hashLinkToken(token))
      .where('r.used_at', 'is', null)
      .where('r.expires_at', '>', this.now().toISOString())
      .executeTakeFirst();
    if (row === undefined) throw new DomainError(410, LINK_GONE_MESSAGE);
    return row;
  }
}
