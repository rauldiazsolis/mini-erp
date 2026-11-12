import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
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
  private db: Kysely<SystemDatabase>;
  private auth: AuthService;
  private audit: AuditLog;
  private now: () => Date;

  constructor(deps: { db: Kysely<SystemDatabase>; auth: AuthService; audit: AuditLog; now: () => Date }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  async create(params: { actorUserId: string; email: string }): Promise<{ id: string; token: string; expiresAt: string }> {
    const email = params.email.trim().toLowerCase();
    const existing = await this.db.selectFrom('users').select('global_role').where('email', '=', email).executeTakeFirst();
    if (existing !== undefined && existing.global_role !== 'user') throw new DomainError(409, 'Esa cuenta ya es del equipo');

    const now = this.now();
    const id = `sinv_${randomUUID()}`;
    const { raw, hash } = generateLinkToken();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    await this.db.transaction().execute(async (trx) => {
      // Una invitación nueva al mismo mail reemplaza a la pendiente
      await trx
        .updateTable('staff_invitations')
        .set({ revoked_at: now.toISOString() })
        .where('email', '=', email)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .execute();
      await trx
        .insertInto('staff_invitations')
        .values({ id, email, token_hash: hash, created_by: params.actorUserId, created_at: now.toISOString(), expires_at: expiresAt })
        .execute();
      await this.audit.record({ actorUserId: params.actorUserId, tenantId: null, action: 'staff.invited', details: { email } }, trx);
    });
    return { id, token: raw, expiresAt };
  }

  async revoke(params: { actorUserId: string; invitationId: string }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('staff_invitations')
        .set({ revoked_at: this.now().toISOString() })
        .where('id', '=', params.invitationId)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .returning('email')
        .executeTakeFirst();
      if (row === undefined) throw new DomainError(404, 'La invitación no existe o ya no está pendiente');
      await this.audit.record({ actorUserId: params.actorUserId, tenantId: null, action: 'staff.invitation_revoked', details: { email: row.email } }, trx);
    });
  }

  async listPending(): Promise<StaffInvitationItem[]> {
    const rows = await this.db
      .selectFrom('staff_invitations as i')
      .leftJoin('users as u', 'u.id', 'i.created_by')
      .select(['i.id', 'i.email', 'i.created_at', 'i.expires_at', 'u.name as invited_by_name'])
      .where('i.accepted_at', 'is', null)
      .where('i.revoked_at', 'is', null)
      .where('i.expires_at', '>', this.now().toISOString())
      .orderBy('i.created_at', 'desc')
      .execute();
    return rows.map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at, expiresAt: r.expires_at, invitedByName: r.invited_by_name ?? '' }));
  }

  async lookup(token: string): Promise<StaffInvitationInfo> {
    const inv = await this.findValid(token);
    return {
      email: inv.email,
      invitedByName: inv.invitedByName,
      accountExists: (await this.auth.findUserByEmail(inv.email)) !== undefined,
      expiresAt: inv.expiresAt,
    };
  }

  async accept(params: { token: string; password: string; name?: string | undefined }): Promise<{ token: string; user: UserSession }> {
    // Todo o nada: la cuenta (o su promoción), la invitación usada, la auditoría y la sesión
    return await this.db.transaction().execute(async (trx) => {
      const inv = await this.findValid(params.token, trx);
      const existing = await this.auth.findUserByEmail(inv.email, trx);
      let userId: string;
      let sessionToken: string;
      if (existing !== undefined) {
        if (!(await this.auth.verifyUserPassword(existing.id, params.password, trx))) throw new DomainError(401, 'Contraseña incorrecta');
        // Soporte no es miembro de comercios (#16): una cuenta de comercio no pasa al equipo
        const membership = await trx.selectFrom('memberships').select('tenant_id').where('user_id', '=', existing.id).limit(1).executeTakeFirst();
        if (membership !== undefined) throw new DomainError(409, 'Esa cuenta es de un comercio: usá otro mail');
        userId = existing.id;
        sessionToken = await this.auth.createSession(userId, trx);
      } else {
        const name = params.name?.trim() ?? '';
        if (name.length < 2) throw new DomainError(400, 'El nombre debe tener al menos 2 caracteres');
        const created = await this.auth.createUser({ email: inv.email, password: params.password, name }, trx);
        userId = created.user.id;
        sessionToken = created.token;
      }

      await trx.updateTable('users').set({ global_role: 'support' }).where('id', '=', userId).execute();
      // Si otro pedido la usó mientras tanto, esta aceptación se deshace entera
      const used = await trx
        .updateTable('staff_invitations')
        .set({ accepted_at: this.now().toISOString(), accepted_by: userId })
        .where('id', '=', inv.id)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (Number(used.numUpdatedRows) === 0) throw new DomainError(410, LINK_GONE_MESSAGE);
      await this.audit.record({ actorUserId: userId, tenantId: null, action: 'staff.joined' }, trx);
      const user = await this.auth.validateSession(sessionToken, trx);
      if (user === undefined) throw new DomainError(401, 'No se pudo iniciar la sesión');
      return { token: sessionToken, user };
    });
  }

  private async findValid(token: string, db: Kysely<SystemDatabase> = this.db): Promise<ValidInvitation> {
    const row = await db
      .selectFrom('staff_invitations as i')
      .leftJoin('users as u', 'u.id', 'i.created_by')
      .select(['i.id', 'i.email', 'i.expires_at', 'u.name as invited_by_name'])
      .where('i.token_hash', '=', hashLinkToken(token))
      .where('i.accepted_at', 'is', null)
      .where('i.revoked_at', 'is', null)
      .where('i.expires_at', '>', this.now().toISOString())
      .executeTakeFirst();
    if (row === undefined) throw new DomainError(410, LINK_GONE_MESSAGE);
    return { id: row.id, email: row.email, expiresAt: row.expires_at, invitedByName: row.invited_by_name ?? '' };
  }
}
