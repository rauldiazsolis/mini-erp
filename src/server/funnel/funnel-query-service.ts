import type { DatabaseSync } from 'node:sqlite';
import { z } from '../../shared/zod.ts';
import { shiftDay } from '../../shared/argentina-day.ts';
import {
  FUNNEL_STAGES,
  isFunnelContactSource,
  isFunnelDailyKind,
  isFunnelRubro,
  type FunnelContactInfo,
  type FunnelDailyKind,
  type FunnelReport,
  type FunnelRubro,
  type FunnelStage,
  type FunnelVisitorDetail,
  type FunnelVisitorFilter,
  type FunnelVisitorItem,
} from '../../shared/funnel-types.ts';
import { DEMO_TENANT_IDS_SQL } from '../demo/demo-tenant-ids.ts';

const MAX_ITEMS = 500;

type Stages = Record<FunnelStage, string | null>;
type TenantRow = { id: string; slug: string; name: string; created_at: string; holder_user_id: string | null; business_type: string | null };
type DemoRow = { id: string; template: string; created_at: string; revoked_at: string | null; revoke_reason: string | null; point_of_sale: string | null };
type ContactRow = {
  id: string;
  demo_session_id: string | null;
  source: string;
  name: string | null;
  whatsapp: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by_name: string | null;
  erased_at: string | null;
};
type Built = { item: FunnelVisitorItem; stages: Stages; demo: DemoRow | null; tenant: TenantRow | null; loadSource: string | null };

export type VisitorQuery = {
  from?: string | undefined;
  to?: string | undefined;
  rubro?: FunnelRubro | undefined;
  stage?: FunnelStage | undefined;
  filter?: FunnelVisitorFilter | undefined;
  q?: string | undefined;
};

const TENANT_COLS = 'id, slug, name, created_at, holder_user_id, business_type';
const DEMO_SQL = `SELECT s.id, s.template, s.created_at, s.revoked_at, s.revoke_reason, r.point_of_sale
  FROM demo_sessions s LEFT JOIN registers r ON r.id = s.register_id`;
const CONTACT_SQL = `SELECT c.id, c.demo_session_id, c.source, c.name, c.whatsapp, c.created_at, c.handled_at, c.erased_at, u.name AS handled_by_name
  FROM funnel_contacts c LEFT JOIN users u ON u.id = c.handled_by`;
const loadDataSchema = z.object({ source: z.string() });

/** Medianoche argentina de un día, en ISO (UTC−3 fijo). */
function startOf(day: string): string {
  return `${day}T03:00:00.000Z`;
}

function toRubro(value: string | null): FunnelRubro {
  return isFunnelRubro(value) ? value : 'otro';
}

function loadSourceOf(data: string | null | undefined): string | null {
  if (data === null || data === undefined) return null;
  try {
    const parsed = loadDataSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data.source : null;
  } catch {
    return null;
  }
}

function countBy<T>(items: readonly T[], pick: (item: T) => FunnelRubro): Record<FunnelRubro, number> {
  const out: Record<FunnelRubro, number> = { kiosco: 0, almacen: 0, ferreteria: 0, otro: 0 };
  for (const item of items) out[pick(item)] += 1;
  return out;
}

/**
 * El panel del embudo (#25), de sistema y de solo lectura. Un visitante es una demo, un contacto sin
 * demo o un comercio sin demo (nunca un comercio demo). Cohorte: entra por la fecha de su inicio y
 * cuenta en cada etapa a la que llegó, en cualquier fecha. Las etapas salen de los eventos y de lo que
 * ya existe (la demo, el comercio, el primer cargo y el primer pago del titular).
 */
export class FunnelQueryService {
  private db: DatabaseSync;

  constructor(deps: { db: DatabaseSync }) {
    this.db = deps.db;
  }

  report(f: { from: string; to: string; rubro?: FunnelRubro | undefined }): FunnelReport {
    const built = this.build(f.from, f.to).filter((b) => f.rubro === undefined || b.item.rubro === f.rubro);
    const stages = FUNNEL_STAGES.map((stage) => {
      const reached = built.filter((b) => b.stages[stage] !== null);
      return { stage, total: reached.length, byRubro: countBy(reached, (b) => b.item.rubro) };
    });
    const landing: Record<FunnelDailyKind, number> = { landing: 0, 'demo-click': 0, 'alta-open': 0 };
    const rows = this.db
      .prepare('SELECT kind, SUM(count) AS n FROM funnel_daily WHERE day BETWEEN ? AND ? GROUP BY kind')
      .all(f.from, f.to) as { kind: string; n: number }[];
    for (const row of rows) if (isFunnelDailyKind(row.kind)) landing[row.kind] = row.n;
    return { from: f.from, to: f.to, landing, stages };
  }

  visitors(f: VisitorQuery): FunnelVisitorItem[] {
    // "Sin atender" muestra todos los pendientes, sin rango de fechas
    const pending = f.filter === 'pending';
    const text = f.q?.trim().toLowerCase() ?? '';
    return this.build(pending ? undefined : f.from, pending ? undefined : f.to)
      .filter((b) => f.rubro === undefined || b.item.rubro === f.rubro)
      .filter((b) => f.stage === undefined || b.stages[f.stage] !== null)
      .filter((b) => {
        const c = b.item.contact;
        if (f.filter === 'contact') return c !== null;
        if (f.filter === 'pending') return c !== null && c.handledAt === null && !c.erased;
        if (f.filter === 'alta') return b.stages.commerce !== null;
        return true;
      })
      .filter(
        (b) =>
          text === '' ||
          [b.item.contact?.name, b.item.contact?.whatsapp, b.item.tenant?.name, b.item.pointOfSale].some((v) => v?.toLowerCase().includes(text) === true),
      )
      .map((b) => b.item)
      .slice(0, MAX_ITEMS);
  }

  visitor(id: string): FunnelVisitorDetail | undefined {
    const b = this.buildOne(id);
    if (b === undefined) return undefined;
    const holderId = b.tenant?.holder_user_id ?? null;
    const holder =
      holderId === null ? undefined : (this.db.prepare('SELECT name, created_at FROM users WHERE id = ?').get(holderId) as { name: string; created_at: string } | undefined);
    return {
      ...b.item,
      stages: FUNNEL_STAGES.map((stage) => ({ stage, at: b.stages[stage] })),
      demo:
        b.demo === null
          ? null
          : {
              template: b.demo.template,
              pointOfSale: b.demo.point_of_sale,
              createdAt: b.demo.created_at,
              revokedAt: b.demo.revoked_at,
              revokeReason: b.demo.revoke_reason,
            },
      holder: holder === undefined ? null : { name: holder.name, accountCreatedAt: holder.created_at },
      loadSource: b.loadSource,
    };
  }

  /** Los visitantes que empezaron en el rango (o todos), del más nuevo al más viejo. */
  private build(from: string | undefined, to: string | undefined): Built[] {
    const lo = from === undefined ? '' : startOf(from);
    const hi = to === undefined ? '9999' : startOf(shiftDay(to, 1));
    const demos = this.db.prepare(`${DEMO_SQL} WHERE s.created_at >= ? AND s.created_at < ?`).all(lo, hi) as DemoRow[];
    const contacts = this.db.prepare(`${CONTACT_SQL} WHERE c.demo_session_id IS NULL AND c.created_at >= ? AND c.created_at < ?`).all(lo, hi) as ContactRow[];
    const tenants = this.db
      .prepare(`SELECT ${TENANT_COLS} FROM tenants WHERE demo_session_id IS NULL AND id NOT IN ${DEMO_TENANT_IDS_SQL} AND created_at >= ? AND created_at < ?`)
      .all(lo, hi) as TenantRow[];
    return [
      ...demos.map((d) => this.fromDemo(d)),
      ...contacts.map((c) => this.assemble({ id: `c-${c.id}`, startedAt: c.created_at, demo: null, contact: c, tenant: null })),
      ...tenants.map((t) => this.assemble({ id: `t-${t.id}`, startedAt: t.created_at, demo: null, contact: null, tenant: t })),
    ].sort((a, b) => b.item.startedAt.localeCompare(a.item.startedAt));
  }

  private buildOne(id: string): Built | undefined {
    if (id.startsWith('c-')) {
      const c = this.db.prepare(`${CONTACT_SQL} WHERE c.id = ? AND c.demo_session_id IS NULL`).get(id.slice(2)) as ContactRow | undefined;
      return c === undefined ? undefined : this.assemble({ id, startedAt: c.created_at, demo: null, contact: c, tenant: null });
    }
    if (id.startsWith('t-')) {
      const t = this.db
        .prepare(`SELECT ${TENANT_COLS} FROM tenants WHERE id = ? AND demo_session_id IS NULL AND id NOT IN ${DEMO_TENANT_IDS_SQL}`)
        .get(id.slice(2)) as TenantRow | undefined;
      return t === undefined ? undefined : this.assemble({ id, startedAt: t.created_at, demo: null, contact: null, tenant: t });
    }
    const d = this.db.prepare(`${DEMO_SQL} WHERE s.id = ?`).get(id) as DemoRow | undefined;
    return d === undefined ? undefined : this.fromDemo(d);
  }

  private fromDemo(d: DemoRow): Built {
    const contact = this.db.prepare(`${CONTACT_SQL} WHERE c.demo_session_id = ?`).get(d.id) as ContactRow | undefined;
    const tenant = this.db.prepare(`SELECT ${TENANT_COLS} FROM tenants WHERE demo_session_id = ? ORDER BY created_at LIMIT 1`).get(d.id) as
      | TenantRow
      | undefined;
    return this.assemble({ id: d.id, startedAt: d.created_at, demo: d, contact: contact ?? null, tenant: tenant ?? null });
  }

  private event(type: string, column: 'demo_session_id' | 'tenant_id', id: string): { at: string; data: string | null } | undefined {
    return this.db.prepare(`SELECT at, data FROM funnel_events WHERE type = ? AND ${column} = ?`).get(type, id) as
      | { at: string; data: string | null }
      | undefined;
  }

  private assemble(v: { id: string; startedAt: string; demo: DemoRow | null; contact: ContactRow | null; tenant: TenantRow | null }): Built {
    const { demo, contact, tenant } = v;
    const ev = (type: string) => (demo === null ? undefined : this.event(type, 'demo_session_id', demo.id));
    const load = tenant === null ? undefined : this.event('catalog-loaded', 'tenant_id', tenant.id);
    const realSale =
      tenant === null ? undefined : (this.db.prepare('SELECT MIN(created_at) AS at FROM charges WHERE tenant_id = ?').get(tenant.id) as { at: string | null });
    const holderId = tenant?.holder_user_id ?? null;
    const payment =
      tenant === null || holderId === null
        ? undefined
        : (this.db
            .prepare("SELECT MIN(created_at) AS at FROM paid_movements WHERE user_id = ? AND kind = 'payment' AND created_at >= ?")
            .get(holderId, tenant.created_at) as { at: string | null });
    const stages: Stages = {
      demo: demo?.created_at ?? null,
      'demo-sale': ev('demo-sale')?.at ?? null,
      portal: ev('portal-opened')?.at ?? null,
      contact: contact?.created_at ?? null,
      // Un comercio implica el alta, aunque el beacon no haya llegado
      alta: ev('alta-opened')?.at ?? tenant?.created_at ?? null,
      commerce: tenant?.created_at ?? null,
      load: load?.at ?? null,
      'real-sale': realSale?.at ?? null,
      payment: payment?.at ?? null,
    };
    const furthest = [...FUNNEL_STAGES].reverse().find((s) => stages[s] !== null) ?? 'demo';
    return {
      item: {
        id: v.id,
        startedAt: v.startedAt,
        rubro: toRubro(demo?.template ?? tenant?.business_type ?? null),
        furthest,
        pointOfSale: demo?.point_of_sale ?? null,
        contact: contact === null ? null : this.contactInfo(contact),
        tenant: tenant === null ? null : { id: tenant.id, slug: tenant.slug, name: tenant.name },
      },
      stages,
      demo,
      tenant,
      loadSource: loadSourceOf(load?.data),
    };
  }

  private contactInfo(c: ContactRow): FunnelContactInfo {
    return {
      id: c.id,
      name: c.name,
      whatsapp: c.whatsapp,
      source: isFunnelContactSource(c.source) ? c.source : 'landing',
      createdAt: c.created_at,
      handledAt: c.handled_at,
      handledByName: c.handled_by_name,
      erased: c.erased_at !== null,
    };
  }
}
