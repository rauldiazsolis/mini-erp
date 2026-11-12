import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import type { AuthService, Impersonator, UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { HelpRequestService } from '../help/help-request-service.ts';
import type { LegacyDemoBridge } from '../billing/legacy-bridge.ts';
import { DomainError } from '../errors.ts';

export type ImpersonationStart = { token: string; user: UserSession; impersonator: Impersonator; tenantSlug: string; path: string };

type TargetTenant = { id: string; slug: string };

/**
 * Impersonación de usuario (#23, M7b): root o soporte, con su sesión propia, entran como una cuenta
 * `user` activa con al menos una membresía activa. Nunca como root, soporte, desactivados ni demos.
 */
export class ImpersonationService {
  private db: Kysely<SystemDatabase>;
  private auth: AuthService;
  private audit: AuditLog;
  private help: HelpRequestService;
  private demos: LegacyDemoBridge;

  constructor(deps: { db: Kysely<SystemDatabase>; auth: AuthService; audit: AuditLog; help: HelpRequestService; demos: LegacyDemoBridge }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.audit = deps.audit;
    this.help = deps.help;
    this.demos = deps.demos;
  }

  async start(p: { staff: UserSession; parentToken: string; userId: string; tenantSlug?: string | undefined }): Promise<ImpersonationStart> {
    const { user, tenant } = await this.target(p.userId, p.tenantSlug);
    return await this.db
      .transaction()
      .execute(
        async (trx) =>
          await this.open({ staff: p.staff, parentToken: p.parentToken, user, tenant, path: `/admin/${tenant.slug}/dashboard`, helpRequestId: null }, trx),
      );
  }

  /** Toma un pedido de ayuda vigente: entra como quien lo pidió, en esa pantalla, y registra la toma. */
  async take(p: { staff: UserSession; parentToken: string; helpRequestId: string }): Promise<ImpersonationStart> {
    const request = await this.help.findOpen(p.helpRequestId);
    if (request === undefined) throw new DomainError(410, 'Este pedido venció');
    const { user, tenant } = await this.target(request.userId, request.tenantSlug);
    return await this.db.transaction().execute(async (trx) => {
      const started = await this.open({ staff: p.staff, parentToken: p.parentToken, user, tenant, path: request.path, helpRequestId: request.id }, trx);
      await this.help.recordTake(request.id, p.staff.id, trx);
      return started;
    });
  }

  /** "Salir": termina la impersonación del token. */
  async end(token: string): Promise<void> {
    if (!(await this.auth.endImpersonation(token, 'exit'))) throw new DomainError(400, 'No estás viendo como otro usuario');
  }

  /** La cuenta y el comercio de entrada: el pedido o, si no, la membresía activa más reciente. */
  private async target(userId: string, tenantSlug: string | undefined): Promise<{ user: UserSession; tenant: TargetTenant }> {
    const row = await this.db.selectFrom('users').select(['id', 'email', 'name', 'global_role', 'status']).where('id', '=', userId).executeTakeFirst();
    if (row === undefined) throw new DomainError(404, 'Usuario no encontrado');
    if (row.global_role !== 'user') throw new DomainError(403, 'No se puede entrar como root o soporte');
    if (row.status !== 'active') throw new DomainError(409, 'La cuenta está desactivada');
    const demoIds = await this.demos.demoTenantIds();
    let query = this.db
      .selectFrom('memberships as m')
      .innerJoin('tenants as t', 't.id', 'm.tenant_id')
      .select(['t.id', 't.slug'])
      .where('m.user_id', '=', userId)
      .where('m.status', '=', 'active');
    if (demoIds.length > 0) query = query.where('t.id', 'not in', demoIds);
    const tenants: TargetTenant[] = await query.orderBy('m.created_at', 'desc').orderBy('m.seq', 'desc').execute();
    if (tenants.length === 0) throw new DomainError(409, 'El usuario no tiene comercios activos');
    const tenant = tenantSlug === undefined ? tenants[0] : tenants.find((t) => t.slug === tenantSlug);
    if (tenant === undefined) throw new DomainError(409, 'El usuario no es miembro activo de ese comercio');
    return { user: { id: row.id, email: row.email, name: row.name, globalRole: 'user' }, tenant };
  }

  private async open(
    p: {
      staff: UserSession;
      parentToken: string;
      user: UserSession;
      tenant: TargetTenant;
      path: string;
      helpRequestId: string | null;
    },
    db: Kysely<SystemDatabase>,
  ): Promise<ImpersonationStart> {
    const role = p.staff.globalRole;
    if (role !== 'root' && role !== 'support') throw new DomainError(403, 'Solo para la plataforma');
    const token = await this.auth.createImpersonationSession(
      {
        parentToken: p.parentToken,
        impersonatorId: p.staff.id,
        userId: p.user.id,
        tenantId: p.tenant.id,
        helpRequestId: p.helpRequestId,
      },
      db,
    );
    await this.audit.record(
      {
        actorUserId: p.staff.id,
        tenantId: p.tenant.id,
        action: 'impersonation.started',
        targetUserId: p.user.id,
        details: p.helpRequestId === null ? {} : { helpRequestId: p.helpRequestId },
      },
      db,
    );
    return {
      token,
      user: p.user,
      impersonator: { id: p.staff.id, name: p.staff.name, globalRole: role },
      tenantSlug: p.tenant.slug,
      path: p.path,
    };
  }
}
