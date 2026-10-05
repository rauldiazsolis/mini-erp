import type { DatabaseSync } from 'node:sqlite';
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

const TENANT_SELECT = `
  SELECT t.id, t.slug, t.name, t.status, t.business_type, t.created_at, t.holder_user_id, h.name AS holder_name,
    (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active') AS members
  FROM tenants t LEFT JOIN users h ON h.id = t.holder_user_id
  WHERE t.id NOT IN (SELECT tenant_id FROM demo_sessions)`;

const USERS_LIMIT = 200;

function tenantStatus(value: string): TenantStatus {
  return value === 'suspended' || value === 'maintenance' ? value : 'active';
}

function accountStatus(value: string): AccountStatus {
  return value === 'disabled' ? 'disabled' : 'active';
}

/** Un texto de búsqueda en minúsculas con comodines, o vacío para no filtrar. */
function likeOf(q: string | undefined): string {
  const text = q?.trim().toLowerCase() ?? '';
  return text === '' ? '' : `%${text}%`;
}

/** Las consultas del panel de plataforma (#23): solo lectura, sobre la base de sistema. Sin demos. */
export class PlatformQueryService {
  private db: DatabaseSync;
  private billing: BillingService;
  private members: MembershipService;

  constructor(deps: { db: DatabaseSync; billing: BillingService; members: MembershipService }) {
    this.db = deps.db;
    this.billing = deps.billing;
    this.members = deps.members;
  }

  listTenants(q?: string): PlatformTenantItem[] {
    const like = likeOf(q);
    const rows = this.db
      .prepare(`${TENANT_SELECT} AND (? = '' OR lower(t.name) LIKE ? OR lower(t.slug) LIKE ?) ORDER BY t.created_at DESC, t.rowid DESC`)
      .all(like, like, like) as TenantRow[];
    return rows.map((r) => this.toItem(r));
  }

  tenantDetail(tenantId: string): PlatformTenantDetail {
    const row = this.db.prepare(`${TENANT_SELECT} AND t.id = ?`).get(tenantId) as TenantRow | undefined;
    if (row === undefined) throw new DomainError(404, 'Comercio no encontrado');
    return {
      tenant: this.toItem(row),
      suspension: currentSuspension(this.db, tenantId),
      credits: this.billing.summary(tenantId),
      gifts: this.billing.listGifts(tenantId),
      members: this.members
        .listMembers(tenantId)
        .map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, status: m.status })),
    };
  }

  /** El id del comercio con ese slug (sin demos), o 404. */
  tenantIdBySlug(slug: string): string {
    const row = this.db.prepare(`${TENANT_SELECT} AND t.slug = ?`).get(slug) as TenantRow | undefined;
    if (row === undefined) throw new DomainError(404, 'Comercio no encontrado');
    return row.id;
  }

  listUsers(q?: string): PlatformUserItem[] {
    const like = likeOf(q);
    const users = this.db
      .prepare(
        `SELECT id, name, email, whatsapp, global_role, status, created_at FROM users
         WHERE ? = '' OR lower(name) LIKE ? OR lower(email) LIKE ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(like, like, like, USERS_LIMIT) as {
      id: string;
      name: string;
      email: string;
      whatsapp: string | null;
      global_role: string;
      status: string;
      created_at: string;
    }[];
    const byUser = new Map<string, PlatformUserItem['tenants']>();
    if (users.length > 0) {
      const memberships = this.db
        .prepare(
          `SELECT m.user_id, m.role, m.status, t.id, t.slug, t.name FROM memberships m JOIN tenants t ON t.id = m.tenant_id
           WHERE m.user_id IN (${users.map(() => '?').join(', ')})
           ORDER BY m.created_at`,
        )
        .all(...users.map((u) => u.id)) as { user_id: string; role: string; status: string; id: string; slug: string; name: string }[];
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
  listStaff(): StaffMemberItem[] {
    const rows = this.db
      .prepare("SELECT id, name, email, global_role, status FROM users WHERE global_role IN ('root', 'support') ORDER BY created_at, rowid")
      .all() as { id: string; name: string; email: string; global_role: string; status: string }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      globalRole: r.global_role === 'root' ? 'root' : 'support',
      status: accountStatus(r.status),
    }));
  }

  private toItem(r: TenantRow): PlatformTenantItem {
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: tenantStatus(r.status),
      businessType: r.business_type,
      holder: r.holder_user_id === null || r.holder_name === null ? null : { id: r.holder_user_id, name: r.holder_name },
      billingState: this.billing.summary(r.id).state,
      members: r.members,
      createdAt: r.created_at,
    };
  }
}
