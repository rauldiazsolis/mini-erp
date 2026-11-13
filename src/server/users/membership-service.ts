import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import type { UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { assignableRoles, can, isTenantRole, type TenantRole } from '../../shared/permissions.ts';
import { DomainError } from '../errors.ts';

export type MemberStatus = 'active' | 'disabled';

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: TenantRole;
  status: MemberStatus;
  joinedAt: string;
};

function toStatus(value: string): MemberStatus {
  return value === 'disabled' ? 'disabled' : 'active';
}

/** Membresías de los comercios (#19): rol activo, miembros y la regla de "todo suyo". */
export class MembershipService {
  private db: Kysely<SystemDatabase>;
  private audit: AuditLog | undefined;

  constructor(db: Kysely<SystemDatabase>, audit?: AuditLog) {
    this.db = db;
    this.audit = audit;
  }

  /** El rol con el que el usuario opera el comercio: su membresía activa. Root y soporte no son miembros (#16). */
  async resolveRole(user: UserSession, tenantId: string): Promise<TenantRole | undefined> {
    const membership = await this.getMembership(tenantId, user.id);
    return membership?.status === 'active' ? membership.role : undefined;
  }

  async getMembership(
    tenantId: string,
    userId: string,
    db: Kysely<SystemDatabase> = this.db,
  ): Promise<{ role: TenantRole; status: MemberStatus } | undefined> {
    const row = await db
      .selectFrom('memberships')
      .select(['role', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (row === undefined || !isTenantRole(row.role)) return undefined;
    return { role: row.role, status: toStatus(row.status) };
  }

  async addMembership(tenantId: string, userId: string, role: TenantRole, db: Kysely<SystemDatabase> = this.db): Promise<void> {
    await db
      .insertInto('memberships')
      .values({ user_id: userId, tenant_id: tenantId, role, status: 'active', created_at: new Date().toISOString() })
      .execute();
  }

  async listMembers(tenantId: string, db: Kysely<SystemDatabase> = this.db): Promise<MemberRow[]> {
    const rows = await db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.name', 'u.email', 'm.role', 'm.status', 'm.created_at'])
      .where('m.tenant_id', '=', tenantId)
      .orderBy('m.created_at', 'asc')
      .orderBy('m.seq', 'asc')
      .execute();
    return rows.flatMap((r) =>
      isTenantRole(r.role)
        ? [{ userId: r.id, name: r.name, email: r.email, role: r.role, status: toStatus(r.status), joinedAt: r.created_at }]
        : [],
    );
  }

  async countActiveOwners(tenantId: string, db: Kysely<SystemDatabase> = this.db): Promise<number> {
    const row = await db
      .selectFrom('memberships')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('tenant_id', '=', tenantId)
      .where('role', '=', 'owner')
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    return row.n;
  }

  /** Todas las membresías activas del usuario están en comercios donde el actor es owner activo. */
  async isFullyOwnedBy(targetUserId: string, actorUserId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('memberships as t')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('t.user_id', '=', targetUserId)
      .where('t.status', '=', 'active')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('memberships as a')
              .select('a.user_id')
              .whereRef('a.tenant_id', '=', 't.tenant_id')
              .where('a.user_id', '=', actorUserId)
              .where('a.role', '=', 'owner')
              .where('a.status', '=', 'active'),
          ),
        ),
      )
      .executeTakeFirstOrThrow();
    return row.n === 0;
  }

  /**
   * Cambia el rol o el estado de un miembro (#19). Nadie cambia su propia membresía, solo un owner
   * toca owners, el rol nuevo tiene que estar entre los que el actor puede asignar y el comercio
   * nunca se queda sin un owner activo.
   */
  async updateMember(params: {
    tenantId: string;
    actor: { userId: string; role: TenantRole; impersonatorUserId?: string | undefined };
    targetUserId: string;
    role?: TenantRole | undefined;
    status?: MemberStatus | undefined;
  }): Promise<MemberRow> {
    const { tenantId, actor, targetUserId } = params;
    if (targetUserId === actor.userId) throw new DomainError(403, 'No podés cambiar tu propia membresía');
    return await this.db.transaction().execute(async (trx) => {
      const current = await this.getMembership(tenantId, targetUserId, trx);
      if (current === undefined) throw new DomainError(404, 'El usuario no es miembro de este comercio');

      const touchesOwner = current.role === 'owner' || params.role === 'owner';
      if (touchesOwner && !can(actor.role, 'owners.manage')) {
        throw new DomainError(403, 'Solo un owner puede cambiar a otro owner');
      }
      if (params.role !== undefined && !assignableRoles(actor.role).includes(params.role)) {
        throw new DomainError(403, 'No podés asignar ese rol');
      }
      const losesOwner =
        current.role === 'owner' &&
        current.status === 'active' &&
        ((params.role !== undefined && params.role !== 'owner') || params.status === 'disabled');
      if (losesOwner && (await this.countActiveOwners(tenantId, trx)) <= 1) {
        throw new DomainError(409, 'El comercio necesita al menos un owner activo');
      }

      const membership = trx.updateTable('memberships').where('tenant_id', '=', tenantId).where('user_id', '=', targetUserId);
      if (params.role !== undefined && params.role !== current.role) {
        await membership.set({ role: params.role }).execute();
        await this.audit?.record(
          {
            actorUserId: actor.userId,
            impersonatorUserId: actor.impersonatorUserId,
            tenantId,
            action: 'member.role_changed',
            targetUserId,
            details: { from: current.role, to: params.role },
          },
          trx,
        );
      }
      if (params.status !== undefined && params.status !== current.status) {
        await membership.set({ status: params.status }).execute();
        await this.audit?.record(
          {
            actorUserId: actor.userId,
            impersonatorUserId: actor.impersonatorUserId,
            tenantId,
            action: params.status === 'disabled' ? 'member.disabled' : 'member.enabled',
            targetUserId,
          },
          trx,
        );
      }
      const updated = (await this.listMembers(tenantId, trx)).find((m) => m.userId === targetUserId);
      if (updated === undefined) throw new DomainError(404, 'El usuario no es miembro de este comercio');
      return updated;
    });
  }
}
