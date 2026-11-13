import { sql, type Kysely, type RawBuilder } from 'kysely';
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
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { demoTenantIds } from '../demo/demo-tenant-ids.ts';

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
type Visitor = { id: string; startedAt: string; demo: DemoRow | null; contact: ContactRow | null; tenant: TenantRow | null };
type EventRow = { type: string; demo_session_id: string | null; tenant_id: string | null; at: string; data: unknown };
type Related = {
  /** Por `eventKey`: a lo sumo uno por tipo y por demo o comercio (índices únicos). */
  events: Map<string, EventRow>;
  realSale: Map<string, string>;
  payment: Map<string, string>;
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

const loadDataSchema = z.object({ source: z.string() });

/** Medianoche argentina de un día, en ISO (UTC−3 fijo). */
function startOf(day: string): string {
  return `${day}T03:00:00.000Z`;
}

/** `= any($1)`: una lista de ids en un solo parámetro (un `IN` con miles de demos no entra). */
function anyOf(ids: readonly string[]): RawBuilder<string> {
  return sql<string>`any(${ids}::text[])`;
}

function eventKey(type: string, owner: 'demo' | 'tenant', id: string): string {
  return `${type}|${owner}|${id}`;
}

function toRubro(value: string | null): FunnelRubro {
  return isFunnelRubro(value) ? value : 'otro';
}

function loadSourceOf(data: unknown): string | null {
  const parsed = loadDataSchema.safeParse(data);
  return parsed.success ? parsed.data.source : null;
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
  private db: Kysely<SystemDatabase>;

  constructor(deps: { db: Kysely<SystemDatabase> }) {
    this.db = deps.db;
  }

  async report(f: { from: string; to: string; rubro?: FunnelRubro | undefined }): Promise<FunnelReport> {
    const built = (await this.build(f.from, f.to)).filter((b) => f.rubro === undefined || b.item.rubro === f.rubro);
    const stages = FUNNEL_STAGES.map((stage) => {
      const reached = built.filter((b) => b.stages[stage] !== null);
      return { stage, total: reached.length, byRubro: countBy(reached, (b) => b.item.rubro) };
    });
    const landing: Record<FunnelDailyKind, number> = { landing: 0, 'demo-click': 0, 'alta-open': 0 };
    const rows = await this.db
      .selectFrom('funnel_daily')
      .select((eb) => ['kind', eb.fn.sum<number>('count').as('n')])
      .where('day', '>=', f.from)
      .where('day', '<=', f.to)
      .groupBy('kind')
      .execute();
    for (const row of rows) if (isFunnelDailyKind(row.kind)) landing[row.kind] = row.n;
    return { from: f.from, to: f.to, landing, visitors: { total: built.length, byRubro: countBy(built, (b) => b.item.rubro) }, stages };
  }

  async visitors(f: VisitorQuery): Promise<FunnelVisitorItem[]> {
    // "Sin atender" muestra todos los pendientes, sin rango de fechas
    const pending = f.filter === 'pending';
    const text = f.q?.trim().toLowerCase() ?? '';
    return (await this.build(pending ? undefined : f.from, pending ? undefined : f.to))
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

  async visitor(id: string): Promise<FunnelVisitorDetail | undefined> {
    const b = await this.buildOne(id);
    if (b === undefined) return undefined;
    const holderId = b.tenant?.holder_user_id ?? null;
    const holder =
      holderId === null ? undefined : await this.db.selectFrom('users').select(['name', 'created_at']).where('id', '=', holderId).executeTakeFirst();
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

  private demoQuery() {
    return this.db
      .selectFrom('demo_sessions as s')
      .leftJoin('registers as r', 'r.id', 's.register_id')
      .select(['s.id', 's.template', 's.created_at', 's.revoked_at', 's.revoke_reason', 'r.point_of_sale']);
  }

  private contactQuery() {
    return this.db
      .selectFrom('funnel_contacts as c')
      .leftJoin('users as u', 'u.id', 'c.handled_by')
      .select(['c.id', 'c.demo_session_id', 'c.source', 'c.name', 'c.whatsapp', 'c.created_at', 'c.handled_at', 'c.erased_at', 'u.name as handled_by_name']);
  }

  private tenantQuery() {
    return this.db.selectFrom('tenants as t').select(['t.id', 't.slug', 't.name', 't.created_at', 't.holder_user_id', 't.business_type']);
  }

  /** Los visitantes que empezaron en el rango (o todos), del más nuevo al más viejo. */
  private async build(from: string | undefined, to: string | undefined): Promise<Built[]> {
    const lo = from === undefined ? undefined : startOf(from);
    const hi = to === undefined ? undefined : startOf(shiftDay(to, 1));
    let demos = this.demoQuery();
    let contacts = this.contactQuery().where('c.demo_session_id', 'is', null);
    let tenants = this.tenantQuery().where('t.demo_session_id', 'is', null).where('t.id', 'not in', demoTenantIds(this.db));
    if (lo !== undefined) {
      demos = demos.where('s.created_at', '>=', lo);
      contacts = contacts.where('c.created_at', '>=', lo);
      tenants = tenants.where('t.created_at', '>=', lo);
    }
    if (hi !== undefined) {
      demos = demos.where('s.created_at', '<', hi);
      contacts = contacts.where('c.created_at', '<', hi);
      tenants = tenants.where('t.created_at', '<', hi);
    }
    const visitors: Visitor[] = [
      ...(await demos.execute()).map((d) => ({ id: d.id, startedAt: d.created_at, demo: d, contact: null, tenant: null })),
      ...(await contacts.execute()).map((c) => ({ id: `c-${c.id}`, startedAt: c.created_at, demo: null, contact: c, tenant: null })),
      ...(await tenants.execute()).map((t) => ({ id: `t-${t.id}`, startedAt: t.created_at, demo: null, contact: null, tenant: t })),
    ];
    return (await this.assembleAll(visitors)).sort((a, b) => b.item.startedAt.localeCompare(a.item.startedAt));
  }

  private async buildOne(id: string): Promise<Built | undefined> {
    let visitor: Visitor | undefined;
    if (id.startsWith('c-')) {
      const c = await this.contactQuery().where('c.id', '=', id.slice(2)).where('c.demo_session_id', 'is', null).executeTakeFirst();
      visitor = c === undefined ? undefined : { id, startedAt: c.created_at, demo: null, contact: c, tenant: null };
    } else if (id.startsWith('t-')) {
      const t = await this.tenantQuery()
        .where('t.id', '=', id.slice(2))
        .where('t.demo_session_id', 'is', null)
        .where('t.id', 'not in', demoTenantIds(this.db))
        .executeTakeFirst();
      visitor = t === undefined ? undefined : { id, startedAt: t.created_at, demo: null, contact: null, tenant: t };
    } else {
      const d = await this.demoQuery().where('s.id', '=', id).executeTakeFirst();
      visitor = d === undefined ? undefined : { id: d.id, startedAt: d.created_at, demo: d, contact: null, tenant: null };
    }
    return visitor === undefined ? undefined : (await this.assembleAll([visitor]))[0];
  }

  /**
   * Completa los visitantes con lo de cada uno (el contacto y el comercio de una demo, los eventos, el
   * primer cargo y el primer pago del titular) en una consulta por tipo, no una por visitante.
   */
  private async assembleAll(visitors: Visitor[]): Promise<Built[]> {
    const demoIds = visitors.flatMap((v) => (v.demo === null ? [] : [v.demo.id]));
    if (demoIds.length > 0) {
      const contacts = new Map<string, ContactRow>();
      for (const c of await this.contactQuery().where('c.demo_session_id', '=', anyOf(demoIds)).execute()) {
        if (c.demo_session_id !== null) contacts.set(c.demo_session_id, c);
      }
      // El comercio de una demo: el primero que nació de ella
      const tenants = new Map<string, TenantRow>();
      const linked = await this.tenantQuery()
        .select('t.demo_session_id')
        .where('t.demo_session_id', '=', anyOf(demoIds))
        .orderBy('t.created_at')
        .execute();
      for (const { demo_session_id: demoId, ...t } of linked) {
        if (demoId !== null && !tenants.has(demoId)) tenants.set(demoId, t);
      }
      for (const v of visitors) {
        if (v.demo === null) continue;
        v.contact = contacts.get(v.demo.id) ?? null;
        v.tenant = tenants.get(v.demo.id) ?? null;
      }
    }
    const related = await this.related(
      demoIds,
      visitors.flatMap((v) => (v.tenant === null ? [] : [v.tenant.id])),
    );
    return visitors.map((v) => this.assemble(v, related));
  }

  private async related(demoIds: string[], tenantIds: string[]): Promise<Related> {
    const out: Related = { events: new Map(), realSale: new Map(), payment: new Map() };
    if (demoIds.length > 0 || tenantIds.length > 0) {
      const events = await this.db
        .selectFrom('funnel_events')
        .select(['type', 'demo_session_id', 'tenant_id', 'at', 'data'])
        .where((eb) =>
          eb.or([eb('demo_session_id', '=', anyOf(demoIds)), eb.and([eb('type', '=', 'catalog-loaded'), eb('tenant_id', '=', anyOf(tenantIds))])]),
        )
        .execute();
      for (const e of events) {
        if (e.demo_session_id !== null) out.events.set(eventKey(e.type, 'demo', e.demo_session_id), e);
        if (e.tenant_id !== null) out.events.set(eventKey(e.type, 'tenant', e.tenant_id), e);
      }
    }
    if (tenantIds.length === 0) return out;
    const sales = await this.db
      .selectFrom('charges')
      .select((eb) => ['tenant_id', eb.fn.min<string>('created_at').as('at')])
      .where('tenant_id', '=', anyOf(tenantIds))
      .groupBy('tenant_id')
      .execute();
    for (const row of sales) out.realSale.set(row.tenant_id, row.at);
    // El primer pago del titular desde que nace el comercio
    const payments = await this.db
      .selectFrom('tenants as t')
      .innerJoin('paid_movements as pm', (join) => join.onRef('pm.user_id', '=', 't.holder_user_id').onRef('pm.created_at', '>=', 't.created_at'))
      .select((eb) => ['t.id', eb.fn.min<string>('pm.created_at').as('at')])
      .where('pm.kind', '=', 'payment')
      .where('t.id', '=', anyOf(tenantIds))
      .groupBy('t.id')
      .execute();
    for (const row of payments) out.payment.set(row.id, row.at);
    return out;
  }

  private assemble(v: Visitor, related: Related): Built {
    const { demo, contact, tenant } = v;
    const ev = (type: string) => (demo === null ? undefined : related.events.get(eventKey(type, 'demo', demo.id)));
    const load = tenant === null ? undefined : related.events.get(eventKey('catalog-loaded', 'tenant', tenant.id));
    const stages: Stages = {
      demo: demo?.created_at ?? null,
      'demo-sale': ev('demo-sale')?.at ?? null,
      portal: ev('portal-opened')?.at ?? null,
      contact: contact?.created_at ?? null,
      // Un comercio implica el alta, aunque el beacon no haya llegado
      alta: ev('alta-opened')?.at ?? tenant?.created_at ?? null,
      commerce: tenant?.created_at ?? null,
      load: load?.at ?? null,
      'real-sale': tenant === null ? null : (related.realSale.get(tenant.id) ?? null),
      payment: tenant === null ? null : (related.payment.get(tenant.id) ?? null),
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
