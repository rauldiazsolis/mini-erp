import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
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

  async create(params: {
    tenantId: string;
    actor: { userId: string; role: TenantRole; impersonatorUserId?: string | undefined };
    email: string;
    role: TenantRole;
  }): Promise<{ id: string; token: string; expiresAt: string }> {
    if (!assignableRoles(params.actor.role).includes(params.role)) {
      throw new DomainError(403, 'No podés invitar con ese rol');
    }
    const email = params.email.trim().toLowerCase();
    const existing = await this.auth.findUserByEmail(email);
    if (existing !== undefined && (await this.members.getMembership(params.tenantId, existing.id)) !== undefined) {
      throw new DomainError(409, 'Ese correo ya es parte del comercio');
    }

    const now = this.now();
    const id = `inv_${randomUUID()}`;
    const { raw, hash } = generateLinkToken();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    await this.db.transaction().execute(async (trx) => {
      // Una invitación nueva al mismo mail reemplaza a la pendiente
      await trx
        .updateTable('invitations')
        .set({ revoked_at: now.toISOString() })
        .where('tenant_id', '=', params.tenantId)
        .where('email', '=', email)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .execute();
      await trx
        .insertInto('invitations')
        .values({
          id,
          tenant_id: params.tenantId,
          email,
          role: params.role,
          token_hash: hash,
          created_by: params.actor.userId,
          created_at: now.toISOString(),
          expires_at: expiresAt,
        })
        .execute();
      await this.audit.record(
        {
          actorUserId: params.actor.userId,
          impersonatorUserId: params.actor.impersonatorUserId,
          tenantId: params.tenantId,
          action: 'invitation.created',
          details: { email, role: params.role },
        },
        trx,
      );
    });
    return { id, token: raw, expiresAt };
  }

  async revoke(params: {
    tenantId: string;
    actor: { userId: string; role: TenantRole; impersonatorUserId?: string | undefined };
    invitationId: string;
  }): Promise<void> {
    const row = await this.db
      .selectFrom('invitations')
      .select(['email', 'role'])
      .where('id', '=', params.invitationId)
      .where('tenant_id', '=', params.tenantId)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (row === undefined) throw new DomainError(404, 'La invitación no existe o ya no está pendiente');
    if (!isTenantRole(row.role) || !assignableRoles(params.actor.role).includes(row.role)) {
      throw new DomainError(403, 'No podés revocar esta invitación');
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('invitations').set({ revoked_at: this.now().toISOString() }).where('id', '=', params.invitationId).execute();
      await this.audit.record(
        {
          actorUserId: params.actor.userId,
          impersonatorUserId: params.actor.impersonatorUserId,
          tenantId: params.tenantId,
          action: 'invitation.revoked',
          details: { email: row.email, role: row.role },
        },
        trx,
      );
    });
  }

  async listPending(tenantId: string): Promise<PendingInvitation[]> {
    const rows = await this.db
      .selectFrom('invitations as i')
      .leftJoin('users as u', 'u.id', 'i.created_by')
      .select(['i.id', 'i.email', 'i.role', 'i.created_at', 'i.expires_at', 'u.name as invited_by_name'])
      .where('i.tenant_id', '=', tenantId)
      .where('i.accepted_at', 'is', null)
      .where('i.revoked_at', 'is', null)
      .where('i.expires_at', '>', this.now().toISOString())
      .orderBy('i.created_at', 'desc')
      .execute();
    return rows.flatMap((r) =>
      isTenantRole(r.role)
        ? [{ id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at, invitedByName: r.invited_by_name ?? '' }]
        : [],
    );
  }

  async lookup(token: string): Promise<InvitationInfo> {
    const inv = await this.findValid(token);
    return {
      tenantName: inv.tenantName,
      role: inv.role,
      email: inv.email,
      invitedByName: inv.invitedByName,
      accountExists: (await this.auth.findUserByEmail(inv.email)) !== undefined,
      expiresAt: inv.expiresAt,
    };
  }

  async accept(params: { token: string; password: string; name?: string | undefined }): Promise<{
    token: string;
    user: UserSession;
    tenantId: string;
  }> {
    // Todo o nada: la cuenta, su sesión, la membresía, la invitación usada y la auditoría
    return await this.db.transaction().execute(async (trx) => {
      const inv = await this.findValid(params.token, trx);
      const existing = await this.auth.findUserByEmail(inv.email, trx);
      let user: UserSession;
      let sessionToken: string;
      if (existing !== undefined) {
        if (!(await this.auth.verifyUserPassword(existing.id, params.password, trx))) throw new DomainError(401, 'Contraseña incorrecta');
        if ((await this.members.getMembership(inv.tenantId, existing.id, trx)) !== undefined) {
          throw new DomainError(409, 'Ya sos parte de este comercio');
        }
        sessionToken = await this.auth.createSession(existing.id, trx);
        const session = await this.auth.validateSession(sessionToken, trx);
        if (session === undefined) throw new DomainError(401, 'No se pudo iniciar la sesión');
        user = session;
      } else {
        const name = params.name?.trim() ?? '';
        if (name.length < 2) throw new DomainError(400, 'El nombre debe tener al menos 2 caracteres');
        const created = await this.auth.createUser({ email: inv.email, password: params.password, name }, trx);
        user = created.user;
        sessionToken = created.token;
      }

      await this.members.addMembership(inv.tenantId, user.id, inv.role, trx);
      // Si otro pedido la usó mientras tanto, esta aceptación se deshace entera
      const used = await trx
        .updateTable('invitations')
        .set({ accepted_at: this.now().toISOString(), accepted_by: user.id })
        .where('id', '=', inv.id)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (Number(used.numUpdatedRows) === 0) throw new DomainError(410, LINK_GONE_MESSAGE);
      await this.audit.record({ actorUserId: user.id, tenantId: inv.tenantId, action: 'invitation.accepted', details: { role: inv.role } }, trx);
      return { token: sessionToken, user, tenantId: inv.tenantId };
    });
  }

  private async findValid(token: string, db: Kysely<SystemDatabase> = this.db): Promise<ValidInvitation> {
    const row = await db
      .selectFrom('invitations as i')
      .innerJoin('tenants as t', 't.id', 'i.tenant_id')
      .leftJoin('users as u', 'u.id', 'i.created_by')
      .select(['i.id', 'i.tenant_id', 'i.email', 'i.role', 'i.expires_at', 't.name as tenant_name', 'u.name as invited_by_name'])
      .where('i.token_hash', '=', hashLinkToken(token))
      .where('i.accepted_at', 'is', null)
      .where('i.revoked_at', 'is', null)
      .where('i.expires_at', '>', this.now().toISOString())
      .executeTakeFirst();
    if (row === undefined || !isTenantRole(row.role)) throw new DomainError(410, LINK_GONE_MESSAGE);
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at,
      tenantName: row.tenant_name,
      invitedByName: row.invited_by_name ?? '',
    };
  }
}
