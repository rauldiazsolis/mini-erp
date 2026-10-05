import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
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
  | 'demo.reset';

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

/** El nombre del actor: el usuario, "Automático" si lo hizo el servidor o "Usuario borrado". */
function actorName(actorUserId: string, name: string | null): string {
  if (name !== null) return name;
  return actorUserId === SYSTEM_ACTOR ? 'Automático' : 'Usuario borrado';
}

/** Registro de auditoría (#19): quién, qué y cuándo. M7 le suma "como quién". */
export class AuditLog {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(db: DatabaseSync, now: () => Date) {
    this.db = db;
    this.now = now;
  }

  record(params: {
    actorUserId: string;
    impersonatorUserId?: string | undefined;
    tenantId: string | null;
    action: AuditAction;
    targetUserId?: string | undefined;
    details?: Record<string, unknown> | undefined;
  }): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (id, at, actor_user_id, impersonator_user_id, tenant_id, action, target_user_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        `aud_${randomUUID()}`,
        this.now().toISOString(),
        params.actorUserId,
        params.impersonatorUserId ?? null,
        params.tenantId,
        params.action,
        params.targetUserId ?? null,
        JSON.stringify(params.details ?? {}),
      );
  }

  listForTenant(tenantId: string, limit = 200): AuditEntry[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.at, a.action, a.details, a.actor_user_id, actor.name AS actor_name, target.name AS target_name,
           imp.name AS impersonator_name
         FROM audit_log a
         LEFT JOIN users actor ON actor.id = a.actor_user_id
         LEFT JOIN users imp ON imp.id = a.impersonator_user_id
         LEFT JOIN users target ON target.id = a.target_user_id
         WHERE a.tenant_id = ?
         ORDER BY a.at DESC
         LIMIT ?`,
      )
      .all(tenantId, limit) as {
      id: string;
      at: string;
      action: AuditAction;
      details: string;
      actor_user_id: string;
      actor_name: string | null;
      target_name: string | null;
      impersonator_name: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      actorName: actorName(r.actor_user_id, r.actor_name),
      impersonatorName: r.impersonator_name,
      targetName: r.target_name,
      details: parseDetails(r.details),
    }));
  }

  /** Toda la auditoría, o la de un comercio, para el registro de plataforma (#23). */
  listPlatform(p: { tenantId?: string | undefined; limit?: number | undefined } = {}): PlatformAuditItem[] {
    const tenantId = p.tenantId ?? null;
    const rows = this.db
      .prepare(
        `SELECT a.id, a.at, a.action, a.details, a.actor_user_id, a.tenant_id, t.name AS tenant_name,
           actor.name AS actor_name, target.name AS target_name, imp.name AS impersonator_name
         FROM audit_log a
         LEFT JOIN users actor ON actor.id = a.actor_user_id
         LEFT JOIN users imp ON imp.id = a.impersonator_user_id
         LEFT JOIN users target ON target.id = a.target_user_id
         LEFT JOIN tenants t ON t.id = a.tenant_id
         WHERE (? IS NULL OR a.tenant_id = ?)
         ORDER BY a.at DESC, a.rowid DESC
         LIMIT ?`,
      )
      .all(tenantId, tenantId, p.limit ?? 200) as {
      id: string;
      at: string;
      action: string;
      details: string;
      tenant_id: string | null;
      tenant_name: string | null;
      actor_user_id: string;
      actor_name: string | null;
      target_name: string | null;
      impersonator_name: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      actorName: actorName(r.actor_user_id, r.actor_name),
      impersonatorName: r.impersonator_name,
      targetName: r.target_name,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      details: parseDetails(r.details),
    }));
  }
}

function parseDetails(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
