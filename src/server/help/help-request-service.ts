import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import type { BillingService } from '../billing/billing-service.ts';
import { IMPERSONATION_IDLE_MS } from '../auth/auth-service.ts';
import { DomainError } from '../errors.ts';
import { isAdminPathOf } from './help-path.ts';
import type { HelpRequestItem, HelpRequestStatus, SupportAccess } from '../../shared/help-types.ts';

const HOUR_MS = 60 * 60 * 1000;
export const HELP_REQUEST_TTL_MS = 24 * HOUR_MS;
const PANEL_WINDOW_MS = 48 * HOUR_MS;
const ACCESS_WINDOW_MS = 7 * 24 * HOUR_MS;

export type OpenHelpRequest = { id: string; tenantId: string; tenantSlug: string; userId: string; path: string };

/** Si los detalles de un `impersonation.started` traen el pedido de ayuda que se atendió. */
function hasHelpRequest(details: unknown): boolean {
  return typeof details === 'object' && details !== null && 'helpRequestId' in details;
}

/** Pedidos de ayuda (#23): vencen a las 24 h, uno abierto por usuario, sin conversación ni cierre manual. */
export class HelpRequestService {
  private db: Kysely<SystemDatabase>;
  private now: () => Date;
  private billing: BillingService;

  constructor(deps: { db: Kysely<SystemDatabase>; now: () => Date; billing: BillingService }) {
    this.db = deps.db;
    this.now = deps.now;
    this.billing = deps.billing;
  }

  /** Crea el pedido y cierra el abierto anterior del mismo usuario, en una transacción. */
  async create(p: { tenantId: string; userId: string; path: string; message: string }): Promise<{ id: string; expiresAt: string }> {
    const tenant = await this.db.selectFrom('tenants').select('slug').where('id', '=', p.tenantId).executeTakeFirst();
    if (tenant === undefined) throw new DomainError(404, 'Comercio no encontrado');
    if (!isAdminPathOf(p.path, tenant.slug)) throw new DomainError(400, 'La pantalla del pedido no es de este comercio');
    const now = this.now();
    const id = `help_${randomUUID()}`;
    const expiresAt = new Date(now.getTime() + HELP_REQUEST_TTL_MS).toISOString();
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('help_requests').set({ closed_at: now.toISOString() }).where('user_id', '=', p.userId).where('closed_at', 'is', null).execute();
      await trx
        .insertInto('help_requests')
        .values({ id, tenant_id: p.tenantId, user_id: p.userId, path: p.path, message: p.message, created_at: now.toISOString(), expires_at: expiresAt })
        .execute();
    });
    return { id, expiresAt };
  }

  /** El pedido si sigue vigente (ni cerrado ni vencido). */
  async findOpen(id: string): Promise<OpenHelpRequest | undefined> {
    const row = await this.db
      .selectFrom('help_requests as h')
      .innerJoin('tenants as t', 't.id', 'h.tenant_id')
      .select(['h.id', 'h.tenant_id', 't.slug', 'h.user_id', 'h.path'])
      .where('h.id', '=', id)
      .where('h.closed_at', 'is', null)
      .where('h.expires_at', '>', this.now().toISOString())
      .executeTakeFirst();
    return row === undefined ? undefined : { id: row.id, tenantId: row.tenant_id, tenantSlug: row.slug, userId: row.user_id, path: row.path };
  }

  async recordTake(requestId: string, staffUserId: string, db: Kysely<SystemDatabase> = this.db): Promise<void> {
    await db.insertInto('help_request_takes').values({ request_id: requestId, staff_user_id: staffUserId, at: this.now().toISOString() }).execute();
  }

  /** La sección Pedidos: los de las últimas 48 h, con su estado y quién los tomó. */
  async listForPanel(): Promise<HelpRequestItem[]> {
    const now = this.now();
    const rows = await this.db
      .selectFrom('help_requests as h')
      .innerJoin('tenants as t', 't.id', 'h.tenant_id')
      .innerJoin('users as u', 'u.id', 'h.user_id')
      .select(['h.id', 'h.tenant_id', 't.slug', 't.name as tenant_name', 'h.user_id', 'u.name as user_name', 'h.path', 'h.message', 'h.created_at', 'h.expires_at', 'h.closed_at'])
      .where('h.created_at', '>=', new Date(now.getTime() - PANEL_WINDOW_MS).toISOString())
      .orderBy('h.created_at', 'desc')
      .orderBy('h.seq', 'desc')
      .execute();
    const takes =
      rows.length === 0
        ? []
        : await this.db
            .selectFrom('help_request_takes as k')
            .leftJoin('users as s', 's.id', 'k.staff_user_id')
            .select((eb) => ['k.request_id', 'k.at', eb.fn.coalesce('s.name', eb.val('Usuario borrado')).as('staff_name')])
            .where(
              'k.request_id',
              'in',
              rows.map((r) => r.id),
            )
            .orderBy('k.at')
            .orderBy('k.seq')
            .execute();
    const nowIso = now.toISOString();
    return rows.map((r) => {
      const status: HelpRequestStatus = r.closed_at !== null ? 'closed' : r.expires_at <= nowIso ? 'expired' : 'open';
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
        takes: takes.filter((k) => k.request_id === r.id).map((k) => ({ staffName: k.staff_name, at: k.at })),
      };
    });
  }

  /** Lo que ve el usuario (#23): su pedido abierto, los accesos de soporte de 7 días y si hay alguien adentro. */
  async supportAccess(userId: string): Promise<SupportAccess> {
    const now = this.now();
    const open = await this.db
      .selectFrom('help_requests')
      .select(['id', 'message', 'created_at', 'expires_at'])
      .where('user_id', '=', userId)
      .where('closed_at', 'is', null)
      .where('expires_at', '>', now.toISOString())
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const accesses = await this.db
      .selectFrom('audit_log as a')
      .leftJoin('users as s', 's.id', 'a.actor_user_id')
      .select((eb) => ['a.at', eb.fn.coalesce('s.name', eb.val('Usuario borrado')).as('staff_name'), 'a.details'])
      .where('a.action', '=', 'impersonation.started')
      .where('a.target_user_id', '=', userId)
      .where('a.at', '>=', new Date(now.getTime() - ACCESS_WINDOW_MS).toISOString())
      .orderBy('a.at', 'desc')
      .orderBy('a.seq', 'desc')
      .execute();
    // Una impersonación viva: la sesión hija (`s`) con su padre (`p`) todavía en pie y usada hace poco.
    const active = await this.db
      .selectFrom('sessions as s')
      .innerJoin('sessions as p', 'p.token', 's.parent_token')
      .select('s.token')
      .where('s.user_id', '=', userId)
      .where('s.impersonator_user_id', 'is not', null)
      .where('s.last_used_at', '>', new Date(now.getTime() - IMPERSONATION_IDLE_MS).toISOString())
      .limit(1)
      .executeTakeFirst();
    return {
      supportWhatsapp: (await this.billing.paymentInfo()).supportWhatsapp,
      openRequest: open === undefined ? null : { id: open.id, message: open.message, createdAt: open.created_at, expiresAt: open.expires_at },
      accesses: accesses.map((a) => ({ at: a.at, staffName: a.staff_name, byRequest: hasHelpRequest(a.details) })),
      activeNow: active !== undefined,
    };
  }
}
