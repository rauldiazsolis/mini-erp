import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readBillingSettings } from '../billing/settings.ts';
import { IMPERSONATION_IDLE_MS } from '../auth/auth-service.ts';
import { DomainError } from '../errors.ts';
import { isAdminPathOf } from './help-path.ts';
import type { HelpRequestItem, HelpRequestStatus, SupportAccess } from '../../shared/help-types.ts';

const HOUR_MS = 60 * 60 * 1000;
export const HELP_REQUEST_TTL_MS = 24 * HOUR_MS;
const PANEL_WINDOW_MS = 48 * HOUR_MS;
const ACCESS_WINDOW_MS = 7 * 24 * HOUR_MS;

export type OpenHelpRequest = { id: string; tenantId: string; tenantSlug: string; userId: string; path: string };

type PanelRow = {
  id: string;
  tenant_id: string;
  slug: string;
  tenant_name: string;
  user_id: string;
  user_name: string;
  path: string;
  message: string;
  created_at: string;
  expires_at: string;
  closed_at: string | null;
};

/** Si los detalles de un `impersonation.started` traen el pedido de ayuda que se atendió. */
function hasHelpRequest(details: string): boolean {
  const value: unknown = JSON.parse(details);
  return typeof value === 'object' && value !== null && 'helpRequestId' in value;
}

/** Pedidos de ayuda (#23): vencen a las 24 h, uno abierto por usuario, sin conversación ni cierre manual. */
export class HelpRequestService {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; now: () => Date }) {
    this.db = deps.db;
    this.now = deps.now;
  }

  /** Crea el pedido y cierra el abierto anterior del mismo usuario. */
  create(p: { tenantId: string; userId: string; path: string; message: string }): { id: string; expiresAt: string } {
    const tenant = this.db.prepare('SELECT slug FROM tenants WHERE id = ?').get(p.tenantId) as { slug: string } | undefined;
    if (tenant === undefined) throw new DomainError(404, 'Comercio no encontrado');
    if (!isAdminPathOf(p.path, tenant.slug)) throw new DomainError(400, 'La pantalla del pedido no es de este comercio');
    const now = this.now();
    this.db.prepare('UPDATE help_requests SET closed_at = ? WHERE user_id = ? AND closed_at IS NULL').run(now.toISOString(), p.userId);
    const id = `help_${randomUUID()}`;
    const expiresAt = new Date(now.getTime() + HELP_REQUEST_TTL_MS).toISOString();
    this.db
      .prepare('INSERT INTO help_requests (id, tenant_id, user_id, path, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, p.tenantId, p.userId, p.path, p.message, now.toISOString(), expiresAt);
    return { id, expiresAt };
  }

  /** El pedido si sigue vigente (ni cerrado ni vencido). */
  findOpen(id: string): OpenHelpRequest | undefined {
    const row = this.db
      .prepare(
        `SELECT h.id, h.tenant_id, t.slug, h.user_id, h.path FROM help_requests h JOIN tenants t ON t.id = h.tenant_id
         WHERE h.id = ? AND h.closed_at IS NULL AND h.expires_at > ?`,
      )
      .get(id, this.now().toISOString()) as { id: string; tenant_id: string; slug: string; user_id: string; path: string } | undefined;
    return row === undefined ? undefined : { id: row.id, tenantId: row.tenant_id, tenantSlug: row.slug, userId: row.user_id, path: row.path };
  }

  recordTake(requestId: string, staffUserId: string): void {
    this.db
      .prepare('INSERT INTO help_request_takes (request_id, staff_user_id, at) VALUES (?, ?, ?)')
      .run(requestId, staffUserId, this.now().toISOString());
  }

  /** La solapa Pedidos: los de las últimas 48 h, con su estado y quién los tomó. */
  listForPanel(): HelpRequestItem[] {
    const now = this.now();
    const rows = this.db
      .prepare(
        `SELECT h.id, h.tenant_id, t.slug, t.name AS tenant_name, h.user_id, u.name AS user_name, h.path, h.message,
           h.created_at, h.expires_at, h.closed_at
         FROM help_requests h JOIN tenants t ON t.id = h.tenant_id JOIN users u ON u.id = h.user_id
         WHERE h.created_at >= ?
         ORDER BY h.created_at DESC, h.rowid DESC`,
      )
      .all(new Date(now.getTime() - PANEL_WINDOW_MS).toISOString()) as PanelRow[];
    const takes = this.db.prepare(
      `SELECT k.at, COALESCE(s.name, 'Usuario borrado') AS staff_name FROM help_request_takes k
       LEFT JOIN users s ON s.id = k.staff_user_id WHERE k.request_id = ? ORDER BY k.at, k.rowid`,
    );
    return rows.map((r) => {
      const status: HelpRequestStatus = r.closed_at !== null ? 'closed' : r.expires_at <= now.toISOString() ? 'expired' : 'open';
      return {
        id: r.id,
        tenantId: r.tenant_id,
        tenantSlug: r.slug,
        tenantName: r.tenant_name,
        userId: r.user_id,
        userName: r.user_name,
        path: r.path,
        message: r.message,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        status,
        takes: (takes.all(r.id) as { at: string; staff_name: string }[]).map((k) => ({ staffName: k.staff_name, at: k.at })),
      };
    });
  }

  /** Lo que ve el usuario (#23): su pedido abierto, los accesos de soporte de 7 días y si hay alguien adentro. */
  supportAccess(userId: string): SupportAccess {
    const now = this.now();
    const open = this.db
      .prepare(
        `SELECT id, message, created_at, expires_at FROM help_requests
         WHERE user_id = ? AND closed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId, now.toISOString()) as { id: string; message: string; created_at: string; expires_at: string } | undefined;
    const accesses = this.db
      .prepare(
        `SELECT a.at, COALESCE(s.name, 'Usuario borrado') AS staff_name, a.details FROM audit_log a
         LEFT JOIN users s ON s.id = a.actor_user_id
         WHERE a.action = 'impersonation.started' AND a.target_user_id = ? AND a.at >= ?
         ORDER BY a.at DESC, a.rowid DESC`,
      )
      .all(userId, new Date(now.getTime() - ACCESS_WINDOW_MS).toISOString()) as { at: string; staff_name: string; details: string }[];
    const active = this.db
      .prepare(
        `SELECT 1 FROM sessions s JOIN sessions p ON p.token = s.parent_token
         WHERE s.user_id = ? AND s.impersonator_user_id IS NOT NULL AND s.last_used_at > ? LIMIT 1`,
      )
      .get(userId, new Date(now.getTime() - IMPERSONATION_IDLE_MS).toISOString());
    return {
      supportWhatsapp: readBillingSettings(this.db).supportWhatsapp,
      openRequest: open === undefined ? null : { id: open.id, message: open.message, createdAt: open.created_at, expiresAt: open.expires_at },
      accesses: accesses.map((a) => ({ at: a.at, staffName: a.staff_name, byRequest: hasHelpRequest(a.details) })),
      activeNow: active !== undefined,
    };
  }
}
