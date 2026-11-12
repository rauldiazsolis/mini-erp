import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { jsonValue } from '../db/pg/sql-helpers.ts';
import type { PlatformAuditItem } from '../../shared/platform-types.ts';

export type AuditAction =
  | 'tenant.created'
  | 'invitation.created'
  | 'invitation.revoked'
  | 'invitation.accepted'
  | 'member.role_changed'
  | 'member.disabled'
  | 'member.enabled'
  | 'password.reset_link_created'
  | 'password.reset'
  | 'password.changed'
  | 'register.created'
  | 'register.key_rotated'
  | 'register.transferred'
  | 'register.unbound'
  | 'register.deactivated'
  | 'billing.payment_registered'
  | 'billing.credits_granted'
  | 'billing.credit_voided'
  | 'billing.grace_extended'
  | 'billing.refund'
  | 'billing.holder_changed'
  | 'billing.settings_updated'
  | 'tenant.suspended'
  | 'tenant.reactivated'
  | 'user.disabled'
  | 'user.enabled'
  | 'staff.invited'
  | 'staff.invitation_revoked'
  | 'staff.joined'
  | 'impersonation.started'
  | 'impersonation.ended'
  | 'demo.reset'
  | 'portal.opened'
  | 'funnel.contact-handled';

export type AuditEntry = {
  id: string;
  at: string;
  action: AuditAction;
  actorName: string;
  /** Quién impersonaba al actor (#23), o `null`. */
  impersonatorName: string | null;
  targetName: string | null;
  details: Record<string, unknown>;
};

/** El actor de lo que hace el servidor solo, como el reinicio automático de las demos (#24). */
export const SYSTEM_ACTOR = 'system';

/** La caja que abrió mini desde el POS (M10): el actor de `portal.opened`. */
export const REGISTER_ACTOR = 'register';

/** El nombre del actor: el usuario, la caja, "Automático" si lo hizo el servidor o "Usuario borrado". */
function actorName(actorUserId: string, name: string | null, registerName: string | null): string {
  if (actorUserId === REGISTER_ACTOR) return `${registerName ?? 'Caja borrada'} (desde el POS)`;
  if (name !== null) return name;
  return actorUserId === SYSTEM_ACTOR ? 'Automático' : 'Usuario borrado';
}

export type AuditRecord = {
  actorUserId: string;
  impersonatorUserId?: string | undefined;
  /** La caja, si el actor es `REGISTER_ACTOR` (M10). */
  actorRegisterId?: string | undefined;
  tenantId: string | null;
  action: AuditAction;
  targetUserId?: string | undefined;
  details?: Record<string, unknown> | undefined;
};

/**
 * Registro de auditoría (#19): quién, qué y cuándo. M7 le suma "como quién".
 *
 * `record` acepta el `trx` de quien lo llama (`audit.record(entrada, trx)`): así lo auditado queda en
 * la misma transacción que el cambio y se deshace con él. Sin `trx`, escribe con su propio Kysely.
 */
export class AuditLog {
  private db: Kysely<SystemDatabase>;
  private now: () => Date;

  constructor(db: Kysely<SystemDatabase>, now: () => Date) {
    this.db = db;
    this.now = now;
  }

  async record(params: AuditRecord, db: Kysely<SystemDatabase> = this.db): Promise<void> {
    await db
      .insertInto('audit_log')
      .values({
        id: `aud_${randomUUID()}`,
        at: this.now().toISOString(),
        actor_user_id: params.actorUserId,
        impersonator_user_id: params.impersonatorUserId ?? null,
        actor_register_id: params.actorRegisterId ?? null,
        tenant_id: params.tenantId,
        action: params.action,
        target_user_id: params.targetUserId ?? null,
        details: jsonValue(params.details ?? {}),
      })
      .execute();
  }

  /** La auditoría con los nombres de quién, como quién y a quién (los borrados quedan en `null`). */
  private listQuery() {
    return this.db
      .selectFrom('audit_log as a')
      .leftJoin('users as actor', 'actor.id', 'a.actor_user_id')
      .leftJoin('users as imp', 'imp.id', 'a.impersonator_user_id')
      .leftJoin('users as target', 'target.id', 'a.target_user_id')
      .leftJoin('registers as reg', 'reg.id', 'a.actor_register_id')
      .select([
        'a.id',
        'a.at',
        'a.action',
        'a.details',
        'a.actor_user_id',
        'a.tenant_id',
        'actor.name as actor_name',
        'target.name as target_name',
        'imp.name as impersonator_name',
        'reg.name as register_name',
      ])
      .orderBy('a.at', 'desc')
      .orderBy('a.seq', 'desc');
  }

  async listForTenant(tenantId: string, limit = 200): Promise<AuditEntry[]> {
    const rows = await this.listQuery().where('a.tenant_id', '=', tenantId).limit(limit).execute();
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action as AuditAction,
      actorName: actorName(r.actor_user_id, r.actor_name, r.register_name),
      impersonatorName: r.impersonator_name,
      targetName: r.target_name,
      details: parseDetails(r.details),
    }));
  }

  /** Toda la auditoría, o la de un comercio, para el registro de plataforma (#23). */
  async listPlatform(p: { tenantId?: string | undefined; limit?: number | undefined } = {}): Promise<PlatformAuditItem[]> {
    const tenantId = p.tenantId;
    let query = this.listQuery().leftJoin('tenants as t', 't.id', 'a.tenant_id').select('t.name as tenant_name');
    if (tenantId !== undefined) {
      query = query.where('a.tenant_id', '=', tenantId);
    }
    const rows = await query.limit(p.limit ?? 200).execute();
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      actorName: actorName(r.actor_user_id, r.actor_name, r.register_name),
      impersonatorName: r.impersonator_name,
      targetName: r.target_name,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      details: parseDetails(r.details),
    }));
  }
}

/** `details` es un objeto jsonb; cualquier otra cosa se lee como vacío. */
function parseDetails(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
