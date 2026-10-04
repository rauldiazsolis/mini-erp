import type { DocStatus, SaleKind } from '../../shared/sales-types.ts';

/**
 * Las URLs del admin (#59), sin signals ni `window`: `/admin/<comercio>/<sección>[/<solapa>][?filtros]`
 * y `/plataforma`. Los ids internos de secciones y solapas no cambian: el slug es la cara pública.
 */

export type Params = Readonly<Record<string, string>>;

export type TenantSection = 'dashboard' | 'sales' | 'catalog' | 'stock' | 'customers' | 'bulk' | 'users' | 'settings' | 'credits';
export type NavSection = TenantSection | 'platform';

/** En el orden del menú. */
export const TENANT_SECTIONS: readonly TenantSection[] = ['dashboard', 'sales', 'catalog', 'stock', 'customers', 'bulk', 'users', 'settings', 'credits'];
export const NAV_SECTIONS: readonly NavSection[] = [...TENANT_SECTIONS, 'platform'];

export const SECTION_SLUGS: Record<TenantSection, string> = {
  dashboard: 'dashboard',
  sales: 'ventas',
  catalog: 'catalogo',
  stock: 'stock',
  customers: 'clientes',
  bulk: 'masivas',
  users: 'usuarios',
  settings: 'configuracion',
  credits: 'uso-y-pagos', // #55
};

/** La primera solapa no lleva segmento. Una sección sin solapas tiene una sola, `main`. */
export const SECTION_TABS = {
  dashboard: [{ id: 'main', slug: '' }],
  sales: [{ id: 'sales', slug: '' }, { id: 'payments', slug: 'cobranzas' }, { id: 'movements', slug: 'movimientos' }, { id: 'summary', slug: 'resumen' }],
  catalog: [{ id: 'main', slug: '' }],
  stock: [{ id: 'main', slug: '' }],
  customers: [{ id: 'main', slug: '' }],
  bulk: [{ id: 'prices', slug: '' }, { id: 'interests', slug: 'intereses' }, { id: 'io', slug: 'archivos' }],
  users: [{ id: 'main', slug: '' }],
  settings: [{ id: 'pos', slug: '' }, { id: 'branches', slug: 'sucursales' }, { id: 'connection', slug: 'conexion' }, { id: 'account', slug: 'cuenta' }, { id: 'appearance', slug: 'apariencia' }],
  credits: [{ id: 'charges', slug: '' }, { id: 'movements', slug: 'movimientos' }, { id: 'gifts', slug: 'bonos' }],
} as const;

export const PLATFORM_TABS = [{ id: 'payments', slug: '' }, { id: 'settings', slug: 'configuracion' }] as const;

export type TabId<S extends TenantSection> = (typeof SECTION_TABS)[S][number]['id'];
export type PlatformTabId = (typeof PLATFORM_TABS)[number]['id'];

type Tab = { readonly id: string; readonly slug: string };

function tabsOf(section: TenantSection): readonly Tab[] {
  return SECTION_TABS[section];
}

export function firstTab(section: TenantSection): string {
  return tabsOf(section)[0]?.id ?? 'main';
}

// --- Lectores de filtros: un valor inválido se descarta ---

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isDay(raw: string): boolean {
  if (!DAY.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}

/** Texto no vacío. */
function text(p: Params, name: string): string | undefined {
  const value = p[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Texto que puede ser vacío: en sucursal y caja, vacío es "sin sucursal" o "sin punto de venta". */
function raw(p: Params, name: string): string | undefined {
  return p[name];
}

function day(p: Params, name: string): string | undefined {
  const value = p[name];
  return value !== undefined && isDay(value) ? value : undefined;
}

function positiveInt(p: Params, name: string): number | undefined {
  const value = p[name];
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 ? n : undefined;
}

/** Valor interno y su texto en la URL. */
type EnumMap<T extends string> = ReadonlyArray<readonly [T, string]>;

function fromUrl<T extends string>(map: EnumMap<T>, p: Params, name: string): T | undefined {
  const value = p[name];
  return map.find(([, url]) => url === value)?.[0];
}

function toUrl<T extends string>(map: EnumMap<T>, value: T): string | undefined {
  return map.find(([id]) => id === value)?.[1];
}

/** Los parámetros sin los `undefined`. */
function params(entries: Record<string, string | undefined>): Params {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export type FilterCodec<T> = { decode: (p: Params) => T; encode: (filters: T) => Params };

// --- Filtros por sección ---

export type NoFilters = Record<string, never>;
const noFilters: FilterCodec<NoFilters> = { decode: () => ({}), encode: () => ({}) };

export type DashboardFilters = { period: 'today' | 'week' | 'month'; branch: string };
const PERIODS: EnumMap<DashboardFilters['period']> = [['today', 'hoy'], ['week', 'semana'], ['month', 'mes']];
const dashboardCodec: FilterCodec<DashboardFilters> = {
  decode: (p) => ({ period: fromUrl(PERIODS, p, 'periodo') ?? 'week', branch: text(p, 'sucursal') ?? '' }),
  encode: (f) => params({
    periodo: f.period === 'week' ? undefined : toUrl(PERIODS, f.period),
    sucursal: f.branch === '' ? undefined : f.branch,
  }),
};

export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
export type SalesRouteFilters = {
  preset: RangePreset;
  from?: string | undefined;
  to?: string | undefined;
  branch?: string | undefined;
  pointOfSale?: string | undefined;
  page: number;
  status: DocStatus;
  productId?: string | undefined;
  method?: string | undefined;
  customerId?: string | undefined;
  kind?: SaleKind | undefined;
  direction?: 'in' | 'out' | undefined;
  source?: 'manual' | 'count-adjustment' | undefined;
};
const PRESETS: EnumMap<Exclude<RangePreset, 'custom'>> = [['today', 'hoy'], ['yesterday', 'ayer'], ['week', 'semana'], ['month', 'mes']];
const STATUSES: EnumMap<Exclude<DocStatus, 'all'>> = [['valid', 'vigentes'], ['voided', 'anuladas']];
const KINDS: EnumMap<SaleKind> = [['sale', 'venta'], ['return', 'devolucion'], ['void', 'anulacion']];
const DIRECTIONS: EnumMap<'in' | 'out'> = [['in', 'entrada'], ['out', 'salida']];
const SOURCES: EnumMap<'manual' | 'count-adjustment'> = [['manual', 'manual'], ['count-adjustment', 'recuento']];

const salesCodec: FilterCodec<SalesRouteFilters> = {
  decode: (p) => {
    const from = day(p, 'desde');
    const to = day(p, 'hasta');
    const branch = raw(p, 'sucursal');
    const pointOfSale = raw(p, 'caja');
    const productId = text(p, 'producto');
    const method = text(p, 'medio');
    const customerId = text(p, 'cliente');
    const kind = fromUrl(KINDS, p, 'tipo');
    const direction = fromUrl(DIRECTIONS, p, 'sentido');
    const source = fromUrl(SOURCES, p, 'origen');
    const custom = from !== undefined && to !== undefined;
    return {
      preset: custom ? 'custom' : (fromUrl(PRESETS, p, 'rango') ?? 'today'),
      ...(custom ? { from, to } : {}),
      ...(branch === undefined ? {} : { branch }),
      ...(pointOfSale === undefined ? {} : { pointOfSale }),
      page: positiveInt(p, 'pagina') ?? 1,
      status: fromUrl(STATUSES, p, 'estado') ?? 'all',
      ...(productId === undefined ? {} : { productId }),
      ...(method === undefined ? {} : { method }),
      ...(customerId === undefined ? {} : { customerId }),
      ...(kind === undefined ? {} : { kind }),
      ...(direction === undefined ? {} : { direction }),
      ...(source === undefined ? {} : { source }),
    };
  },
  encode: (f) => params({
    rango: f.preset === 'custom' || f.preset === 'today' ? undefined : toUrl(PRESETS, f.preset),
    desde: f.preset === 'custom' ? f.from : undefined,
    hasta: f.preset === 'custom' ? f.to : undefined,
    sucursal: f.branch,
    caja: f.pointOfSale,
    pagina: f.page > 1 ? String(f.page) : undefined,
    estado: f.status === 'all' ? undefined : toUrl(STATUSES, f.status),
    producto: f.productId,
    medio: f.method,
    cliente: f.customerId,
    tipo: f.kind === undefined ? undefined : toUrl(KINDS, f.kind),
    sentido: f.direction === undefined ? undefined : toUrl(DIRECTIONS, f.direction),
    origen: f.source === undefined ? undefined : toUrl(SOURCES, f.source),
  }),
};

export type BlockedFilter = 'all' | 'active' | 'blocked';
const BLOCKED: EnumMap<Exclude<BlockedFilter, 'all'>> = [['active', 'activos'], ['blocked', 'bloqueados']];

export type CatalogFilters = { q: string; category: string; blocked: BlockedFilter };
const catalogCodec: FilterCodec<CatalogFilters> = {
  decode: (p) => ({ q: text(p, 'q') ?? '', category: text(p, 'categoria') ?? 'all', blocked: fromUrl(BLOCKED, p, 'estado') ?? 'all' }),
  encode: (f) => params({
    q: f.q === '' ? undefined : f.q,
    categoria: f.category === 'all' ? undefined : f.category,
    estado: f.blocked === 'all' ? undefined : toUrl(BLOCKED, f.blocked),
  }),
};

export type StockLevel = 'all' | 'out' | 'low' | 'normal';
const LEVELS: EnumMap<Exclude<StockLevel, 'all'>> = [['out', 'sin-stock'], ['low', 'bajo'], ['normal', 'normal']];

export type StockFilters = { q: string; category: string; level: StockLevel; branch: string };
const stockCodec: FilterCodec<StockFilters> = {
  decode: (p) => ({
    q: text(p, 'q') ?? '',
    category: text(p, 'categoria') ?? 'all',
    level: fromUrl(LEVELS, p, 'nivel') ?? 'all',
    branch: text(p, 'sucursal') ?? 'all',
  }),
  encode: (f) => params({
    q: f.q === '' ? undefined : f.q,
    categoria: f.category === 'all' ? undefined : f.category,
    nivel: f.level === 'all' ? undefined : toUrl(LEVELS, f.level),
    sucursal: f.branch === 'all' ? undefined : f.branch,
  }),
};

export type CustomerFilters = { q: string; debtorsOnly: boolean; blocked: BlockedFilter };
const customersCodec: FilterCodec<CustomerFilters> = {
  decode: (p) => ({ q: text(p, 'q') ?? '', debtorsOnly: p['deudores'] === '1', blocked: fromUrl(BLOCKED, p, 'estado') ?? 'all' }),
  encode: (f) => params({
    q: f.q === '' ? undefined : f.q,
    deudores: f.debtorsOnly ? '1' : undefined,
    estado: f.blocked === 'all' ? undefined : toUrl(BLOCKED, f.blocked),
  }),
};

/** Sin `desde` y `hasta` válidos, el consumo muestra los últimos 30 días (lo decide el store). */
export type CreditsFilters = { from?: string | undefined; to?: string | undefined; page: number };
const creditsCodec: FilterCodec<CreditsFilters> = {
  decode: (p) => {
    const from = day(p, 'desde');
    const to = day(p, 'hasta');
    return { ...(from !== undefined && to !== undefined ? { from, to } : {}), page: positiveInt(p, 'pagina') ?? 1 };
  },
  encode: (f) => params({ desde: f.from, hasta: f.to, pagina: f.page > 1 ? String(f.page) : undefined }),
};

export type FiltersOf = {
  dashboard: DashboardFilters;
  sales: SalesRouteFilters;
  catalog: CatalogFilters;
  stock: StockFilters;
  customers: CustomerFilters;
  bulk: NoFilters;
  users: NoFilters;
  settings: NoFilters;
  credits: CreditsFilters;
};

const FILTERS: { [S in TenantSection]: FilterCodec<FiltersOf[S]> } = {
  dashboard: dashboardCodec,
  sales: salesCodec,
  catalog: catalogCodec,
  stock: stockCodec,
  customers: customersCodec,
  bulk: noFilters,
  users: noFilters,
  settings: noFilters,
  credits: creditsCodec,
};

export function decodeFilters<S extends TenantSection>(section: S, p: Params): FiltersOf[S] {
  const codec: FilterCodec<FiltersOf[S]> = FILTERS[section];
  return codec.decode(p);
}

export function encodeFilters<S extends TenantSection>(section: S, filters: FiltersOf[S]): Params {
  const codec: FilterCodec<FiltersOf[S]> = FILTERS[section];
  return codec.encode(filters);
}

/** Solo los filtros válidos y distintos del valor por omisión. */
function canonParams(section: TenantSection, p: Params): Params {
  return encodeFilters(section, decodeFilters(section, p));
}

// --- Rutas ---

export type AdminRoute = { kind: 'admin'; tenantSlug: string | null; section: TenantSection; tab: string; params: Params };
export type PlatformRoute = { kind: 'plataforma'; tab: PlatformTabId };
export type Route = { kind: 'landing' | 'alta' | 'invitacion' | 'restablecer' } | AdminRoute | PlatformRoute;

function readSearch(search: string): Params {
  return Object.fromEntries(new URLSearchParams(search));
}

function decodeSlug(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseLocation(pathname: string, search: string): Route {
  const segments = pathname.toLowerCase().split('/').filter((s) => s !== '');
  const [first, second, third, fourth] = segments;
  if (first === undefined) return { kind: 'landing' };
  if (segments.length === 1 && (first === 'alta' || first === 'onboarding')) return { kind: 'alta' };
  if (segments.length === 1 && first === 'invitacion') return { kind: 'invitacion' };
  if (segments.length === 1 && first === 'restablecer') return { kind: 'restablecer' };
  if (first === 'plataforma') {
    return { kind: 'plataforma', tab: PLATFORM_TABS.find((t) => t.slug !== '' && t.slug === second)?.id ?? 'payments' };
  }
  if (first !== 'admin') return { kind: 'landing' };
  if (second === undefined) return { kind: 'admin', tenantSlug: null, section: 'dashboard', tab: firstTab('dashboard'), params: {} };
  const section = TENANT_SECTIONS.find((s) => SECTION_SLUGS[s] === third) ?? 'dashboard';
  const tab = tabsOf(section).find((t) => t.slug !== '' && t.slug === fourth)?.id ?? firstTab(section);
  return { kind: 'admin', tenantSlug: decodeSlug(second), section, tab, params: canonParams(section, readSearch(search)) };
}

export function buildUrl(route: Route): string {
  switch (route.kind) {
    case 'landing':
      return '/';
    case 'alta':
      return '/alta';
    case 'invitacion':
      return '/invitacion';
    case 'restablecer':
      return '/restablecer';
    case 'plataforma': {
      const slug = PLATFORM_TABS.find((t) => t.id === route.tab)?.slug ?? '';
      return slug === '' ? '/plataforma' : `/plataforma/${slug}`;
    }
    case 'admin': {
      if (route.tenantSlug === null) return '/admin';
      const tabSlug = tabsOf(route.section).find((t) => t.id === route.tab)?.slug ?? '';
      const path = `/admin/${encodeURIComponent(route.tenantSlug)}/${SECTION_SLUGS[route.section]}${tabSlug === '' ? '' : `/${tabSlug}`}`;
      const query = new URLSearchParams(canonParams(route.section, route.params)).toString();
      return query === '' ? path : `${path}?${query}`;
    }
  }
}

/** La URL de una pantalla de un comercio. */
export function adminUrl<S extends TenantSection>(
  tenantSlug: string,
  section: S,
  options: { tab?: TabId<S> | undefined; filters?: FiltersOf[S] | undefined } = {},
): string {
  return buildUrl({
    kind: 'admin',
    tenantSlug,
    section,
    tab: options.tab ?? firstTab(section),
    params: options.filters === undefined ? {} : encodeFilters(section, options.filters),
  });
}
