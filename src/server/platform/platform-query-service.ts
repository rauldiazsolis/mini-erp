import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { searchable, searchPattern } from '../db/pg/sql-helpers.ts';
import type { LegacyDemoBridge } from '../billing/legacy-bridge.ts';
import type { BillingService } from '../billing/billing-service.ts';
import type { MembershipService } from '../users/membership-service.ts';
import { DomainError } from '../errors.ts';
import { currentSuspension } from './suspensions.ts';
import { isTenantRole } from '../../shared/permissions.ts';
import type {
  AccountStatus,
  PlatformTenantDetail,
  PlatformTenantItem,
  PlatformUserItem,
  StaffMemberItem,
  TenantStatus,
} from '../../shared/platform-types.ts';

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  business_type: string | null;
  created_at: string;
  holder_user_id: string | null;
  holder_name: string | null;
  members: number;
};

/** Un tramo de la lista de usuarios del panel. */
export const USERS_LIMIT = 100;

function tenantStatus(value: string): TenantStatus {
  return value === 'suspended' || value === 'maintenance' ? value : 'active';
}

function accountStatus(value: string): AccountStatus {
  return value === 'disabled' ? 'disabled' : 'active';
}

/**
 * Las consultas del panel de plataforma (#23): solo lectura, sobre la base de sistema. Sin demos: los
 * ids de los comercios demo salen todavía del puente a SQLite (`LegacyDemoBridge`, lo borra el dominio 7).
 */
export class PlatformQueryService {
  private db: Kysely<SystemDatabase>;
  private billing: BillingService;
  private members: MembershipService;
  private demos: LegacyDemoBridge;

  constructor(deps: { db: Kysely<SystemDatabase>; billing: BillingService; members: MembershipService; demos: LegacyDemoBridge }) {
    this.db = deps.db;
    this.billing = deps.billing;
    this.members = deps.members;
    this.demos = deps.demos;
  }

  async listTenants(q?: string): Promise<PlatformTenantItem[]> {
    const text = q?.trim() ?? '';
    let query = await this.tenantQuery();
    if (text !== '') {
      query = query.where((eb) => eb.or([eb(searchable(eb.ref('t.name')), 'like', searchPattern(text)), eb(searchable(eb.ref('t.slug')), 'like', searchPattern(text))]));
    }
    const rows = await query.orderBy('t.created_at', 'desc').orderBy('t.seq', 'desc').execute();
    const items: PlatformTenantItem[] = [];
    for (const r of rows) items.push(await this.toItem(r));
    return items;
  }

  async tenantDetail(tenantId: string): Promise<PlatformTenantDetail> {
    const row = await (await this.tenantQuery()).where('t.id', '=', tenantId).executeTakeFirst();
    if (row === undefined) throw new DomainError(404, 'Comercio no encontrado');
    return {
      tenant: await this.toItem(row),
      suspension: await currentSuspension(this.db, tenantId),
      credits: await this.billing.summary(tenantId),
      gifts: await this.billing.listGifts(tenantId),
      members: (await this.members.listMembers(tenantId)).map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status })),
    };
  }

  /** El id del comercio con ese slug (sin demos), o 404. */
  async tenantIdBySlug(slug: string): Promise<string> {
    const row = await (await this.tenantQuery()).where('t.slug', '=', slug).executeTakeFirst();
    if (row === undefined) throw new DomainError(404, 'Comercio no encontrado');
    return row.id;
  }

  /** De a `USERS_LIMIT`, desde `offset` (#87): el panel los suma al scrollear. */
  async listUsers(q?: string, offset = 0): Promise<PlatformUserItem[]> {
    const text = q?.trim() ?? '';
    let query = this.db.selectFrom('users').select(['id', 'name', 'email', 'whatsapp', 'global_role', 'status', 'created_at']);
    if (text !== '') {
      query = query.where((eb) => eb.or([eb(searchable(eb.ref('name')), 'like', searchPattern(text)), eb(searchable(eb.ref('email')), 'like', searchPattern(text))]));
    }
    const users = await query.orderBy('created_at', 'desc').orderBy('seq', 'desc').limit(USERS_LIMIT).offset(offset).execute();
    const byUser = new Map<string, PlatformUserItem['tenants']>();
    if (users.length > 0) {
      const memberships = await this.db
        .selectFrom('memberships as m')
        .innerJoin('tenants as t', 't.id', 'm.tenant_id')
        .select(['m.user_id', 'm.role', 'm.status', 't.id', 't.slug', 't.name'])
        .where(
          'm.user_id',
          'in',
          users.map((u) => u.id),
        )
        .orderBy('m.created_at')
        .orderBy('m.seq')
        .execute();
      for (const m of memberships) {
        if (!isTenantRole(m.role)) continue;
        const list = byUser.get(m.user_id) ?? [];
        list.push({ id: m.id, slug: m.slug, name: m.name, role: m.role, status: accountStatus(m.status) });
        byUser.set(m.user_id, list);
      }
    }
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      whatsapp: u.whatsapp,
      globalRole: u.global_role === 'root' || u.global_role === 'support' ? u.global_role : 'user',
      status: accountStatus(u.status),
      createdAt: u.created_at,
      tenants: byUser.get(u.id) ?? [],
    }));
  }

  /** Root y el equipo de soporte, en orden de alta. */
  async listStaff(): Promise<StaffMemberItem[]> {
    const rows = await this.db
      .selectFrom('users')
      .select(['id', 'name', 'email', 'global_role', 'status'])
      .where('global_role', 'in', ['root', 'support'])
      .orderBy('created_at')
      .orderBy('seq')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      globalRole: r.global_role === 'root' ? 'root' : 'support',
      status: accountStatus(r.status),
    }));
  }

  /** Los comercios con su titular y sus miembros activos, sin los demo. */
  private async tenantQuery() {
    const demoIds = await this.demos.demoTenantIds();
    let query = this.db
      .selectFrom('tenants as t')
      .leftJoin('users as h', 'h.id', 't.holder_user_id')
      .select((eb) => [
        't.id',
        't.slug',
        't.name',
        't.status',
        't.business_type',
        't.created_at',
        't.holder_user_id',
        'h.name as holder_name',
        eb
          .selectFrom('memberships as m')
          .select((sub) => sub.fn.countAll<number>().as('n'))
          .whereRef('m.tenant_id', '=', 't.id')
          .where('m.status', '=', 'active')
          .as('members'),
      ]);
    if (demoIds.length > 0) query = query.where('t.id', 'not in', demoIds);
    return query;
  }

  private async toItem(r: Omit<TenantRow, 'members'> & { members: number | null }): Promise<PlatformTenantItem> {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: tenantStatus(r.status),
      businessType: r.business_type,
      holder: r.holder_user_id === null || r.holder_name === null ? null : { id: r.holder_user_id, name: r.holder_name },
      billingState: (await this.billing.summary(r.id)).state,
      members: r.members ?? 0,
      createdAt: r.created_at,
    };
  }
}
