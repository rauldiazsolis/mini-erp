# Router y TanStack Query en el admin (#59, #55): plan de implementación

> **Para quien ejecuta:** en este repo, con `superpowers:executing-plans`, **tarea por tarea en la misma
> conversación** (nunca un subagente por tarea, AGENTS.md). Al terminar cada tarea: verificar, commitear
> y frenar para que el usuario la revise. Los pasos usan casillas (`- [ ]`).

**Objetivo:** cada pantalla del admin con su URL (`/admin/<comercio>/<sección>[/<solapa>][?filtros]`), el
comercio activo en la URL, y los datos con TanStack Query: frescos al entrar, invalidados por cada
mutación y sin mezclar comercios.

**Arquitectura:** un router propio y puro (`routing/admin-routes.ts`: tabla, `parseLocation`,
`buildUrl`, códecs de filtros) con la URL como signal (`state/route-state.ts`). El comercio activo sale
del slug (`auth-state.ts`). `@tanstack/query-core` con `createSignalQuery` (clave y habilitado
reactivos) y una tabla única de invalidación. Los stores mantienen sus nombres exportados (ahora
`computed`), así los componentes cambian poco.

**Stack:** Preact + `@preact/signals`, `@tanstack/query-core` 5 (ya instalado), Vitest (Node, sin DOM),
Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-04-router-query-design.md`](../specs/2026-10-04-router-query-design.md).

## Restricciones globales

- Todo en español (código, comentarios, commits). Commits convencionales, chicos, con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sin dependencias nuevas.
- Sin hooks de React (`preact/hooks`, `preact/compat`, `react`): lo prohíbe el lint.
- TypeScript estricto: sin `any`, sin `as` ni `!` para callar errores, imports relativos con extensión,
  opcionales de entrada `x?: T | undefined` y en resultados propios la propiedad se omite si no hay valor.
- Formatos solo con `src/client/format.ts`.
- TDD: el test primero, verlo fallar, implementar lo mínimo, verlo pasar.
- Al cerrar **cada** tarea: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm build` y `pnpm test:e2e`
  (en Windows, desde PowerShell). Todo en verde antes del commit.
- URLs que no se rompen: `/`, `/alta` (con su query), `/onboarding` → `/alta`, `/invitacion#t=…`,
  `/restablecer#t=…`, `#connect=` (vuelta al POS).
- Rama `claude/router-query`. La versión (0.11.0), AGENTS.md y el borrado del plan van en la tarea 14.

## Ajustes a la spec que fija este plan

Se anotan en la spec en la tarea 14:

1. **Filtros con códecs propios** en lugar de Zod: cada sección tiene `decode`/`encode` escritos a mano
   con lectores chicos (`text`, `day`, `positiveInt`, enums con su texto de URL). Así el nombre interno
   (`active`) y el de la URL (`activos`) quedan juntos y sin casts.
2. **Sin debounce en la búsqueda**: el filtro de catálogo, stock y clientes es en memoria y
   `replaceState` no agrega entradas al historial; un debounce obligaría a un estado local del input.
3. **`createSignalQuery` separa la clave del habilitado**: la clave es `null` solo sin sesión o sin
   comercio, y `enabled` dice si la pantalla está activa. Una consulta deshabilitada con clave igual ve
   la caché (lo necesitan los tests y la edición en línea).
4. **`members` e `invitations` son un solo dominio, `users`**, porque vienen del mismo pedido.
   Las cajas del filtro de ventas (`registers`) y las de configuración (`pos-registers`) son dominios
   distintos, porque son dos endpoints.
5. **El alta y la invitación** recuerdan el comercio nuevo como "último usado" y navegan a `/admin`,
   que la normalización lleva a su dashboard (no hace falta `tenantUrl`).
6. **El drill del dashboard** sigue siendo un botón que llama a `goTo`; navega con URL igual.

## Mapa de archivos

| Archivo | Qué hace | Tarea |
|---|---|---|
| `src/client/routing/admin-routes.ts` (nuevo) | Tabla de secciones y solapas, códecs de filtros, `parseLocation`, `buildUrl`, `adminUrl` | 1 |
| `src/client/state/route-state.ts` | URL como signal, `navigate`, normalización, `goTo`, `setFilters`, `routeFilters`, `inSection`, `tabUrl` | 2 |
| `src/client/state/auth-state.ts` | Comercio desde el slug, acceso, último usado, impersonación sobre la URL | 2 |
| `src/client/state/navigation-state.ts` | Solo menú móvil y modal de impersonación | 2 |
| `src/client/components/ui/Link.tsx` (nuevo) | Link del SPA | 2 |
| `src/client/components/shell/NoAccessView.tsx` (nuevo) | "No tenés acceso a este comercio" | 2 |
| `src/client/App.tsx`, `Sidebar.tsx`, `Header.tsx`, `AppShell.tsx`, `ImpersonationModal.tsx` | Ruta por `kind`, links, selector | 2 |
| `src/client/state/permissions-state.ts` | Guardia de sección y solapa sobre la URL | 2, 3 |
| `test/helpers/client-route.ts` (nuevo) | `atTenant()` para los tests | 2 |
| `test/client-guards.test.ts` (nuevo) | Guardianes de navegación, menú y Query | 2, 4 |
| `src/client/api/query-client.ts` | `createSignalQuery` reactivo, `queryClient`, `shouldRetry` | 4 |
| `src/client/state/query-keys.ts` (nuevo) | Claves por comercio, `createTenantQuery`, borrado por comercio | 4 |
| `src/client/state/invalidation.ts` (nuevo) | Tabla evento → dominios, `invalidateAfter` | 4 |
| `src/client/state/shared-queries.ts` (nuevo) | Categorías, matriz de stock y sucursales (una caché) | 5, 6 |
| Stores de `src/client/state/` | Migración a Query y filtros desde la URL | 5 a 13 |
| `src/client/state/view-loader.ts`, `test/view-loader.test.ts` | Se borran | 7 |
| `e2e/navigation.spec.ts` (nuevo) | Recorrido de navegación | 14 |

---

### Tarea 1: Rutas puras

**Archivos:**
- Crear: `src/client/routing/admin-routes.ts`
- Test: `test/admin-routes.test.ts`

**Interfaces que produce** (las usan todas las tareas siguientes):

```ts
export type Params = Readonly<Record<string, string>>;
export type TenantSection = 'dashboard' | 'sales' | 'catalog' | 'stock' | 'customers' | 'bulk' | 'users' | 'settings' | 'credits';
export type NavSection = TenantSection | 'platform';
export const TENANT_SECTIONS: readonly TenantSection[];
export const NAV_SECTIONS: readonly NavSection[];
export const SECTION_SLUGS: Record<TenantSection, string>;
export const SECTION_TABS: { [S in TenantSection]: readonly { id: string; slug: string }[] }; // as const
export const PLATFORM_TABS; // as const
export type TabId<S extends TenantSection>;   // 'sales' | 'payments' | … según la sección
export type PlatformTabId = 'payments' | 'settings';
export function firstTab(section: TenantSection): string;
export type AdminRoute = { kind: 'admin'; tenantSlug: string | null; section: TenantSection; tab: string; params: Params };
export type PlatformRoute = { kind: 'plataforma'; tab: PlatformTabId };
export type Route = { kind: 'landing' | 'alta' | 'invitacion' | 'restablecer' } | AdminRoute | PlatformRoute;
export function parseLocation(pathname: string, search: string): Route;
export function buildUrl(route: Route): string;
export function adminUrl<S extends TenantSection>(tenantSlug: string, section: S, options?: { tab?: TabId<S> | undefined; filters?: FiltersOf[S] | undefined }): string;
export type FiltersOf = { dashboard: DashboardFilters; sales: SalesRouteFilters; catalog: CatalogFilters; stock: StockFilters; customers: CustomerFilters; credits: CreditsFilters; bulk: NoFilters; users: NoFilters; settings: NoFilters };
export function decodeFilters<S extends TenantSection>(section: S, params: Params): FiltersOf[S];
export function encodeFilters<S extends TenantSection>(section: S, filters: FiltersOf[S]): Params;
// y los tipos DashboardFilters, SalesRouteFilters, RangePreset, CatalogFilters, BlockedFilter, StockFilters, StockLevel, CustomerFilters, CreditsFilters, NoFilters
```

- [ ] **Paso 1: escribir el test que falla**

```ts
// test/admin-routes.test.ts
import { describe, it, expect } from 'vitest';
import {
  TENANT_SECTIONS, SECTION_TABS, PLATFORM_TABS, adminUrl, buildUrl, decodeFilters, encodeFilters, parseLocation,
  type Route,
} from '../src/client/routing/admin-routes.ts';

const roundTrip = (url: string): string => {
  const u = new URL(url, 'http://x');
  return buildUrl(parseLocation(u.pathname, u.search));
};

describe('Rutas del admin (#59)', () => {
  it('las URLs que ya existían se reconocen igual', () => {
    const cases: Array<[string, Route['kind']]> = [
      ['/', 'landing'], ['/cualquier-cosa', 'landing'], ['/alta', 'alta'], ['/onboarding', 'alta'], ['/ALTA/', 'alta'],
      ['/invitacion', 'invitacion'], ['/restablecer', 'restablecer'], ['/admin', 'admin'], ['/admin/', 'admin'],
      ['/admin/kiosco/clientes', 'admin'], ['/plataforma', 'plataforma'],
    ];
    for (const [path, kind] of cases) expect(parseLocation(path, '').kind, path).toBe(kind);
  });

  it('cada sección y cada solapa van y vuelven', () => {
    for (const section of TENANT_SECTIONS) {
      for (const tab of SECTION_TABS[section]) {
        const url = adminUrl('kiosco', section, { tab: tab.id });
        expect(roundTrip(url), url).toBe(url);
        const route = parseLocation(new URL(url, 'http://x').pathname, '');
        expect(route).toMatchObject({ kind: 'admin', tenantSlug: 'kiosco', section, tab: tab.id });
      }
    }
    for (const tab of PLATFORM_TABS) {
      const url = buildUrl({ kind: 'plataforma', tab: tab.id });
      expect(roundTrip(url)).toBe(url);
    }
  });

  it('los slugs de las secciones son los de la spec (#55: Uso y pagos)', () => {
    expect(adminUrl('k', 'dashboard')).toBe('/admin/k/dashboard');
    expect(adminUrl('k', 'sales', { tab: 'payments' })).toBe('/admin/k/ventas/cobranzas');
    expect(adminUrl('k', 'catalog')).toBe('/admin/k/catalogo');
    expect(adminUrl('k', 'customers')).toBe('/admin/k/clientes');
    expect(adminUrl('k', 'bulk', { tab: 'io' })).toBe('/admin/k/masivas/archivos');
    expect(adminUrl('k', 'settings', { tab: 'pos' })).toBe('/admin/k/configuracion');
    expect(adminUrl('k', 'settings', { tab: 'appearance' })).toBe('/admin/k/configuracion/apariencia');
    expect(adminUrl('k', 'credits', { tab: 'gifts' })).toBe('/admin/k/uso-y-pagos/regalados');
    expect(buildUrl({ kind: 'plataforma', tab: 'settings' })).toBe('/plataforma/configuracion');
  });

  it('normaliza: comercio sin sección, mayúsculas, solapa y sección desconocidas', () => {
    expect(roundTrip('/admin/kiosco')).toBe('/admin/kiosco/dashboard');
    expect(roundTrip('/Admin/Kiosco/Clientes/')).toBe('/admin/kiosco/clientes');
    expect(roundTrip('/admin/kiosco/ventas/inexistente')).toBe('/admin/kiosco/ventas');
    expect(roundTrip('/admin/kiosco/inexistente')).toBe('/admin/kiosco/dashboard');
    expect(roundTrip('/admin')).toBe('/admin');
    expect(roundTrip('/plataforma/otra')).toBe('/plataforma');
  });

  it('descarta filtros inválidos y no escribe los de por omisión', () => {
    expect(roundTrip('/admin/k/catalogo?q=coca&estado=raro&otro=1')).toBe('/admin/k/catalogo?q=coca');
    expect(roundTrip('/admin/k/ventas?pagina=abc&rango=hoy')).toBe('/admin/k/ventas');
    expect(roundTrip('/admin/k/ventas?desde=2026-02-30&hasta=2026-03-01')).toBe('/admin/k/ventas');
    expect(roundTrip('/admin/k/dashboard?periodo=semana')).toBe('/admin/k/dashboard');
    expect(roundTrip('/admin/k/usuarios?q=x')).toBe('/admin/k/usuarios');
  });

  it('filtros de ventas: rango, caja vacía ("sin punto de venta"), estado y página', () => {
    const url = '/admin/k/ventas?desde=2026-10-01&hasta=2026-10-03&sucursal=CENTRAL&caja=&pagina=2&estado=anuladas&producto=p1';
    expect(roundTrip(url)).toBe(url);
    expect(decodeFilters('sales', { desde: '2026-10-01', hasta: '2026-10-03', caja: '' })).toEqual({
      preset: 'custom', from: '2026-10-01', to: '2026-10-03', pointOfSale: '', page: 1, status: 'all',
    });
    expect(decodeFilters('sales', { rango: 'semana' })).toEqual({ preset: 'week', page: 1, status: 'all' });
    expect(encodeFilters('sales', { preset: 'today', page: 1, status: 'all' })).toEqual({});
  });

  it('filtros de catálogo, stock, clientes, dashboard y uso y pagos', () => {
    expect(decodeFilters('catalog', { q: 'coca', categoria: 'Bebidas', estado: 'bloqueados' })).toEqual({ q: 'coca', category: 'Bebidas', blocked: 'blocked' });
    expect(decodeFilters('stock', { nivel: 'sin-stock', sucursal: 'b1' })).toEqual({ q: '', category: 'all', level: 'out', branch: 'b1' });
    expect(decodeFilters('customers', { deudores: '1', estado: 'activos' })).toEqual({ q: '', debtorsOnly: true, blocked: 'active' });
    expect(decodeFilters('dashboard', { periodo: 'mes', sucursal: 'b1' })).toEqual({ period: 'month', branch: 'b1' });
    expect(decodeFilters('credits', { desde: '2026-09-01', hasta: '2026-09-30', pagina: '3' })).toEqual({ from: '2026-09-01', to: '2026-09-30', page: 3 });
    expect(encodeFilters('customers', { q: '', debtorsOnly: true, blocked: 'all' })).toEqual({ deudores: '1' });
  });
});
```

- [ ] **Paso 2: correrlo y ver que falla**

Run: `pnpm vitest run test/admin-routes.test.ts`
Esperado: FAIL, no encuentra `../src/client/routing/admin-routes.ts`.

- [ ] **Paso 3: implementar**

```ts
// src/client/routing/admin-routes.ts
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
  credits: [{ id: 'charges', slug: '' }, { id: 'movements', slug: 'movimientos' }, { id: 'gifts', slug: 'regalados' }],
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
function canonParams<S extends TenantSection>(section: S, p: Params): Params {
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
```

- [ ] **Paso 4: correr el test y ver que pasa**

Run: `pnpm vitest run test/admin-routes.test.ts`
Esperado: PASS. Si `FILTERS[section]` no tipa como `FilterCodec<FiltersOf[S]>`, es la versión de TS:
dejar la anotación local `const codec: FilterCodec<FiltersOf[S]> = FILTERS[section];` (ya está) y
revisar que `FILTERS` tenga el tipo mapeado exacto de arriba.

- [ ] **Paso 5: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add src/client/routing/admin-routes.ts test/admin-routes.test.ts
git commit -m "feat: tabla de rutas del admin con secciones, solapas y filtros (#59)"
```

Frenar: el usuario revisa la tarea 1.

---

### Tarea 2: Sección y comercio en la URL

**Archivos:**
- Modificar: `src/client/state/route-state.ts` (reescrito), `src/client/state/auth-state.ts`,
  `src/client/state/navigation-state.ts`, `src/client/state/permissions-state.ts`,
  `src/client/state/merchant-onboarding-state.ts`, `src/client/state/link-pages-state.ts`,
  `src/client/state/view-loader.ts`, `src/client/state/sales-state.ts`, `src/client/state/users-state.ts`,
  `src/client/state/credits-state.ts`, `src/client/state/platform-state.ts`,
  `src/client/state/example-catalog-state.ts`, `src/client/state/dashboard-drill.ts`, `src/client/App.tsx`,
  `src/client/components/shell/{Sidebar,Header,AppShell,ImpersonationModal}.tsx`,
  `src/client/components/dashboard/StockAlertsCard.tsx`, `src/client/components/credits/{CreditsBanner,RestrictedView}.tsx`,
  `src/client/components/import/ImportWizard.tsx`
- Crear: `src/client/components/ui/Link.tsx`, `src/client/components/shell/NoAccessView.tsx`,
  `test/helpers/client-route.ts`, `test/route-state.test.ts`, `test/active-tenant.test.ts`,
  `test/client-guards.test.ts`
- Tests que se adaptan: `route-and-landing`, `app-shell-and-navigation`, `auth-client-state`,
  `merchant-onboarding`, `link-pages`, `sales-client`, `permissions-client`, `credits-client`,
  `view-loader` y todos los que hacen `activeTenantIdSignal.value = …` (lista en el paso 9)
- e2e: `e2e/roles-invitations.spec.ts`, `e2e/sales-cash.spec.ts`

**Interfaces:**
- Consume (tarea 1): `parseLocation`, `buildUrl`, `adminUrl`, `decodeFilters`, `Route`, `TenantSection`,
  `NavSection`, `FiltersOf`, `TabId`, `firstTab`.
- Produce:

```ts
// route-state.ts
export type HistoryLike = { pushState(data: null, unused: string, url: string): void; replaceState(data: null, unused: string, url: string): void };
export function setHistoryForTests(history: HistoryLike | null): void;
export const locationSignal: Signal<{ pathname: string; search: string }>;
export const routeSignal: ReadonlySignal<Route>;
export const activeSectionSignal: ReadonlySignal<NavSection | null>;
export const currentTenantSlugSignal: ReadonlySignal<string | null>;
export function routeFromPath(pathname: string): Route['kind'];
export function navigate(url: string, options?: { replace?: boolean | undefined }): void;
export function canonicalUrl(location: { pathname: string; search: string }): string | undefined;
export function initRouting(): void;
export function inSection(...sections: NavSection[]): boolean;          // reactiva
export function routeFilters<S extends TenantSection>(section: S): FiltersOf[S]; // reactiva; por omisión fuera de su sección
export function goTo<S extends TenantSection>(target: { section: S; tab?: TabId<S> | undefined; filters?: FiltersOf[S] | undefined }): void;
export function setFilters<S extends TenantSection>(section: S, patch: Partial<FiltersOf[S]>): void;
export function switchTenantUrl(route: Route, tenantSlug: string): string;
export function tabUrl<S extends TenantSection>(section: S, tab: TabId<S>, filters?: FiltersOf[S] | undefined): string; // reactiva
// auth-state.ts (además de lo que ya exporta)
export const profileLoadedSignal: Signal<boolean>;
export const lastTenantIdSignal: Signal<string | null>;
export const effectiveTenantIdSignal: ReadonlySignal<string | null>;   // ahora desde la URL
export const activeTenantSignal: ReadonlySignal<TenantMembershipItem | null>;
export type TenantAccess = 'none' | 'loading' | 'ok' | 'denied';
export const tenantAccessSignal: ReadonlySignal<TenantAccess>;
export const homeTenantSlugSignal: ReadonlySignal<string | null>;
export function rememberTenant(tenantId: string | null): void;
export const impersonationSignal: Signal<{ slug: string; fromSlug: string | null } | null>;
export const isImpersonatingSignal: ReadonlySignal<boolean>;
export function impersonateTenant(tenantId: string): void;
export function stopImpersonation(): void;
export function selectTenant(tenantId: string): string;
export function registerTenantRouteEffects(): () => void;
// Se van: activeTenantIdSignal, impersonatedTenantIdSignal, setActiveTenant (y en navigation-state: activeViewSignal, navigateTo, ActiveNavView)
// components/ui/Link.tsx
export function isPlainLeftClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean;
export function Link(props: Omit<JSX.IntrinsicElements['a'], 'href' | 'onClick'> & { href: string; onNavigate?: (() => void) | undefined }): JSX.Element;
// test/helpers/client-route.ts
export function atTenant(idOrSlug: string, path?: string, role?: MembershipRole): void;
```

- [ ] **Paso 1: el helper de tests y los tests nuevos que fallan**

```ts
// test/helpers/client-route.ts
import { navigate } from '../../src/client/state/route-state.ts';
import { profileLoadedSignal, userTenantsSignal } from '../../src/client/state/auth-state.ts';
import type { MembershipRole } from '../../src/shared/permissions.ts';

/**
 * Deja la app en una pantalla de un comercio (#59): `path` es lo que va después del slug
 * (`'catalogo'`, `'ventas/cobranzas?rango=semana'`). Si el comercio no está en "tus comercios", lo agrega.
 */
export function atTenant(idOrSlug: string, path = 'dashboard', role: MembershipRole = 'owner'): void {
  const found = userTenantsSignal.value.find((t) => t.slug === idOrSlug || t.tenantId === idOrSlug);
  if (found === undefined) {
    userTenantsSignal.value = [...userTenantsSignal.value, { tenantId: idOrSlug, slug: idOrSlug, name: idOrSlug, role, status: 'active' }];
  }
  profileLoadedSignal.value = true;
  navigate(`/admin/${found?.slug ?? idOrSlug}/${path}`);
}
```

```ts
// test/route-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  activeSectionSignal, canonicalUrl, goTo, locationSignal, navigate, routeFilters, routeSignal, setFilters,
  setHistoryForTests, switchTenantUrl,
} from '../src/client/state/route-state.ts';

const calls: Array<[string, string]> = [];

describe('La URL como signal (#59)', () => {
  beforeEach(() => {
    setHistoryForTests({
      pushState: (_d, _u, url) => { calls.push(['push', url]); },
      replaceState: (_d, _u, url) => { calls.push(['replace', url]); },
    });
    navigate('/admin/kiosco/dashboard', { replace: true });
    calls.length = 0;
  });

  it('cambiar de sección agrega una entrada al historial', () => {
    goTo({ section: 'customers' });
    expect(calls).toEqual([['push', '/admin/kiosco/clientes']]);
    expect(activeSectionSignal.value).toBe('customers');
  });

  it('cambiar un filtro reemplaza la entrada', () => {
    goTo({ section: 'catalog' });
    calls.length = 0;
    setFilters('catalog', { q: 'coca' });
    expect(calls).toEqual([['replace', '/admin/kiosco/catalogo?q=coca']]);
    expect(routeFilters('catalog')).toEqual({ q: 'coca', category: 'all', blocked: 'all' });
  });

  it('un filtro de otra sección no hace nada y fuera de su sección vale el de por omisión', () => {
    setFilters('catalog', { q: 'coca' });
    expect(calls).toEqual([]);
    expect(routeFilters('catalog').q).toBe('');
  });

  it('navegar a la URL actual no duplica la entrada', () => {
    navigate('/admin/kiosco/dashboard');
    expect(calls).toEqual([]);
  });

  it('goTo con filtros y solapa', () => {
    goTo({ section: 'sales', tab: 'payments', filters: { preset: 'week', page: 1, status: 'voided' } });
    expect(locationSignal.value).toEqual({ pathname: '/admin/kiosco/ventas/cobranzas', search: '?rango=semana&estado=anuladas' });
  });

  it('cambiar de comercio mantiene sección y solapa y suelta los filtros', () => {
    navigate('/admin/kiosco/ventas/cobranzas?rango=semana');
    expect(switchTenantUrl(routeSignal.value, 'almacen')).toBe('/admin/almacen/ventas/cobranzas');
    expect(switchTenantUrl({ kind: 'plataforma', tab: 'payments' }, 'almacen')).toBe('/admin/almacen/dashboard');
  });

  it('la URL canónica', () => {
    expect(canonicalUrl({ pathname: '/onboarding', search: '?template=kiosco' })).toBe('/alta?template=kiosco');
    expect(canonicalUrl({ pathname: '/alta', search: '?template=kiosco' })).toBeUndefined();
    expect(canonicalUrl({ pathname: '/admin/kiosco', search: '' })).toBe('/admin/kiosco/dashboard');
    expect(canonicalUrl({ pathname: '/admin/kiosco/catalogo', search: '?estado=raro&q=x' })).toBe('/admin/kiosco/catalogo?q=x');
    expect(canonicalUrl({ pathname: '/admin/kiosco/clientes', search: '' })).toBeUndefined();
    expect(canonicalUrl({ pathname: '/admin', search: '' })).toBeUndefined();
    expect(canonicalUrl({ pathname: '/invitacion', search: '' })).toBeUndefined();
  });
});
```

```ts
// test/active-tenant.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { locationSignal, navigate, setHistoryForTests } from '../src/client/state/route-state.ts';
import {
  currentUserSignal, effectiveTenantIdSignal, impersonateTenant, isImpersonatingSignal, lastTenantIdSignal, logout,
  profileLoadedSignal, registerTenantRouteEffects, selectTenant, stopImpersonation, tenantAccessSignal, tokenSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';

const kiosco = { tenantId: 't-kiosco', slug: 'kiosco', name: 'Kiosco', role: 'owner' as const, status: 'active' as const };
const almacen = { tenantId: 't-almacen', slug: 'almacen', name: 'Almacén', role: 'owner' as const, status: 'active' as const };
const path = (): string => `${locationSignal.value.pathname}${locationSignal.value.search}`;

describe('El comercio activo sale de la URL (#59)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    logout();
    tokenSignal.value = 'tok';
    navigate('/');
  });

  it('busca el slug en "tus comercios"', () => {
    userTenantsSignal.value = [kiosco, almacen];
    profileLoadedSignal.value = true;
    navigate('/admin/almacen/clientes');
    expect(effectiveTenantIdSignal.value).toBe('t-almacen');
    expect(tenantAccessSignal.value).toBe('ok');
  });

  it('con el perfil cargando espera, y con un slug ajeno avisa', () => {
    navigate('/admin/almacen/clientes');
    expect(tenantAccessSignal.value).toBe('loading');
    expect(effectiveTenantIdSignal.value).toBeNull();
    userTenantsSignal.value = [kiosco];
    profileLoadedSignal.value = true;
    expect(tenantAccessSignal.value).toBe('denied');
    navigate('/admin');
    expect(tenantAccessSignal.value).toBe('none');
  });

  it('/admin va al último comercio usado y, si no hay, al primero', () => {
    const dispose = registerTenantRouteEffects();
    userTenantsSignal.value = [kiosco, almacen];
    profileLoadedSignal.value = true;
    navigate('/admin');
    expect(path()).toBe('/admin/kiosco/dashboard');
    navigate('/admin/almacen/stock');
    expect(lastTenantIdSignal.value).toBe('t-almacen');
    navigate('/admin');
    expect(path()).toBe('/admin/almacen/dashboard');
    dispose();
  });

  it('el selector mantiene la pantalla y devuelve el nombre del elegido', () => {
    userTenantsSignal.value = [kiosco, almacen];
    profileLoadedSignal.value = true;
    navigate('/admin/kiosco/ventas/cobranzas?rango=semana');
    expect(selectTenant('t-almacen')).toBe('Almacén');
    expect(path()).toBe('/admin/almacen/ventas/cobranzas');
  });

  it('impersonar muestra la franja en ese comercio y "Salir" vuelve al de antes', () => {
    currentUserSignal.value = { id: 'r', email: 'root@local.test', name: 'Root', globalRole: 'root' };
    userTenantsSignal.value = [kiosco, almacen];
    profileLoadedSignal.value = true;
    navigate('/admin/kiosco/clientes');
    impersonateTenant('t-almacen');
    expect(path()).toBe('/admin/almacen/clientes');
    expect(isImpersonatingSignal.value).toBe(true);
    stopImpersonation();
    expect(path()).toBe('/admin/kiosco/dashboard');
    expect(isImpersonatingSignal.value).toBe(false);
  });

  it('solo root o soporte impersonan', () => {
    currentUserSignal.value = { id: 'u', email: 'u@local.test', name: 'U', globalRole: 'user' };
    userTenantsSignal.value = [kiosco, almacen];
    expect(() => { impersonateTenant('t-almacen'); }).toThrow();
  });

  it('cerrar la sesión olvida el último comercio y el perfil', () => {
    lastTenantIdSignal.value = 't-kiosco';
    profileLoadedSignal.value = true;
    logout();
    expect(lastTenantIdSignal.value).toBeNull();
    expect(profileLoadedSignal.value).toBe(false);
  });
});
```

```ts
// test/client-guards.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NAV_SECTIONS } from '../src/client/routing/admin-routes.ts';
import { navItems } from '../src/client/components/shell/Sidebar.tsx';
import { isPlainLeftClick } from '../src/client/components/ui/Link.tsx';

const ROOT = 'src/client';
const files = (readdirSync(ROOT, { recursive: true, encoding: 'utf8' }))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => f.replaceAll('\\', '/'));
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

describe('Guardianes del cliente (#59)', () => {
  it('cada sección tiene su ítem en el menú y viceversa', () => {
    expect([...navItems.map((i) => i.id)].sort()).toEqual([...NAV_SECTIONS].sort());
  });

  it('solo route-state navega con el historial; la vuelta al POS del alta es la excepción', () => {
    const allowed = new Set(['state/route-state.ts', 'state/merchant-onboarding-state.ts']);
    const offenders = files.filter((f) => !allowed.has(f) && /history\.(pushState|replaceState)|location\.(assign|replace)\(|location\.href\s*=/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('un link navega solo con el clic izquierdo sin teclas', () => {
    const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
    expect(isPlainLeftClick(base)).toBe(true);
    expect(isPlainLeftClick({ ...base, ctrlKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...base, metaKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...base, button: 1 })).toBe(false);
    expect(isPlainLeftClick({ ...base, defaultPrevented: true })).toBe(false);
  });
});
```

- [ ] **Paso 2: correrlos y ver que fallan**

Run: `pnpm vitest run test/route-state.test.ts test/active-tenant.test.ts test/client-guards.test.ts`
Esperado: FAIL (faltan `setHistoryForTests`, `goTo`, `profileLoadedSignal`, `Link.tsx`, etc.).

- [ ] **Paso 3: `route-state.ts` nuevo**

```ts
// src/client/state/route-state.ts
import { computed, signal } from '@preact/signals';
import {
  adminUrl, buildUrl, decodeFilters, parseLocation,
  type FiltersOf, type NavSection, type Route, type TabId, type TenantSection,
} from '../routing/admin-routes.ts';

/**
 * Un solo SPA (#9) con una URL por pantalla (#59): landing en `/`, alta en `/alta`, los links en
 * `/invitacion` y `/restablecer`, el admin en `/admin/<comercio>/<sección>[/<solapa>][?filtros]` y
 * la plataforma en `/plataforma`. La URL es la única fuente: este módulo es el único que la escribe.
 */

export type HistoryLike = {
  pushState(data: null, unused: string, url: string): void;
  replaceState(data: null, unused: string, url: string): void;
};

let history: HistoryLike | null = typeof window === 'undefined' ? null : window.history;

/** Los tests corren sin navegador: registran o ignoran el historial. */
export function setHistoryForTests(next: HistoryLike | null): void {
  history = next;
}

type Location = { pathname: string; search: string };

export const locationSignal = signal<Location>(
  typeof window === 'undefined' ? { pathname: '/', search: '' } : { pathname: window.location.pathname, search: window.location.search },
);

export const routeSignal = computed<Route>(() => parseLocation(locationSignal.value.pathname, locationSignal.value.search));

export const activeSectionSignal = computed<NavSection | null>(() => {
  const route = routeSignal.value;
  if (route.kind === 'admin') return route.section;
  return route.kind === 'plataforma' ? 'platform' : null;
});

export const currentTenantSlugSignal = computed<string | null>(() => {
  const route = routeSignal.value;
  return route.kind === 'admin' ? route.tenantSlug : null;
});

export function routeFromPath(pathname: string): Route['kind'] {
  return parseLocation(pathname, '').kind;
}

export function navigate(url: string, options: { replace?: boolean | undefined } = {}): void {
  const parsed = new URL(url, 'http://localhost');
  const next = { pathname: parsed.pathname, search: parsed.search };
  const current = locationSignal.peek();
  const same = current.pathname === next.pathname && current.search === next.search;
  if (options.replace === true) {
    history?.replaceState(null, '', url);
  } else if (!same) {
    history?.pushState(null, '', url);
  }
  if (!same) locationSignal.value = next;
}

/** `/onboarding` → `/alta`; en el admin y la plataforma, la URL de `buildUrl`. `undefined` si ya es la canónica. */
export function canonicalUrl(location: Location): string | undefined {
  const route = parseLocation(location.pathname, location.search);
  if (route.kind === 'alta') return location.pathname === '/alta' ? undefined : `/alta${location.search}`;
  if (route.kind !== 'admin' && route.kind !== 'plataforma') return undefined;
  const url = buildUrl(route);
  return url === `${location.pathname}${location.search}` ? undefined : url;
}

function normalizeUrl(): void {
  const canonical = canonicalUrl(locationSignal.peek());
  if (canonical !== undefined) navigate(`${canonical}${window.location.hash}`, { replace: true });
}

export function initRouting(): void {
  const sync = (): void => {
    locationSignal.value = { pathname: window.location.pathname, search: window.location.search };
    normalizeUrl();
  };
  sync();
  window.addEventListener('popstate', sync);
}

/** Si la pantalla activa es alguna de esas. Lee la ruta: dentro de un `computed` o `effect`, es reactiva. */
export function inSection(...sections: NavSection[]): boolean {
  const active = activeSectionSignal.value;
  return active !== null && sections.includes(active);
}

/** Los filtros de la URL de esa sección; fuera de ella, los de por omisión. Reactiva. */
export function routeFilters<S extends TenantSection>(section: S): FiltersOf[S] {
  const route = routeSignal.value;
  return decodeFilters(section, route.kind === 'admin' && route.section === section ? route.params : {});
}

/** Otra pantalla del comercio de la URL: una entrada nueva del historial. */
export function goTo<S extends TenantSection>(target: { section: S; tab?: TabId<S> | undefined; filters?: FiltersOf[S] | undefined }): void {
  const slug = currentTenantSlugSignal.peek();
  if (slug === null) return;
  navigate(adminUrl(slug, target.section, { tab: target.tab, filters: target.filters }));
}

/** Cambia filtros de la pantalla activa sin agregar una entrada al historial. */
export function setFilters<S extends TenantSection>(section: S, patch: Partial<FiltersOf[S]>): void {
  const route = routeSignal.peek();
  if (route.kind !== 'admin' || route.section !== section || route.tenantSlug === null) return;
  const next: FiltersOf[S] = { ...decodeFilters(section, route.params), ...patch };
  navigate(buildUrl({ ...route, params: encodeFilters(section, next) }), { replace: true });
}

/** El mismo lugar en otro comercio: sección y solapa, sin filtros (sucursal, caja o producto son de cada uno). */
export function switchTenantUrl(route: Route, tenantSlug: string): string {
  if (route.kind !== 'admin') return adminUrl(tenantSlug, 'dashboard');
  return buildUrl({ kind: 'admin', tenantSlug, section: route.section, tab: route.tab, params: {} });
}

/** El href de una solapa del comercio de la URL. Reactiva. */
export function tabUrl<S extends TenantSection>(section: S, tab: TabId<S>, filters?: FiltersOf[S] | undefined): string {
  const slug = currentTenantSlugSignal.value;
  return slug === null ? '/admin' : adminUrl(slug, section, { tab, filters });
}
```

> `setFilters` conserva comercio, sección y solapa de la ruta actual y solo cambia sus parámetros.
> Agregar `encodeFilters` al import de `admin-routes.ts`.

- [ ] **Paso 4: `auth-state.ts`: comercio desde la URL**

Cambios sobre el archivo actual (las partes que no se nombran quedan igual):

1. Imports: agregar
   ```ts
   import { effect } from '@preact/signals'; // junto a signal y computed
   import { queryClient } from '../api/query-client.ts';
   import { currentTenantSlugSignal, navigate, routeSignal, switchTenantUrl } from './route-state.ts';
   import { adminUrl } from '../routing/admin-routes.ts';
   ```
   (`queryClient` ya existe en `api/query-client.ts`; la tarea 4 lo reescribe con el mismo nombre.)
2. Reemplazar `activeTenantIdSignal`, `impersonatedTenantIdSignal`, `effectiveTenantIdSignal`,
   `isImpersonatingSignal` y `activeTenantSignal` (líneas 66-67 y 81-93) por:
   ```ts
   /** Si ya llegó `auth/me`: antes, un slug de la URL no se puede juzgar (#59). */
   export const profileLoadedSignal = signal<boolean>(false);
   /** El último comercio usado (#59): solo decide adónde va `/admin` pelado. */
   export const lastTenantIdSignal = signal<string | null>(getStoredTenantId());

   /** El comercio de la URL, si es uno de "tus comercios". */
   export const activeTenantSignal = computed<TenantMembershipItem | null>(() => {
     const slug = currentTenantSlugSignal.value;
     if (slug === null) return null;
     return userTenantsSignal.value.find((t) => t.slug === slug) ?? null;
   });

   export const effectiveTenantIdSignal = computed<string | null>(() => activeTenantSignal.value?.tenantId ?? null);

   export type TenantAccess = 'none' | 'loading' | 'ok' | 'denied';
   export const tenantAccessSignal = computed<TenantAccess>(() => {
     if (currentTenantSlugSignal.value === null) return 'none';
     if (!profileLoadedSignal.value) return 'loading';
     return activeTenantSignal.value === null ? 'denied' : 'ok';
   });

   /** Adónde llevan `/admin` y el menú cuando la URL no tiene comercio: el de la URL, el último o el primero. */
   export const homeTenantSlugSignal = computed<string | null>(() => {
     const current = activeTenantSignal.value;
     if (current !== null) return current.slug;
     const tenants = userTenantsSignal.value;
     return (tenants.find((t) => t.tenantId === lastTenantIdSignal.value) ?? tenants[0])?.slug ?? null;
   });

   export function rememberTenant(tenantId: string | null): void {
     lastTenantIdSignal.value = tenantId;
     setStoredTenantId(tenantId);
   }

   /** La impersonación de hoy, en memoria, hasta que M7 la reemplace: el comercio y desde cuál se entró. */
   export const impersonationSignal = signal<{ slug: string; fromSlug: string | null } | null>(null);
   export const isImpersonatingSignal = computed<boolean>(() => {
     const imp = impersonationSignal.value;
     return imp !== null && imp.slug === currentTenantSlugSignal.value;
   });
   ```
3. En `fetchProfile`, reemplazar el bloque "Si no hay tenant activo…" (líneas 120-128) por
   `profileLoadedSignal.value = true;`.
4. `login`: antes de `tokenSignal.value = res.token;`, agregar `queryClient.clear();`.
   `adoptSession`: primera línea `queryClient.clear();`.
5. `logout` queda:
   ```ts
   export function logout(): void {
     queryClient.clear();
     tokenSignal.value = null;
     setStoredToken(null);
     currentUserSignal.value = null;
     userTenantsSignal.value = [];
     profileLoadedSignal.value = false;
     rememberTenant(null);
     impersonationSignal.value = null;
     authErrorSignal.value = null;
   }
   ```
6. Reemplazar `setActiveTenant`, `selectTenant`, `impersonateTenant` y `stopImpersonation` por:
   ```ts
   function findTenant(tenantId: string): TenantMembershipItem | undefined {
     return userTenantsSignal.peek().find((t) => t.tenantId === tenantId);
   }

   /** Cambia de comercio desde el selector, en la misma pantalla; devuelve el nombre para el aviso (#45). */
   export function selectTenant(tenantId: string): string {
     impersonationSignal.value = null;
     const tenant = findTenant(tenantId);
     if (tenant !== undefined) navigate(switchTenantUrl(routeSignal.peek(), tenant.slug));
     return tenant?.name ?? tenantId;
   }

   export function impersonateTenant(tenantId: string): void {
     if (!isRootOrSupportSignal.value) {
       throw new Error('Solo usuarios root o support pueden impersonar comercios');
     }
     const tenant = findTenant(tenantId);
     if (tenant === undefined) throw new Error('Comercio desconocido');
     impersonationSignal.value = { slug: tenant.slug, fromSlug: currentTenantSlugSignal.peek() };
     navigate(switchTenantUrl(routeSignal.peek(), tenant.slug));
   }

   export function stopImpersonation(): void {
     const from = impersonationSignal.peek()?.fromSlug ?? null;
     impersonationSignal.value = null;
     navigate(from === null ? '/admin' : adminUrl(from, 'dashboard'));
   }

   /**
    * Recuerda el comercio de la URL y lleva `/admin` pelado al último usado (#59). Devuelve la función
    * que corta los efectos.
    */
   export function registerTenantRouteEffects(): () => void {
     const stopRemember = effect(() => {
       const tenant = activeTenantSignal.value;
       if (tenant !== null) rememberTenant(tenant.tenantId);
     });
     const stopHome = effect(() => {
       const route = routeSignal.value;
       if (route.kind !== 'admin' || route.tenantSlug !== null || !profileLoadedSignal.value) return;
       const home = homeTenantSlugSignal.value;
       if (home !== null) navigate(adminUrl(home, 'dashboard'), { replace: true });
     });
     return () => {
       stopRemember();
       stopHome();
     };
   }

   if (typeof window !== 'undefined') {
     registerTenantRouteEffects();
   }
   ```

> Ciclos de imports: `route-state` no importa `auth-state`. `api/query-client.ts` importa
> `api/client.ts` (como `auth-state`), no `auth-state`.

- [ ] **Paso 5: `Link`, `NoAccessView` y `navigation-state`**

```tsx
// src/client/components/ui/Link.tsx
import type { JSX } from 'preact';
import { navigate } from '../../state/route-state.ts';

type ClickLike = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };

/** Solo el clic izquierdo sin teclas navega dentro del SPA; con Ctrl, Cmd o la rueda se abre otra pestaña. */
export function isPlainLeftClick(e: ClickLike): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

type LinkProps = Omit<JSX.IntrinsicElements['a'], 'href' | 'onClick'> & { href: string; onNavigate?: (() => void) | undefined };

/** Un link del SPA (#59): un `<a>` de verdad, que navega sin recargar. */
export function Link({ href, onNavigate, ...rest }: LinkProps) {
  const handleClick = (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();
    navigate(href);
    onNavigate?.();
  };
  return <a {...rest} href={href} onClick={handleClick} />;
}
```

```tsx
// src/client/components/shell/NoAccessView.tsx
import { navigate, currentTenantSlugSignal } from '../../state/route-state.ts';
import { Button } from '../ui/Button.tsx';

/** Un link a un comercio que no es tuyo, o que no existe (#59): se avisa, nunca se redirige en silencio. */
export function NoAccessView() {
  return (
    <div class="py-20 text-center max-w-md mx-auto space-y-4">
      <h3 class="text-lg font-bold text-slate-900 dark:text-white">No tenés acceso a este comercio o no existe</h3>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        El link apunta a <span class="font-mono">{currentTenantSlugSignal.value}</span>. Elegí uno de tus comercios arriba.
      </p>
      <Button onClick={() => { navigate('/admin'); }}>Ir a mi comercio</Button>
    </div>
  );
}
```

`navigation-state.ts` queda solo con `mobileMenuOpenSignal`, `impersonationModalOpenSignal`,
`toggleMobileMenu`, `openImpersonationModal`, `closeImpersonationModal` (se borran `ActiveNavView`,
`activeViewSignal` y `navigateTo`).

- [ ] **Paso 6: `App.tsx`, menú, header, shell e impersonación**

`App.tsx`: reemplazar el import de `activeViewSignal` por
`import { activeSectionSignal, initRouting, routeSignal } from './state/route-state.ts';` (sacar el
import viejo de `initRouting, routeSignal`), importar `tenantAccessSignal` de `auth-state.ts`,
`NoAccessView` y `type NavSection` de `./routing/admin-routes.ts`, y reemplazar el cuerpo de `App`
desde `if (routeSignal.value === 'landing')` hasta el final por:

```tsx
  const route = routeSignal.value;
  if (route.kind === 'landing') return <LandingView />;
  // Links de invitación y restablecimiento (#19): se abren con o sin sesión
  if (route.kind === 'invitacion') return <InvitationView />;
  if (route.kind === 'restablecer') return <ResetPasswordView />;
  if (route.kind === 'alta' || merchantOnboardingActiveSignal.value) return <MerchantOnboardingView />;
  // Sin sesión, el login en la misma URL: al entrar se abre esa pantalla (#59)
  if (!isAuthenticatedSignal.value) return <AuthView />;

  if (tenantAccessSignal.value === 'denied') {
    return (
      <AppShell>
        <NoAccessView />
      </AppShell>
    );
  }

  const section = activeSectionSignal.value ?? 'dashboard';
  // Comercio restringido por deuda (#21): solo Uso y pagos y Configuración; Plataforma no es del comercio
  if (isRestrictedSignal.value && section !== 'credits' && section !== 'settings' && section !== 'platform') {
    return (
      <AppShell>
        <RestrictedView />
      </AppShell>
    );
  }

  const View = VIEWS[section];
  return (
    <AppShell>
      <View />
    </AppShell>
  );
}

/** Una vista por sección: el tipo obliga a que estén todas (#59). */
const VIEWS: Record<NavSection, () => JSX.Element> = {
  dashboard: DashboardView,
  sales: SalesView,
  catalog: CatalogView,
  stock: StockView,
  customers: CustomerView,
  bulk: BulkView,
  users: UsersView,
  settings: SettingsView,
  credits: CreditsView,
  platform: PlatformView,
};
```
con `import type { JSX } from 'preact';`. Si alguna vista no tipa como `() => JSX.Element` (por ejemplo,
devuelve `JSX.Element | null`), usar `ComponentType` de `preact` para el tipo del registro.

`Sidebar.tsx`:
- `import { mobileMenuOpenSignal, toggleMobileMenu } from '../../state/navigation-state.ts';`,
  `import { activeSectionSignal } from '../../state/route-state.ts';`,
  `import { homeTenantSlugSignal } from '../../state/auth-state.ts';`,
  `import { adminUrl, type NavSection } from '../../routing/admin-routes.ts';`,
  `import { Link } from '../ui/Link.tsx';`.
- `type NavItem = { id: NavSection; … }`.
- Agregar
  ```ts
  /** El href de un ítem: la sección en el comercio de la URL (o el de inicio); Plataforma, aparte (#59). */
  function itemHref(id: NavSection): string {
    if (id === 'platform') return '/plataforma';
    const slug = homeTenantSlugSignal.value;
    return slug === null ? '/admin' : adminUrl(slug, id);
  }
  ```
- En `Sidebar`, `const currentView = activeSectionSignal.value;` y el `<button … onClick={() => { navigateTo(item.id); }}>`
  pasa a `<Link key={item.id} href={itemHref(item.id)} onNavigate={() => { mobileMenuOpenSignal.value = false; }} class={…mismo class…}>`
  (y su cierre `</button>` a `</Link>`).

`Header.tsx`: sin cambios de lógica (`selectTenant` ahora navega). `AppShell.tsx`: el import de
`activeViewSignal` pasa a `activeSectionSignal` de `route-state.ts` y la condición
`activeViewSignal.value !== 'platform'` a `activeSectionSignal.value !== 'platform'`.
`ImpersonationModal.tsx`: sin cambios (`impersonateTenant` ahora navega).

- [ ] **Paso 7: el resto de los usos de `activeViewSignal`, `navigateTo` y `setActiveTenant`**

| Archivo | Antes | Después |
|---|---|---|
| `permissions-state.ts` | `import { activeViewSignal, type ActiveNavView }` | `import { navigate, routeSignal } from './route-state.ts';` + `import { adminUrl, type NavSection } from '../routing/admin-routes.ts';` + `profileLoadedSignal` de `auth-state.ts`; `ActiveNavView` → `NavSection` |
| `permissions-state.ts` | el primer `effect` (vista no permitida) | `registerPermissionEffects()` (abajo) |
| `view-loader.ts` | `activeViewSignal.value === view` y `type ActiveNavView` | `activeSectionSignal.value === view` y `type NavSection` (de `route-state.ts` y `admin-routes.ts`) |
| `sales-state.ts` | `activeViewSignal.value === 'sales'` (2 veces), `navigateTo('sales')` | `activeSectionSignal.value === 'sales'`, `goTo({ section: 'sales' })` |
| `users-state.ts`, `platform-state.ts`, `credits-state.ts`, `example-catalog-state.ts` | `activeViewSignal.value === 'x'` | `activeSectionSignal.value === 'x'` |
| `dashboard-drill.ts` | `navigateTo('customers')`, `navigateTo('stock')` | `goTo({ section: 'customers' })`, `goTo({ section: 'stock' })` |
| `StockAlertsCard.tsx`, `CreditsBanner.tsx`, `RestrictedView.tsx`, `ImportWizard.tsx` | `navigateTo('stock' \| 'credits' \| 'customers')` | `goTo({ section: … })` |
| `merchant-onboarding-state.ts` | `setActiveTenant(tenantId)` (2 veces), `navigate('/admin'); navigateTo('dashboard');` | `rememberTenant(tenantId)`, `navigate('/admin');` (la normalización lo lleva al dashboard del recién creado) |
| `link-pages-state.ts` | `setActiveTenant(res.tenantId)`; `window.history.replaceState(null, '', window.location.pathname)` | `rememberTenant(res.tenantId)`; `navigate(window.location.pathname, { replace: true })` |

`credits-state.ts`: `isImpersonatingSignal` sigue viniendo de `auth-state.ts` (cambia su definición, no su nombre).

`registerPermissionEffects` en `permissions-state.ts` (reemplaza el bloque `if (typeof window !== 'undefined') { effect… }`
**solo en su primer effect**; el de la solapa de configuración queda hasta la tarea 3):

```ts
/** Una sección no permitida para el rol vuelve al dashboard; Plataforma sin ser root o soporte, a /admin (#59). */
export function registerPermissionEffects(): () => void {
  return effect(() => {
    const route = routeSignal.value;
    if (route.kind === 'plataforma') {
      if (profileLoadedSignal.value && !isRootOrSupportSignal.value) navigate('/admin', { replace: true });
      return;
    }
    if (route.kind !== 'admin' || route.tenantSlug === null || activeRoleSignal.value === null) return;
    if (!isViewAllowed(route.section)) navigate(adminUrl(route.tenantSlug, 'dashboard'), { replace: true });
  });
}

if (typeof window !== 'undefined') {
  registerPermissionEffects();
  effect(() => {
    if (activeRoleSignal.value !== null && !isSettingsTabAllowed(activeSettingsTabSignal.value)) {
      activeSettingsTabSignal.value = 'appearance';
    }
  });
}
```

- [ ] **Paso 8: correr los tests nuevos**

Run: `pnpm vitest run test/route-state.test.ts test/active-tenant.test.ts test/client-guards.test.ts test/admin-routes.test.ts`
Esperado: PASS.

- [ ] **Paso 9: adaptar los tests existentes**

Reglas mecánicas (cada archivo de la lista):
- `import { activeTenantIdSignal … } from '…/auth-state.ts'` → sacar `activeTenantIdSignal` e importar
  `atTenant` de `./helpers/client-route.ts`.
- `activeTenantIdSignal.value = 'x';` → `atTenant('x');`, **después** de asignar `userTenantsSignal`
  si el test lo asigna. Con `null` → `navigate('/admin');` (de `route-state.ts`).
- `expect(activeTenantIdSignal.value).toBe('x')` → `expect(lastTenantIdSignal.value).toBe('x')`.
- `activeViewSignal.value = v` / `navigateTo(v)` → `atTenant(<slug del test>, <slug de la sección>)` o
  `goTo({ section: v })`; `expect(activeViewSignal.value).toBe(v)` → `expect(activeSectionSignal.value).toBe(v)`.
- `impersonatedTenantIdSignal.value = 'x'` → `impersonationSignal.value = { slug: 'x', fromSlug: null }`;
  `= null` → `impersonationSignal.value = null`.

Archivos: `auth-client-state`, `bulk-client`, `catalog-client`, `credits-client`, `customer-client`,
`dashboard-effects`, `discrepancy-client`, `example-catalog-client`, `import-client`, `link-pages`,
`merchant-onboarding`, `permissions-client`, `platform-client`, `registers-client`, `sales-client`,
`settings-client`, `stock-client`, `users-client`, `view-loader`, `app-shell-and-navigation`.

Casos que no son mecánicos:
- `route-and-landing.test.ts`: `canonicalPath` → `canonicalUrl` (`canonicalUrl({ pathname: '/onboarding', search: '' })` es `'/alta'`;
  `'/alta'` da `undefined`); `routeSignal.value` → `routeSignal.value.kind`; agregar `['/plataforma', 'plataforma']` a la tabla.
- `app-shell-and-navigation.test.ts`: el bloque "Navegación reactiva" pasa a probar `goTo` y
  `activeSectionSignal` (empezar con `atTenant('t1')`); los bloques de impersonación usan
  `impersonateTenant('…')` con un usuario root en `currentUserSignal` y miran `isImpersonatingSignal`
  y `effectiveTenantIdSignal`; "Salir" con `stopImpersonation()`.
- `auth-client-state.test.ts`: `setActiveTenant('x')` → `atTenant('x')`; el test de `selectTenant` (#45)
  sigue igual en su expectativa (el nombre devuelto) y además verifica la URL; el que esperaba que
  `fetchProfile` eligiera el primer comercio pasa a esperar `profileLoadedSignal.value === true` (la
  elección del primero la hace `registerTenantRouteEffects`, ya probada en `active-tenant.test.ts`).
- `view-loader.test.ts`: cambiar de pantalla con `atTenant('a', 'catalogo')` / `atTenant('a', 'stock')`
  y de comercio con `atTenant('b', 'dashboard')`; el resto de las expectativas no cambia.
- `merchant-onboarding.test.ts`: lo que esperaba `activeViewSignal 'dashboard'` pasa a
  `expect(locationSignal.value.pathname).toBe('/admin')` y `lastTenantIdSignal.value` el comercio nuevo.

Run: `pnpm test`
Esperado: PASS.

- [ ] **Paso 10: e2e**

En `e2e/roles-invitations.spec.ts` y `e2e/sales-cash.spec.ts`, los ítems del menú pasan de botón a link:
`getByRole('button', { name: 'Usuarios' })` → `getByRole('link', { name: 'Usuarios' })`, igual
`'Ventas & Caja'`, `'Dashboard'`, `'Catálogo & Precios'`, `'Operaciones Masivas'` (en
`toBeVisible`/`toHaveCount(0)` también). El `addInitScript` con `mini_erp_tenant_id` sigue sirviendo:
es el último usado y `/admin` va a ese comercio.

Run: `pnpm test:e2e`
Esperado: PASS.

- [ ] **Paso 11: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test e2e
git commit -m "feat: sección y comercio activo en la URL del admin (#59)"
```

Frenar: revisión de la tarea 2. Prueba rápida sugerida: `/admin` lleva al último comercio, el menú
cambia la URL, atrás y adelante, Ctrl+clic en el menú abre otra pestaña en esa pantalla, un slug
ajeno muestra "No tenés acceso".

---

### Tarea 3: Solapas en la URL

**Archivos:**
- Modificar: `src/client/state/{sales,settings,bulk,credits,platform,permissions}-state.ts`,
  `src/client/components/sales/SalesTabs.tsx`, `src/client/components/settings/SettingsTabs.tsx`,
  `src/client/components/bulk/BulkTabs.tsx`, `src/client/components/credits/CreditsView.tsx`,
  `src/client/components/platform/PlatformView.tsx`
- Test: `test/tabs-route.test.ts` (nuevo); adaptar `sales-client`, `settings-client`, `permissions-client`,
  `credits-client`, `platform-client`, `bulk-client` donde escriban signals de solapa.

**Interfaces:**
- Consume: `TabId`, `PLATFORM_TABS`, `routeSignal`, `goTo`, `tabUrl`, `navigate`, `adminUrl`.
- Produce: los signals de solapa son `ReadonlySignal` (`salesTabSignal`, `activeSettingsTabSignal`,
  `activeBulkTabSignal`, `creditsTabSignal`, `platformTabSignal`); los tipos de solapa salen de
  `admin-routes.ts`: `SalesTab = TabId<'sales'>`, `SettingsTab = TabId<'settings'>`,
  `BulkTab = TabId<'bulk'>`, `CreditsTab = TabId<'credits'>`, `PlatformTab = PlatformTabId`.
  Helper nuevo en `route-state.ts`:

```ts
/** La solapa de la URL si la pantalla activa es esa sección; si no, `first`. Reactiva. */
export function routeTab<S extends TenantSection>(section: S, tabs: readonly TabId<S>[], first: TabId<S>): TabId<S>;
```

- [ ] **Paso 1: el test que falla**

```ts
// test/tabs-route.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setHistoryForTests, locationSignal } from '../src/client/state/route-state.ts';
import { atTenant } from './helpers/client-route.ts';
import { salesTabSignal, setTab } from '../src/client/state/sales-state.ts';
import { activeSettingsTabSignal } from '../src/client/state/settings-state.ts';
import { activeBulkTabSignal } from '../src/client/state/bulk-state.ts';
import { creditsTabSignal } from '../src/client/state/credits-state.ts';
import { registerPermissionEffects } from '../src/client/state/permissions-state.ts';

describe('Solapas en la URL (#59)', () => {
  beforeEach(() => { setHistoryForTests(null); });

  it('cada solapa sale de la URL', () => {
    atTenant('k', 'ventas/cobranzas');
    expect(salesTabSignal.value).toBe('payments');
    atTenant('k', 'configuracion/sucursales');
    expect(activeSettingsTabSignal.value).toBe('branches');
    atTenant('k', 'masivas/archivos');
    expect(activeBulkTabSignal.value).toBe('io');
    atTenant('k', 'uso-y-pagos/regalados');
    expect(creditsTabSignal.value).toBe('gifts');
    atTenant('k', 'dashboard');
    expect(salesTabSignal.value).toBe('sales');
  });

  it('cambiar de solapa en ventas cambia la URL', () => {
    atTenant('k', 'ventas');
    setTab('summary');
    expect(locationSignal.value.pathname).toBe('/admin/k/ventas/resumen');
  });

  it('una solapa de configuración no permitida va a Apariencia', () => {
    atTenant('k-member', 'configuracion/sucursales', 'member');
    const dispose = registerPermissionEffects();
    expect(locationSignal.value.pathname).toBe('/admin/k-member/configuracion/apariencia');
    dispose();
  });
});
```

- [ ] **Paso 2: verlo fallar** — `pnpm vitest run test/tabs-route.test.ts` (FAIL: los signals de solapa son de escritura y no leen la URL).

- [ ] **Paso 3: implementar**

`route-state.ts`, agregar:

```ts
/** La solapa de la URL si la pantalla activa es esa sección; si no (o si no es una de `tabs`), `first`. Reactiva. */
export function routeTab<S extends TenantSection>(section: S, tabs: readonly TabId<S>[], first: TabId<S>): TabId<S> {
  const route = routeSignal.value;
  const current = route.kind === 'admin' && route.section === section ? tabs.find((t) => t === route.tab) : undefined;
  return current ?? first;
}
```

Por store (el `signal` de solapa pasa a `computed`):

```ts
// sales-state.ts
export type SalesTab = TabId<'sales'>;
const SALES_TABS: readonly SalesTab[] = ['sales', 'payments', 'movements', 'summary'];
export const salesTabSignal = computed<SalesTab>(() => routeTab('sales', SALES_TABS, 'sales'));
export function setTab(tab: SalesTab): void {
  goTo({ section: 'sales', tab });
  pageSignal.value = 1;
}
// openSalesWith: `salesTabSignal.value = 'sales'` se va y `goTo({ section: 'sales' })` queda al final (ya está).

// settings-state.ts
export type SettingsTab = TabId<'settings'>;
const SETTINGS_TABS: readonly SettingsTab[] = ['pos', 'branches', 'connection', 'account', 'appearance'];
export const activeSettingsTabSignal = computed<SettingsTab>(() => routeTab('settings', SETTINGS_TABS, 'pos'));

// bulk-state.ts
export type BulkTab = TabId<'bulk'>;
const BULK_TABS: readonly BulkTab[] = ['prices', 'interests', 'io'];
export const activeBulkTabSignal = computed<BulkTab>(() => routeTab('bulk', BULK_TABS, 'prices'));

// credits-state.ts
export type CreditsTab = TabId<'credits'>;
const CREDITS_TABS: readonly CreditsTab[] = ['charges', 'movements', 'gifts'];
export const creditsTabSignal = computed<CreditsTab>(() => routeTab('credits', CREDITS_TABS, 'charges'));

// platform-state.ts
export type PlatformTab = PlatformTabId;
export const platformTabSignal = computed<PlatformTab>(() => {
  const route = routeSignal.value;
  return route.kind === 'plataforma' ? route.tab : 'payments';
});
```

`permissions-state.ts`: el `effect` de la solapa de configuración se va; `registerPermissionEffects`
suma, después del chequeo de sección:

```ts
    if (route.section === 'settings' && !isSettingsTabAllowed(activeSettingsTabSignal.value)) {
      navigate(adminUrl(route.tenantSlug, 'settings', { tab: 'appearance' }), { replace: true });
    }
```

Componentes: cada botón de solapa pasa a `<Link>` con el mismo `class`, `role` y `aria-selected` que
tenía, sin `onClick`:
- `SalesTabs.tsx`: `href={tabUrl('sales', t.id)}` (con `setTab` solo para el test y el drill).
- `SettingsTabs.tsx`: `href={tabUrl('settings', t.id)}`.
- `BulkTabs.tsx`: `href={tabUrl('bulk', t.id)}`.
- `CreditsView.tsx` (línea ~290): `href={tabUrl('credits', t.id)}`.
- `PlatformView.tsx` (línea ~27): `href={buildUrl({ kind: 'plataforma', tab: t.id })}`.

En los tests existentes, `xTabSignal.value = 'y'` pasa a `atTenant(<slug>, '<sección>/<solapa>')` (o
`navigate('/plataforma/configuracion')` en plataforma).

- [ ] **Paso 4: correr** `pnpm vitest run test/tabs-route.test.ts` → PASS; `pnpm test` → PASS.

- [ ] **Paso 5: e2e** — `sales-cash.spec.ts` usa `getByRole('tab', { name: 'Cobranzas' })`: el `<a role="tab">` lo sigue cumpliendo. `pnpm test:e2e` → PASS.

- [ ] **Paso 6: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test e2e
git commit -m "feat: solapas de ventas, configuración, masivas, uso y pagos y plataforma en la URL (#59)"
```

Frenar: revisión de la tarea 3.

---

### Tarea 4: `createSignalQuery` reactivo, claves, invalidación y borrado de caché

**Archivos:**
- Modificar: `src/client/api/query-client.ts` (reescrito)
- Crear: `src/client/state/query-keys.ts`, `src/client/state/invalidation.ts`
- Tests: `test/signal-query.test.ts`, `test/tenant-query.test.ts`, `test/invalidation.test.ts`;
  sumar un caso a `test/client-guards.test.ts`

**Interfaces que produce:**

```ts
// api/query-client.ts
export const queryClient: QueryClient;
export function shouldRetry(failureCount: number, error: unknown): boolean;
export type QuerySource<T> = { key: QueryKey; fn: () => Promise<T> };
export type SignalQueryOptions<T> = {
  source: () => QuerySource<T> | null;
  enabled?: (() => boolean) | undefined;
  refetchInterval?: number | undefined;
  keepPrevious?: ((previousKey: QueryKey, nextKey: QueryKey) => boolean) | undefined;
  onError?: ((error: Error) => void) | undefined;
};
export type SignalQuery<T> = {
  data: ReadonlySignal<T | undefined>; isLoading: ReadonlySignal<boolean>; error: ReadonlySignal<Error | null>;
  refetch: () => Promise<void>; setData: (update: (previous: T | undefined) => T | undefined) => void; dispose: () => void;
};
export function createSignalQuery<T>(options: SignalQueryOptions<T>): SignalQuery<T>;
// state/query-keys.ts
export type TenantDomain = 'products' | 'categories' | 'stock' | 'kardex' | 'branches' | 'customers' | 'customer-movements'
  | 'discrepancies' | 'dashboard' | 'sales' | 'registers' | 'pos-registers' | 'billing-status' | 'credits' | 'users' | 'audit' | 'example-catalog';
export function tenantKey(tenantId: string, domain: TenantDomain, ...params: readonly unknown[]): QueryKey;
export function platformKey(name: 'payments' | 'settings'): QueryKey;
export function createTenantQuery<T>(o: { domain: TenantDomain; enabled?: (() => boolean) | undefined; refetchInterval?: number | undefined; onError?: ((e: Error) => void) | undefined; fn: (ctx: { tenantId: string; token: string }) => Promise<T> }): SignalQuery<T>;
export function createTenantParamQuery<T, P extends readonly unknown[]>(o: { domain: TenantDomain; params: () => P | null; enabled?: …; refetchInterval?: …; onError?: …; fn: (ctx: { tenantId: string; token: string; params: P }) => Promise<T> }): SignalQuery<T>;
export function removeOtherTenants(tenantId: string): void;
export function registerCacheEffects(): () => void;
// state/invalidation.ts
export type MutationEvent = 'product-saved' | 'stock-adjusted' | 'customer-saved' | 'customer-payment' | 'balance-adjusted'
  | 'bulk-prices' | 'bulk-interests' | 'products-imported' | 'customers-imported' | 'branch-saved' | 'register-changed'
  | 'discrepancy-dismissed' | 'users-changed' | 'platform-changed';
export const INVALIDATES: Record<MutationEvent, readonly (TenantDomain | 'platform')[]>;
export function invalidateAfter(event: MutationEvent): Promise<void>;
```

- [ ] **Paso 1: los tests que fallan**

```ts
// test/signal-query.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@preact/signals';
import type { QueryKey } from '@tanstack/query-core';
import { createSignalQuery, queryClient, shouldRetry } from '../src/client/api/query-client.ts';
import { ApiError } from '../src/client/api/client.ts';

const sameTenant = (a: QueryKey, b: QueryKey): boolean => a[1] === b[1];

describe('createSignalQuery (#59)', () => {
  beforeEach(() => { queryClient.clear(); });

  it('no pide deshabilitada; pide al habilitarse', async () => {
    const on = signal(false);
    const fn = vi.fn(() => Promise.resolve(['a']));
    const q = createSignalQuery({ source: () => ({ key: ['x'], fn }), enabled: () => on.value });
    expect(fn).not.toHaveBeenCalled();
    expect(q.isLoading.value).toBe(false);
    on.value = true;
    expect(q.isLoading.value).toBe(true);
    await vi.waitFor(() => { expect(q.data.value).toEqual(['a']); });
    expect(fn).toHaveBeenCalledTimes(1);
    q.dispose();
  });

  it('al volver a la pantalla muestra la caché al toque y refresca', async () => {
    const on = signal(true);
    const fn = vi.fn(() => Promise.resolve(['a']));
    const q = createSignalQuery({ source: () => ({ key: ['x'], fn }), enabled: () => on.value });
    await vi.waitFor(() => { expect(q.data.value).toEqual(['a']); });
    on.value = false;
    fn.mockImplementation(() => Promise.resolve(['b']));
    on.value = true;
    expect(q.data.value).toEqual(['a']);
    expect(q.isLoading.value).toBe(false);
    await vi.waitFor(() => { expect(q.data.value).toEqual(['b']); });
    q.dispose();
  });

  it('entre filtros del mismo comercio ve el dato anterior; entre comercios, nunca', async () => {
    const key = signal<QueryKey>(['t', 'A', 'p', 1]);
    let release: (value: string) => void = () => undefined;
    const q = createSignalQuery<string>({
      source: () => ({ key: key.value, fn: () => new Promise<string>((resolve) => { release = resolve; }) }),
      keepPrevious: sameTenant,
    });
    release('A1');
    await vi.waitFor(() => { expect(q.data.value).toBe('A1'); });
    key.value = ['t', 'A', 'p', 2];
    expect(q.data.value).toBe('A1');
    release('A2');
    await vi.waitFor(() => { expect(q.data.value).toBe('A2'); });
    key.value = ['t', 'B', 'p', 1];
    expect(q.data.value).toBeUndefined();
    q.dispose();
  });

  it('sin fuente no hay datos ni pedido', () => {
    const fn = vi.fn(() => Promise.resolve(1));
    const q = createSignalQuery({ source: () => null });
    expect(q.data.value).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    q.dispose();
  });

  it('setData escribe en la clave actual, aunque esté deshabilitada', () => {
    const q = createSignalQuery<number[]>({ source: () => ({ key: ['x'], fn: () => Promise.resolve([]) }), enabled: () => false });
    q.setData(() => [1, 2]);
    expect(q.data.value).toEqual([1, 2]);
    expect(queryClient.getQueryData(['x'])).toEqual([1, 2]);
    q.dispose();
  });

  it('avisa cada error una vez', async () => {
    const onError = vi.fn();
    const q = createSignalQuery({ source: () => ({ key: ['x'], fn: () => Promise.reject(new ApiError(404, 'No está')) }), onError });
    await vi.waitFor(() => { expect(q.error.value?.message).toBe('No está'); });
    expect(onError).toHaveBeenCalledTimes(1);
    q.dispose();
  });

  it('no reintenta un 4xx; la red o un 5xx, una vez', () => {
    expect(shouldRetry(0, new ApiError(404, 'x'))).toBe(false);
    expect(shouldRetry(0, new ApiError(503, 'x'))).toBe(true);
    expect(shouldRetry(0, new TypeError('red'))).toBe(true);
    expect(shouldRetry(1, new TypeError('red'))).toBe(false);
  });
});
```

```ts
// test/tenant-query.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { queryClient } from '../src/client/api/query-client.ts';
import { createTenantQuery, removeOtherTenants, tenantKey } from '../src/client/state/query-keys.ts';
import { logout, tokenSignal } from '../src/client/state/auth-state.ts';
import { setHistoryForTests } from '../src/client/state/route-state.ts';
import { atTenant } from './helpers/client-route.ts';

describe('Consultas del comercio activo (#59)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    logout();
    tokenSignal.value = 'tok';
  });

  it('la clave lleva el comercio y el pedido recibe comercio y token', async () => {
    const fn = vi.fn(({ tenantId }: { tenantId: string; token: string }) => Promise.resolve(`datos de ${tenantId}`));
    atTenant('kiosco');
    const q = createTenantQuery({ domain: 'products', fn });
    await vi.waitFor(() => { expect(q.data.value).toBe('datos de kiosco'); });
    expect(fn).toHaveBeenCalledWith({ tenantId: 'kiosco', token: 'tok' });
    expect(queryClient.getQueryData(tenantKey('kiosco', 'products'))).toBe('datos de kiosco');
    atTenant('almacen');
    expect(q.data.value).toBeUndefined();
    q.dispose();
  });

  it('sin sesión no hay consulta, y cerrar la sesión borra la caché', () => {
    atTenant('kiosco');
    queryClient.setQueryData(tenantKey('kiosco', 'products'), [1]);
    logout();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('removeOtherTenants deja solo el comercio activo', () => {
    queryClient.setQueryData(tenantKey('kiosco', 'products'), [1]);
    queryClient.setQueryData(tenantKey('almacen', 'products'), [2]);
    queryClient.setQueryData(['platform', 'payments'], [3]);
    removeOtherTenants('kiosco');
    expect(queryClient.getQueryData(tenantKey('almacen', 'products'))).toBeUndefined();
    expect(queryClient.getQueryData(tenantKey('kiosco', 'products'))).toEqual([1]);
    expect(queryClient.getQueryData(['platform', 'payments'])).toEqual([3]);
  });
});
```

```ts
// test/invalidation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { queryClient } from '../src/client/api/query-client.ts';
import { INVALIDATES, invalidateAfter, type MutationEvent } from '../src/client/state/invalidation.ts';
import { tenantKey, type TenantDomain } from '../src/client/state/query-keys.ts';

const DOMAINS: TenantDomain[] = ['products', 'categories', 'stock', 'kardex', 'branches', 'customers', 'customer-movements',
  'discrepancies', 'dashboard', 'sales', 'registers', 'pos-registers', 'billing-status', 'credits', 'users', 'audit', 'example-catalog'];

describe('Tabla de invalidación (#59)', () => {
  beforeEach(() => {
    queryClient.clear();
    for (const d of DOMAINS) queryClient.setQueryData(tenantKey('k', d, 'algo'), 1);
    queryClient.setQueryData(['platform', 'payments'], 1);
  });

  const events = Object.keys(INVALIDATES).filter((e): e is MutationEvent => e in INVALIDATES);
  it.each(events)('%s invalida exactamente sus dominios', async (event) => {
    await invalidateAfter(event);
    const expected = new Set<string>(INVALIDATES[event]);
    for (const d of DOMAINS) {
      expect(queryClient.getQueryState(tenantKey('k', d, 'algo'))?.isInvalidated, `${event} → ${d}`).toBe(expected.has(d));
    }
    expect(queryClient.getQueryState(['platform', 'payments'])?.isInvalidated).toBe(expected.has('platform'));
  });

  it('la cobranza del admin refresca clientes, su extracto, ventas, dashboard y discrepancias', () => {
    expect(INVALIDATES['customer-payment']).toEqual(['customers', 'customer-movements', 'sales', 'dashboard', 'discrepancies']);
  });
});
```

En `test/client-guards.test.ts`, sumar:

```ts
  it('solo query-client crea el QueryClient y los observers', () => {
    const offenders = files.filter((f) => f !== 'api/query-client.ts' && /new (QueryClient|QueryObserver)\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });
```

- [ ] **Paso 2: verlos fallar** — `pnpm vitest run test/signal-query.test.ts test/tenant-query.test.ts test/invalidation.test.ts` (FAIL).

- [ ] **Paso 3: `api/query-client.ts`**

```ts
// src/client/api/query-client.ts
import { QueryClient, QueryObserver, notifyManager, type QueryKey, type QueryObserverResult } from '@tanstack/query-core';
import { effect, signal, type ReadonlySignal } from '@preact/signals';
import { ApiError } from './client.ts';

// Las novedades de la caché llegan en el momento: los signals se actualizan sin esperar un tick (#59)
notifyManager.setScheduler((callback) => {
  callback();
});

/** Un 4xx no se arregla reintentando; un error de red o un 5xx, una vez. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 1;
}

/** Caché al toque y refresco en segundo plano: al entrar a una pantalla y al volver a la pestaña (#59). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 0, refetchOnWindowFocus: true, retry: shouldRetry },
  },
});

export type QuerySource<T> = { key: QueryKey; fn: () => Promise<T> };

export type SignalQueryOptions<T> = {
  /** La clave y el pedido; `null` sin sesión o sin comercio. Reactiva. */
  source: () => QuerySource<T> | null;
  /** Si la pantalla que la usa está activa. Reactiva. Deshabilitada, igual ve la caché de su clave. */
  enabled?: (() => boolean) | undefined;
  refetchInterval?: number | undefined;
  /** Si al cambiar de clave se sigue viendo el dato anterior mientras llega el nuevo. */
  keepPrevious?: ((previousKey: QueryKey, nextKey: QueryKey) => boolean) | undefined;
  onError?: ((error: Error) => void) | undefined;
};

export type SignalQuery<T> = {
  data: ReadonlySignal<T | undefined>;
  /** La primera carga, sin datos: el "Cargando" de las pantallas. */
  isLoading: ReadonlySignal<boolean>;
  error: ReadonlySignal<Error | null>;
  refetch: () => Promise<void>;
  setData: (update: (previous: T | undefined) => T | undefined) => void;
  dispose: () => void;
};

const IDLE_KEY: QueryKey = ['idle'];

/** Una consulta de TanStack Query expuesta como signals, sin hooks (#59). */
export function createSignalQuery<T>(options: SignalQueryOptions<T>): SignalQuery<T> {
  const data = signal<T | undefined>(undefined);
  const isLoading = signal(false);
  const error = signal<Error | null>(null);
  let key: QueryKey | null = null;
  let lastError: Error | null = null;

  const observer = new QueryObserver<T, Error>(queryClient, { queryKey: IDLE_KEY, enabled: false });

  const publish = (result: QueryObserverResult<T, Error>): void => {
    data.value = key === null ? undefined : result.data;
    isLoading.value = key !== null && result.isLoading;
    error.value = key === null ? null : result.error;
    if (key !== null && result.error !== null && result.error !== lastError) {
      lastError = result.error;
      options.onError?.(result.error);
    }
  };

  const unsubscribe = observer.subscribe(publish);

  const stop = effect(() => {
    const source = options.source();
    const enabled = source !== null && (options.enabled?.() ?? true);
    key = source?.key ?? null;
    observer.setOptions({
      queryKey: source?.key ?? IDLE_KEY,
      queryFn: source?.fn ?? (() => Promise.reject(new Error('Consulta deshabilitada'))),
      enabled,
      refetchInterval: options.refetchInterval ?? false,
      placeholderData: (previous, previousQuery) =>
        source !== null && previousQuery !== undefined && options.keepPrevious?.(previousQuery.queryKey, source.key) === true ? previous : undefined,
    });
    publish(observer.getCurrentResult());
  });

  return {
    data,
    isLoading,
    error,
    refetch: async () => {
      if (key !== null) await observer.refetch();
    },
    setData: (update) => {
      if (key !== null) queryClient.setQueryData<T>(key, update);
    },
    dispose: () => {
      stop();
      unsubscribe();
    },
  };
}
```

- [ ] **Paso 4: `state/query-keys.ts`**

```ts
// src/client/state/query-keys.ts
import { effect } from '@preact/signals';
import type { QueryKey } from '@tanstack/query-core';
import { createSignalQuery, queryClient, type SignalQuery } from '../api/query-client.ts';
import { effectiveTenantIdSignal, tokenSignal } from './auth-state.ts';

/**
 * Claves de la caché (#59): `['t', comercio, dominio, …parámetros]` y `['platform', nombre]`. El
 * dominio es lo que invalida una mutación (`invalidation.ts`).
 */
export type TenantDomain =
  | 'products' | 'categories' | 'stock' | 'kardex' | 'branches' | 'customers' | 'customer-movements'
  | 'discrepancies' | 'dashboard' | 'sales' | 'registers' | 'pos-registers' | 'billing-status' | 'credits'
  | 'users' | 'audit' | 'example-catalog';

export function tenantKey(tenantId: string, domain: TenantDomain, ...params: readonly unknown[]): QueryKey {
  return ['t', tenantId, domain, ...params];
}

export function platformKey(name: 'payments' | 'settings'): QueryKey {
  return ['platform', name];
}

const sameTenant = (previous: QueryKey, next: QueryKey): boolean => previous[0] === 't' && next[0] === 't' && previous[1] === next[1];

type CommonOptions = {
  domain: TenantDomain;
  enabled?: (() => boolean) | undefined;
  refetchInterval?: number | undefined;
  onError?: ((error: Error) => void) | undefined;
};

/** Una consulta del comercio activo con parámetros; `params` en `null` la deja sin clave (un drawer cerrado). */
export function createTenantParamQuery<T, P extends readonly unknown[]>(
  o: CommonOptions & { params: () => P | null; fn: (ctx: { tenantId: string; token: string; params: P }) => Promise<T> },
): SignalQuery<T> {
  return createSignalQuery<T>({
    source: () => {
      const tenantId = effectiveTenantIdSignal.value;
      const token = tokenSignal.value;
      const params = o.params();
      if (tenantId === null || !token || params === null) return null;
      return { key: tenantKey(tenantId, o.domain, ...params), fn: () => o.fn({ tenantId, token, params }) };
    },
    enabled: o.enabled,
    refetchInterval: o.refetchInterval,
    onError: o.onError,
    keepPrevious: sameTenant,
  });
}

export function createTenantQuery<T>(o: CommonOptions & { fn: (ctx: { tenantId: string; token: string }) => Promise<T> }): SignalQuery<T> {
  return createTenantParamQuery<T, readonly []>({ ...o, params: () => [] });
}

/** Saca de la caché lo de otros comercios: nunca se ve un dato de otro comercio, y no crece. */
export function removeOtherTenants(tenantId: string): void {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] === 't' && q.queryKey[1] !== tenantId });
}

/**
 * Al cambiar de comercio, se borra lo de los otros. Va en una microtarea: para entonces las consultas
 * ya cambiaron de clave y las viejas no tienen observers. La caché por sesión la borra `auth-state`.
 */
export function registerCacheEffects(): () => void {
  return effect(() => {
    const tenantId = effectiveTenantIdSignal.value;
    if (tenantId !== null) {
      queueMicrotask(() => {
        removeOtherTenants(tenantId);
      });
    }
  });
}

if (typeof window !== 'undefined') {
  registerCacheEffects();
}
```

- [ ] **Paso 5: `state/invalidation.ts`**

```ts
// src/client/state/invalidation.ts
import { queryClient } from '../api/query-client.ts';
import type { TenantDomain } from './query-keys.ts';

/** Qué pantallas quedan viejas después de cada mutación del admin (#59). Una sola tabla. */
export type MutationEvent =
  | 'product-saved' | 'stock-adjusted' | 'customer-saved' | 'customer-payment' | 'balance-adjusted'
  | 'bulk-prices' | 'bulk-interests' | 'products-imported' | 'customers-imported' | 'branch-saved'
  | 'register-changed' | 'discrepancy-dismissed' | 'users-changed' | 'platform-changed';

type Domain = TenantDomain | 'platform';

export const INVALIDATES: Record<MutationEvent, readonly Domain[]> = {
  'product-saved': ['products', 'categories', 'stock', 'dashboard', 'example-catalog'],
  'stock-adjusted': ['stock', 'products', 'kardex', 'dashboard'],
  'customer-saved': ['customers', 'discrepancies', 'dashboard'],
  'customer-payment': ['customers', 'customer-movements', 'sales', 'dashboard', 'discrepancies'],
  'balance-adjusted': ['customers', 'customer-movements', 'dashboard'],
  'bulk-prices': ['products', 'dashboard'],
  'bulk-interests': ['customers', 'customer-movements', 'dashboard'],
  'products-imported': ['products', 'categories', 'stock', 'kardex', 'dashboard', 'example-catalog'],
  'customers-imported': ['customers', 'customer-movements', 'discrepancies', 'dashboard'],
  'branch-saved': ['branches', 'stock', 'dashboard'],
  'register-changed': ['pos-registers', 'registers', 'billing-status'],
  'discrepancy-dismissed': ['discrepancies', 'customers'],
  'users-changed': ['users', 'audit'],
  'platform-changed': ['platform', 'billing-status', 'credits'],
};

/**
 * Marca viejos los dominios del evento en todos los comercios de la caché (solo se piden los que
 * están en pantalla). Se espera para que quien quiera leer el dato nuevo lo tenga.
 */
export async function invalidateAfter(event: MutationEvent): Promise<void> {
  const domains = INVALIDATES[event];
  await queryClient.invalidateQueries({
    predicate: (q) => {
      const [scope, , domain] = q.queryKey;
      if (scope === 'platform') return domains.includes('platform');
      return scope === 't' && domains.some((d) => d === domain);
    },
  });
}
```

- [ ] **Paso 6: correr** `pnpm vitest run test/signal-query.test.ts test/tenant-query.test.ts test/invalidation.test.ts test/client-guards.test.ts` → PASS.

> Si `placeholderData` no tipa con `(previous, previousQuery)`, revisar la firma en
> `node_modules/@tanstack/query-core/build/modern/hydration-*.d.ts` (`PlaceholderDataFunction`) y
> anotar los parámetros con esos tipos; no usar `as`.

- [ ] **Paso 7: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add src/client/api/query-client.ts src/client/state/query-keys.ts src/client/state/invalidation.ts test/signal-query.test.ts test/tenant-query.test.ts test/invalidation.test.ts test/client-guards.test.ts
git commit -m "feat: consultas reactivas con TanStack Query, claves por comercio e invalidación (#59)"
```

Frenar: revisión de la tarea 4.

---

### Patrón de migración de un store (tareas 5 a 13)

Lo mismo en cada store, para no repetirlo en cada tarea:

1. **Los datos** pasan a una consulta (`createTenantQuery`/`createTenantParamQuery`) habilitada con su
   sección (`enabled: () => inSection('catalog')`). El signal exportado mantiene su nombre como
   `computed`: `export const productsSignal = computed(() => productsQuery.data.value ?? []);`. El de
   carga es `productsQuery.isLoading`. Un error de carga que hoy hace `showToast` pasa a `onError` con
   el mismo texto.
2. **Lo que el store escribía a mano** en la lista (`productsSignal.value = …`) pasa a
   `productsQuery.setData((prev) => …(prev ?? []))`.
3. **Las funciones `fetchX()`** que usan los botones "Actualizar" quedan con su nombre y hacen
   `await xQuery.refetch()`.
4. **Cada mutación**, al terminar bien, hace `await invalidateAfter('<evento>')` (o `void` si no
   espera nada después).
5. **Los filtros**: `xFiltersSignal = computed(() => routeFilters('<sección>'))`, los signals de cada
   filtro son `computed` sobre ese, y los componentes escriben con `setXFilters(patch)` =
   `setFilters('<sección>', patch)`. Un filtrado en memoria pasa a una función pura exportada
   (`filterProducts(items, filters)`) que el `computed` usa y los tests prueban directo.
6. **El `effect` de carga** del final del archivo se borra.
7. **Tests**: en `beforeEach`, `setHistoryForTests(null)`, `queryClient.clear()`, `tokenSignal.value = 'tok'`,
   `atTenant('<slug>')` (en el dashboard: las consultas de la pantalla no se habilitan solas) y los datos
   de partida con `queryClient.setQueryData(tenantKey('<slug>', '<dominio>'), …)`. Para probar la
   carga, `vi.mock` de `apiFetch` (como `dashboard-effects.test.ts`) y `atTenant('<slug>', '<sección>')`.
   Para probar una mutación, después mirar `queryClient.getQueryState(tenantKey(…))?.isInvalidated`.

---

### Tarea 5: Catálogo (y las consultas compartidas de categorías y stock)

**Archivos:**
- Crear: `src/client/state/shared-queries.ts`
- Modificar: `src/client/state/catalog-state.ts`, `src/client/components/catalog/CatalogToolbar.tsx`
- Test: `test/catalog-client.test.ts` (adaptado y ampliado)

**Interfaces:**
- Consume: `createTenantQuery`, `inSection`, `routeFilters`, `setFilters`, `invalidateAfter`, `CatalogFilters`.
- Produce: `categoriesQuery`, `stockMatrixQuery` (en `shared-queries.ts`); en `catalog-state.ts`:
  `catalogFiltersSignal`, `setCatalogFilters(patch: Partial<CatalogFilters>): void`,
  `filterProducts(products: ProductItem[], filters: CatalogFilters): ProductItem[]`; el resto de los
  nombres exportados igual. Se borra el tipo `StockMatrixItem` de `catalog-state.ts` (tenía
  `totalQuantity`, que el servidor no manda: la columna de stock del catálogo salía vacía).

- [ ] **Paso 1: tests que fallan** (agregar a `test/catalog-client.test.ts` y adaptar su `beforeEach`)

```ts
// imports nuevos
import { vi } from 'vitest';
import { queryClient } from '../src/client/api/query-client.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { locationSignal, setHistoryForTests } from '../src/client/state/route-state.ts';
import { atTenant } from './helpers/client-route.ts';
import { filterProducts, setCatalogFilters, catalogFiltersSignal } from '../src/client/state/catalog-state.ts';

// beforeEach (reemplaza las asignaciones a productsSignal, categoriesSignal, stockMapSignal y filtros):
setHistoryForTests(null);
queryClient.clear();
tokenSignal.value = 'mock-token';
userTenantsSignal.value = [{ tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' }];
atTenant('tienda-test');
queryClient.setQueryData(tenantKey('tienda-test', 'products'), [mockProductA, mockProductB, mockProductC]);
queryClient.setQueryData(tenantKey('tienda-test', 'categories'), ['Bebidas', 'Golosinas']);
queryClient.setQueryData(tenantKey('tienda-test', 'stock'), [
  { productId: 'prod-1', sku: 'COCA-500', name: 'Coca Cola 500ml', category: 'Bebidas', tracksStock: true, totalStock: 24, branches: {}, updatedAt: '' },
  { productId: 'prod-2', sku: 'ALF-JOR', name: 'Alfajor Triple', category: 'Golosinas', tracksStock: true, totalStock: 0, branches: {}, updatedAt: '' },
]);

describe('Catálogo con URL y caché (#59)', () => {
  it('el stock del catálogo sale de totalStock', () => {
    expect(stockMapSignal.value).toEqual({ 'prod-1': 24, 'prod-2': 0 });
  });

  it('los filtros salen de la URL y se escriben en ella', () => {
    atTenant('tienda-test', 'catalogo?q=coca&estado=activos');
    expect(catalogFiltersSignal.value).toEqual({ q: 'coca', category: 'all', blocked: 'active' });
    expect(filteredProductsSignal.value.map((p) => p.id)).toEqual(['prod-1']);
    setCatalogFilters({ category: 'Bebidas' });
    expect(locationSignal.value.search).toBe('?q=coca&categoria=Bebidas&estado=activos');
  });

  it('al entrar a Catálogo pide productos, categorías y stock', async () => {
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string) => {
      urls.push(url);
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    try {
      atTenant('tienda-test', 'catalogo');
      await vi.waitFor(() => { expect(urls).toHaveLength(3); });
      expect(urls.sort()).toEqual(['/api/tenants/tienda-test/categories', '/api/tenants/tienda-test/products', '/api/tenants/tienda-test/stock']);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('guardar un producto deja viejos catálogo, stock, categorías y dashboard', async () => {
    queryClient.setQueryData(tenantKey('tienda-test', 'dashboard', 'week', ''), {});
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ...mockProductA, price: 1850 }), { status: 200, headers: { 'content-type': 'application/json' } })));
    try {
      await saveInlineEdit('prod-1', 'price', '1850');
      for (const domain of ['products', 'stock', 'categories'] as const) {
        expect(queryClient.getQueryState(tenantKey('tienda-test', domain))?.isInvalidated, domain).toBe(true);
      }
      expect(queryClient.getQueryState(tenantKey('tienda-test', 'dashboard', 'week', ''))?.isInvalidated).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
```

Los tests de "Filtros y Búsqueda en Memoria" pasan a `filterProducts(products, filtros)` con filtros
armados a mano (`{ q: 'coca', category: 'all', blocked: 'all' }`), con las mismas expectativas.

- [ ] **Paso 2: verlos fallar** — `pnpm vitest run test/catalog-client.test.ts`.

- [ ] **Paso 3: `shared-queries.ts`**

```ts
// src/client/state/shared-queries.ts
import { apiFetch } from '../api/client.ts';
import { inSection } from './route-state.ts';
import { createTenantQuery } from './query-keys.ts';
import { showToast } from './toast-state.ts';
import type { StockMatrixItem } from './stock-state.ts';

/** Lo que piden varias pantallas (#59): una sola caché y un solo pedido. */

export const categoriesQuery = createTenantQuery<string[]>({
  domain: 'categories',
  enabled: () => inSection('catalog', 'stock', 'bulk'),
  fn: ({ tenantId, token }) => apiFetch<string[]>(`tenants/${tenantId}/categories`, { token }).catch(() => []),
});

export const stockMatrixQuery = createTenantQuery<StockMatrixItem[]>({
  domain: 'stock',
  enabled: () => inSection('catalog', 'stock'),
  onError: (err) => { showToast({ type: 'error', title: 'Error de stock', message: err.message }); },
  fn: ({ tenantId, token }) => apiFetch<StockMatrixItem[]>(`tenants/${tenantId}/stock`, { token }),
});
```

- [ ] **Paso 4: `catalog-state.ts`**

- Imports: sacar `signal`-only de los datos (queda `signal` para los modales), sacar `loadOnTenantAndView`; agregar
  ```ts
  import { createTenantQuery } from './query-keys.ts';
  import { categoriesQuery, stockMatrixQuery } from './shared-queries.ts';
  import { inSection, routeFilters, setFilters } from './route-state.ts';
  import { invalidateAfter } from './invalidation.ts';
  import type { CatalogFilters } from '../routing/admin-routes.ts';
  ```
- Borrar el tipo `StockMatrixItem` (líneas 21-28).
- Reemplazar las líneas 42-52 (señales de datos y filtros) por:
  ```ts
  const productsQuery = createTenantQuery<ProductItem[]>({
    domain: 'products',
    enabled: () => inSection('catalog'),
    onError: (err) => { showToast({ type: 'error', title: 'Error de catálogo', message: err.message }); },
    fn: ({ tenantId, token }) => apiFetch<ProductItem[]>(`tenants/${tenantId}/products`, { token }),
  });

  export const productsSignal = computed<ProductItem[]>(() => productsQuery.data.value ?? []);
  export const categoriesSignal = computed<string[]>(() => categoriesQuery.data.value ?? []);
  export const stockMapSignal = computed<Record<string, number>>(() =>
    Object.fromEntries((stockMatrixQuery.data.value ?? []).map((item) => [item.productId, item.totalStock])),
  );
  export const catalogLoadingSignal = productsQuery.isLoading;
  export const catalogErrorSignal = computed<string | null>(() => productsQuery.error.value?.message ?? null);

  // Filtros: en la URL (#59)
  export const catalogFiltersSignal = computed<CatalogFilters>(() => routeFilters('catalog'));
  export const catalogSearchSignal = computed(() => catalogFiltersSignal.value.q);
  export const catalogCategoryFilterSignal = computed(() => catalogFiltersSignal.value.category);
  export const catalogBlockedFilterSignal = computed(() => catalogFiltersSignal.value.blocked);

  export function setCatalogFilters(patch: Partial<CatalogFilters>): void {
    setFilters('catalog', patch);
  }

  function setProducts(update: (list: ProductItem[]) => ProductItem[]): void {
    productsQuery.setData((previous) => update(previous ?? []));
  }
  ```
- `filteredProductsSignal` (líneas 81-113) pasa a:
  ```ts
  export function filterProducts(products: ProductItem[], filters: CatalogFilters): ProductItem[] {
    const search = filters.q.trim().toLowerCase();
    return products.filter((p) => {
      if (search) {
        const matchName = p.name.toLowerCase().includes(search);
        const matchSku = p.sku.toLowerCase().includes(search);
        const matchBarcode = p.barcodes.some((b) => b.toLowerCase().includes(search));
        if (!matchName && !matchSku && !matchBarcode) return false;
      }
      if (filters.category !== 'all' && p.category !== filters.category) return false;
      if (filters.blocked === 'active' && p.blockedReason !== null) return false;
      if (filters.blocked === 'blocked' && p.blockedReason === null) return false;
      return true;
    });
  }

  export const filteredProductsSignal = computed<ProductItem[]>(() => filterProducts(productsSignal.value, catalogFiltersSignal.value));
  ```
- `fetchCatalog` (líneas 115-146) pasa a:
  ```ts
  export async function fetchCatalog(): Promise<void> {
    await Promise.all([productsQuery.refetch(), categoriesQuery.refetch(), stockMatrixQuery.refetch()]);
  }
  ```
- Escrituras:
  - `saveInlineEdit`: `const previousProducts = [...productsSignal.value];` queda;
    `productsSignal.value = productsSignal.value.map(…updatePayload…)` → `setProducts((list) => list.map((p) => (p.id === productId ? { ...p, ...updatePayload } : p)));`;
    la confirmación → `setProducts((list) => list.map((p) => (p.id === productId ? updated : p)));` y después del toast `void invalidateAfter('product-saved');`;
    la reversión → `setProducts(() => previousProducts);`.
  - `submitProductForm`: las dos escrituras → `setProducts((list) => list.map(…))` y `setProducts((list) => [saved, ...list])`;
    la de categorías → `categoriesQuery.setData((prev) => { const list = prev ?? []; return list.includes(saved.category) ? list : [...list, saved.category].sort(); });`
    (y se borra el `if` que la envolvía); antes de `closeProductModal()`, `void invalidateAfter('product-saved');`.
  - `confirmToggleBlock` y `deleteProduct`: igual (`setProducts(…)` + `void invalidateAfter('product-saved');`).
- Borrar el bloque final `if (typeof window !== 'undefined') { loadOnTenantAndView(…) }`.

- [ ] **Paso 5: `CatalogToolbar.tsx`**

Importar `setCatalogFilters` y reemplazar:
`catalogSearchSignal.value = v` → `setCatalogFilters({ q: v })`; `= ''` → `setCatalogFilters({ q: '' })`;
`catalogCategoryFilterSignal.value = v` → `setCatalogFilters({ category: v })`;
`catalogBlockedFilterSignal.value = 'all' | 'active' | 'blocked'` → `setCatalogFilters({ blocked: … })`.
Si `CatalogGrid.tsx` u otro componente importa el tipo `StockMatrixItem` de `catalog-state.ts`,
pasarlo a `stock-state.ts`.

- [ ] **Paso 6: correr** `pnpm vitest run test/catalog-client.test.ts` → PASS; `pnpm test` → PASS.

- [ ] **Paso 7: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test
git commit -m "feat: catálogo con TanStack Query y filtros en la URL; categorías y stock compartidos (#59)"
```

Frenar: revisión de la tarea 5.

---

### Tarea 6: Stock

**Archivos:**
- Modificar: `src/client/state/shared-queries.ts` (suma `branchesQuery`), `src/client/state/stock-state.ts`,
  `src/client/components/stock/StockToolbar.tsx`, `src/client/components/stock/StockMatrixTable.tsx`,
  `src/client/state/dashboard-drill.ts` (`drillToStockProduct`)
- Test: `test/stock-client.test.ts`

**Interfaces:**
- Produce: `branchesQuery` (`shared-queries.ts`, dominio `branches`, habilitada en dashboard, stock y
  configuración); en `stock-state.ts`: `stockFiltersSignal`, `setStockFilters(patch: Partial<StockFilters>)`,
  `filterStock(items: StockMatrixItem[], filters: StockFilters): StockMatrixItem[]`;
  `openKardex(product: StockMatrixItem): void` (ya no es async).

- [ ] **Paso 1: tests que fallan** (adaptar el `beforeEach` como en el patrón: datos en
  `tenantKey('tienda-test', 'stock')`, `'branches'` y `'categories'`; sumar):

```ts
describe('Stock con URL y caché (#59)', () => {
  it('los filtros salen de la URL', () => {
    atTenant('tienda-test', 'stock?nivel=sin-stock&sucursal=b1');
    expect(stockFiltersSignal.value).toEqual({ q: '', category: 'all', level: 'out', branch: 'b1' });
    setStockFilters({ q: 'coca' });
    expect(locationSignal.value.search).toBe('?q=coca&nivel=sin-stock&sucursal=b1');
  });

  it('el kardex se pide al abrirlo, por producto', async () => {
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url: string) => { urls.push(url); return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })); });
    try {
      const [first] = stockItemsSignal.value;
      if (first === undefined) throw new Error('sin stock de prueba');
      openKardex(first);
      await vi.waitFor(() => { expect(urls.some((u) => u.includes('/stock/kardex?productId='))).toBe(true); });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('un ajuste deja viejos stock, catálogo, kardex y dashboard', async () => {
    // … mock de fetch que responde el ajuste, como el test existente de submitStockAdjustment
    await submitStockAdjustment();
    for (const domain of ['stock', 'products'] as const) {
      expect(queryClient.getQueryState(tenantKey('tienda-test', domain))?.isInvalidated, domain).toBe(true);
    }
  });

  it('el drill del dashboard abre Stock filtrado por el producto', () => {
    atTenant('tienda-test', 'dashboard');
    drillToStockProduct('Coca');
    expect(`${locationSignal.value.pathname}${locationSignal.value.search}`).toBe('/admin/tienda-test/stock?q=Coca');
  });
});
```
> En el de ajuste, para preparar `queryClient.setQueryData(tenantKey('tienda-test', 'products'), [])`
> y reusar el mock de `fetch` del test existente de `submitStockAdjustment`.

- [ ] **Paso 2: verlos fallar** — `pnpm vitest run test/stock-client.test.ts`.

- [ ] **Paso 3: implementar**

`shared-queries.ts`, sumar:
```ts
import type { BranchItem } from './stock-state.ts';

export const branchesQuery = createTenantQuery<BranchItem[]>({
  domain: 'branches',
  enabled: () => inSection('dashboard', 'stock', 'settings'),
  fn: ({ tenantId, token }) => apiFetch<BranchItem[]>(`tenants/${tenantId}/branches`, { token }),
});
```

`stock-state.ts`:
- Imports: sacar `loadOnTenantAndView`; agregar `createTenantParamQuery`, `branchesQuery`,
  `categoriesQuery`, `stockMatrixQuery`, `inSection`, `routeFilters`, `setFilters`, `invalidateAfter`,
  `type StockFilters`.
- Reemplazar `stockItemsSignal`, `stockBranchesSignal`, `stockCategoriesSignal`, `stockLoadingSignal`,
  `stockErrorSignal` y los cuatro signals de filtro por:
  ```ts
  export const stockItemsSignal = computed<StockMatrixItem[]>(() => stockMatrixQuery.data.value ?? []);
  export const stockBranchesSignal = computed<BranchItem[]>(() => branchesQuery.data.value ?? []);
  export const stockCategoriesSignal = computed<string[]>(() => categoriesQuery.data.value ?? []);
  export const stockLoadingSignal = stockMatrixQuery.isLoading;
  export const stockErrorSignal = computed<string | null>(() => stockMatrixQuery.error.value?.message ?? null);

  export const stockFiltersSignal = computed<StockFilters>(() => routeFilters('stock'));
  export const stockSearchSignal = computed(() => stockFiltersSignal.value.q);
  export const stockCategoryFilterSignal = computed(() => stockFiltersSignal.value.category);
  export const stockStatusFilterSignal = computed(() => stockFiltersSignal.value.level);
  export const stockBranchFilterSignal = computed(() => stockFiltersSignal.value.branch);

  export function setStockFilters(patch: Partial<StockFilters>): void {
    setFilters('stock', patch);
  }
  ```
- `kardexMovementsSignal` y `kardexLoadingSignal` pasan a una consulta:
  ```ts
  const kardexQuery = createTenantParamQuery<KardexItem[], readonly [string]>({
    domain: 'kardex',
    params: () => {
      const target = kardexTargetProductSignal.value;
      return kardexDrawerOpenSignal.value && target !== null ? [target.productId] : null;
    },
    onError: (err) => { showToast({ type: 'error', title: 'Error de Kardex', message: err.message }); },
    fn: ({ tenantId, token, params: [productId] }) =>
      apiFetch<KardexItem[]>(`tenants/${tenantId}/stock/kardex?productId=${encodeURIComponent(productId)}&limit=100`, { token }),
  });
  export const kardexMovementsSignal = computed<KardexItem[]>(() => kardexQuery.data.value ?? []);
  export const kardexLoadingSignal = kardexQuery.isLoading;
  ```
  (definir `kardexDrawerOpenSignal` y `kardexTargetProductSignal` antes que la consulta.)
- `filteredStockSignal` → `filterStock(items, filters)` puro (mismo cuerpo, leyendo `filters.q`,
  `filters.category`, `filters.level`, `filters.branch`) y
  `export const filteredStockSignal = computed(() => filterStock(stockItemsSignal.value, stockFiltersSignal.value));`.
- `fetchStockData` → `await Promise.all([stockMatrixQuery.refetch(), branchesQuery.refetch(), categoriesQuery.refetch()]);`.
- `submitStockAdjustment`: `stockItemsSignal.value = stockItemsSignal.value.map(…)` →
  `stockMatrixQuery.setData((prev) => (prev ?? []).map(…mismo cuerpo…));`; borrar el bloque "Si el
  drawer de Kardex está abierto…" y poner `void invalidateAfter('stock-adjusted');` antes de `closeAdjustModal()`.
- `openKardex` queda síncrona (sin `loadKardexMovements`):
  ```ts
  export function openKardex(product: StockMatrixItem): void {
    kardexTargetProductSignal.value = product;
    kardexReasonFilterSignal.value = 'all';
    kardexDrawerOpenSignal.value = true;
  }
  ```
  `closeKardex` deja de escribir `kardexMovementsSignal`. `loadKardexMovements` se borra.
- Borrar el bloque final con `loadOnTenantAndView`.

`StockToolbar.tsx`: `stockSearchSignal.value = v` → `setStockFilters({ q: v })`, categoría → `{ category }`,
sucursal → `{ branch }`, estado → `{ level: 'all' | 'out' | 'low' | 'normal' }`. `StockMatrixTable.tsx`:
`onClick={() => { void openKardex(item); }}` → `onClick={() => { openKardex(item); }}`.

`dashboard-drill.ts`:
```ts
export function drillToStockProduct(name: string): void {
  goTo({ section: 'stock', filters: { ...decodeFilters('stock', {}), q: name } });
}
```
(import `decodeFilters` de `../routing/admin-routes.ts`; se van los imports de `stockSearchSignal` y `stockStatusFilterSignal`).

- [ ] **Paso 4: correr** `pnpm vitest run test/stock-client.test.ts` → PASS; `pnpm test` → PASS.

- [ ] **Paso 5: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test
git commit -m "feat: stock y kardex con TanStack Query y filtros en la URL; sucursales compartidas (#59)"
```

Frenar: revisión de la tarea 6.

---

### Tarea 7: Clientes (y adiós a `view-loader`)

**Archivos:**
- Modificar: `src/client/state/customer-state.ts`, `src/client/state/discrepancy-state.ts`,
  `src/client/components/customers/CustomerToolbar.tsx`, `src/client/components/customers/CustomerGrid.tsx`,
  `src/client/state/dashboard-drill.ts` (`drillToDebtors`)
- Borrar: `src/client/state/view-loader.ts`, `test/view-loader.test.ts`
- Tests: `test/customer-client.test.ts`, `test/discrepancy-client.test.ts`

**Interfaces:**
- Produce: `customerFiltersSignal`, `setCustomerFilters(patch: Partial<CustomerFilters>)`,
  `filterCustomers(items: CustomerItem[], filters: CustomerFilters): CustomerItem[]`;
  `openAccountStatement(customer: CustomerItem): void` (ya no es async); se borra `loadCustomerMovements`.
  Los clientes se habilitan en Clientes **y en Ventas** (el selector de cliente de los filtros).

- [ ] **Paso 1: tests que fallan** (adaptar el `beforeEach` con `tenantKey('tienda-test', 'customers')`; sumar):

```ts
describe('Clientes con URL y caché (#59)', () => {
  it('los filtros salen de la URL', () => {
    atTenant('tienda-test', 'clientes?deudores=1');
    expect(customerFiltersSignal.value).toEqual({ q: '', debtorsOnly: true, blocked: 'all' });
    setCustomerFilters({ q: 'ana' });
    expect(locationSignal.value.search).toBe('?q=ana&deudores=1');
  });

  it('una cobranza deja viejos clientes, extracto, ventas, dashboard y discrepancias', async () => {
    for (const d of ['customers', 'customer-movements', 'sales', 'dashboard', 'discrepancies'] as const) {
      queryClient.setQueryData(tenantKey('tienda-test', d, 'x'), 1);
    }
    // … mock de fetch con la respuesta del pago, como el test existente de submitPayment
    openPaymentModal(mockCustomer);
    await submitPayment();
    for (const d of ['customer-movements', 'sales', 'dashboard', 'discrepancies'] as const) {
      expect(queryClient.getQueryState(tenantKey('tienda-test', d, 'x'))?.isInvalidated, d).toBe(true);
    }
  });

  it('el drill de deudores abre Clientes con el filtro', () => {
    atTenant('tienda-test', 'dashboard');
    drillToDebtors();
    expect(`${locationSignal.value.pathname}${locationSignal.value.search}`).toBe('/admin/tienda-test/clientes?deudores=1');
  });
});
```
(`mockCustomer` es el cliente de prueba que ya define el archivo; usar el nombre que tenga.)

En `test/discrepancy-client.test.ts`: los datos van en `tenantKey('t1', 'discrepancies')`; el test de
`dismissDiscrepancy` mockea `fetch` para el POST y para el GET que sigue (la invalidación vuelve a pedir
si la pantalla es Clientes: `atTenant('t1', 'clientes')`).

- [ ] **Paso 2: verlos fallar** — `pnpm vitest run test/customer-client.test.ts test/discrepancy-client.test.ts`.

- [ ] **Paso 3: implementar**

`customer-state.ts`:
- Imports: sacar `loadOnTenantAndView`; agregar `createTenantQuery`, `createTenantParamQuery`,
  `inSection`, `routeFilters`, `setFilters`, `invalidateAfter`, `type CustomerFilters`.
- Datos y filtros (reemplaza líneas 60-67):
  ```ts
  const customersQuery = createTenantQuery<CustomerItem[]>({
    domain: 'customers',
    enabled: () => inSection('customers', 'sales'),
    onError: (err) => { showToast({ type: 'error', title: 'Error de clientes', message: err.message }); },
    fn: ({ tenantId, token }) => apiFetch<CustomerItem[]>(`tenants/${tenantId}/customers`, { token }),
  });
  export const customersSignal = computed<CustomerItem[]>(() => customersQuery.data.value ?? []);
  export const customerLoadingSignal = customersQuery.isLoading;
  export const customerErrorSignal = computed<string | null>(() => customersQuery.error.value?.message ?? null);

  export const customerFiltersSignal = computed<CustomerFilters>(() => routeFilters('customers'));
  export const customerSearchSignal = computed(() => customerFiltersSignal.value.q);
  export const customerDebtorsOnlySignal = computed(() => customerFiltersSignal.value.debtorsOnly);
  export const customerBlockedFilterSignal = computed(() => customerFiltersSignal.value.blocked);

  export function setCustomerFilters(patch: Partial<CustomerFilters>): void {
    setFilters('customers', patch);
  }

  function setCustomers(update: (list: CustomerItem[]) => CustomerItem[]): void {
    customersQuery.setData((previous) => update(previous ?? []));
  }
  ```
- Extracto (reemplaza `accountMovementsSignal` y `accountLoadingSignal`; los signals del drawer quedan antes):
  ```ts
  const movementsQuery = createTenantParamQuery<AccountMovementItem[], readonly [string]>({
    domain: 'customer-movements',
    params: () => {
      const target = accountTargetCustomerSignal.value;
      return accountDrawerOpenSignal.value && target !== null ? [target.id] : null;
    },
    onError: (err) => { showToast({ type: 'error', title: 'Error de cuenta corriente', message: err.message }); },
    fn: ({ tenantId, token, params: [customerId] }) =>
      apiFetch<AccountMovementItem[]>(`tenants/${tenantId}/customers/${customerId}/movements?limit=100`, { token }),
  });
  export const accountMovementsSignal = computed<AccountMovementItem[]>(() => movementsQuery.data.value ?? []);
  export const accountLoadingSignal = movementsQuery.isLoading;
  ```
- `filteredCustomersSignal` → `filterCustomers(items, filters)` puro (mismo cuerpo) y su `computed`.
- `fetchCustomers` → `await customersQuery.refetch();`.
- `submitCustomerForm`: escrituras → `setCustomers(…)`; antes de `closeCustomerModal()`, `void invalidateAfter('customer-saved');`.
- `submitPayment`: escritura → `setCustomers((list) => list.map(…mismo cuerpo…))`; el bloque
  "if (accountDrawerOpenSignal.value …) loadCustomerMovements" → `void invalidateAfter('customer-payment');`.
- `submitBalanceAdjustment`: igual, con `'balance-adjusted'`.
- `openAccountStatement` síncrona; `closeAccountStatement` sin escribir `accountMovementsSignal`;
  borrar `loadCustomerMovements` y el bloque final con `loadOnTenantAndView`.

`discrepancy-state.ts`:
```ts
const discrepanciesQuery = createTenantQuery<DiscrepancyItem[]>({
  domain: 'discrepancies',
  enabled: () => inSection('customers'),
  fn: ({ tenantId, token }) => apiFetch<DiscrepancyItem[]>(`tenants/${tenantId}/discrepancies`, { token }),
});
/** Discrepancias abiertas del comercio (#2): franja y panel en Clientes. */
export const discrepanciesSignal = computed<DiscrepancyItem[]>(() => discrepanciesQuery.data.value ?? []);
export async function fetchDiscrepancies(): Promise<void> {
  await discrepanciesQuery.refetch();
}
```
En `dismissDiscrepancy`, `await fetchDiscrepancies();` → `await invalidateAfter('discrepancy-dismissed');`.
Borrar el `effect` final.

Componentes: `CustomerToolbar.tsx` escribe con `setCustomerFilters({ q })`, `{ debtorsOnly: !debtorsOnly }`,
`{ blocked }`; `CustomerGrid.tsx`: `void openAccountStatement(c)` → `openAccountStatement(c)`.

`dashboard-drill.ts`:
```ts
export function drillToDebtors(): void {
  goTo({ section: 'customers', filters: { ...decodeFilters('customers', {}), debtorsOnly: true } });
}
```

Borrar `src/client/state/view-loader.ts` y `test/view-loader.test.ts` (`git rm`); verificar con
`rg view-loader src test` que no quede nada.

- [ ] **Paso 4: correr** los dos tests → PASS; `pnpm test` → PASS.

- [ ] **Paso 5: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test
git commit -m "feat: clientes y discrepancias con TanStack Query y filtros en la URL; se va view-loader (#59)"
```

Frenar: revisión de la tarea 7.

---

### Tarea 8: Dashboard

**Archivos:**
- Modificar: `src/client/state/dashboard-state.ts`, `src/client/components/dashboard/DashboardFilters.tsx`,
  `src/client/components/dashboard/DashboardView.tsx` (si llama a `fetchDashboardData`)
- Tests: `test/dashboard-effects.test.ts` (reescrito), `test/dashboard-client.test.ts` (adaptar)

**Interfaces:**
- Produce: `dashboardFiltersSignal`, `setDashboardFilters(patch: Partial<DashboardFilters>)`;
  `selectedPeriodSignal` y `selectedBranchSignal` son `computed`; `branchesListSignal` sale de
  `branchesQuery`; se borra `registerDashboardEffects`. `fetchDashboardData()` sin parámetros
  (refresca).

- [ ] **Paso 1: el test que falla** (reemplaza `test/dashboard-effects.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/client/api/client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client/api/client.ts')>()),
  apiFetch: vi.fn(() => Promise.resolve([])),
}));

import { apiFetch } from '../src/client/api/client.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { tokenSignal } from '../src/client/state/auth-state.ts';
import { setHistoryForTests } from '../src/client/state/route-state.ts';
import { setDashboardFilters } from '../src/client/state/dashboard-state.ts';
import { atTenant } from './helpers/client-route.ts';

const calls = (fragment: string): number =>
  vi.mocked(apiFetch).mock.calls.filter(([endpoint]) => endpoint.includes(fragment)).length;

describe('Cargas del dashboard (#7, #59)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    queryClient.clear();
    tokenSignal.value = 'token';
    atTenant('almacen', 'stock');
    vi.mocked(apiFetch).mockClear();
  });

  it('al entrar pide el resumen y las sucursales; un filtro, solo el resumen; otro comercio, todo', async () => {
    atTenant('kiosco', 'dashboard');
    await vi.waitFor(() => { expect(calls('/dashboard/summary')).toBe(1); });
    expect(calls('/branches')).toBe(1);

    vi.mocked(apiFetch).mockClear();
    setDashboardFilters({ period: 'today' });
    await vi.waitFor(() => { expect(calls('/dashboard/summary?period=today')).toBe(1); });
    expect(calls('/branches')).toBe(0);

    vi.mocked(apiFetch).mockClear();
    atTenant('almacen', 'dashboard');
    await vi.waitFor(() => { expect(calls('/dashboard/summary')).toBe(1); });
    expect(calls('/branches')).toBe(1);
  });

  it('fuera del dashboard no pide el resumen', () => {
    atTenant('kiosco', 'clientes');
    expect(calls('/dashboard/summary')).toBe(0);
  });
});
```

- [ ] **Paso 2: verlo fallar** — `pnpm vitest run test/dashboard-effects.test.ts`.

- [ ] **Paso 3: implementar**

`dashboard-state.ts` (desde `// Signals` hasta el final del archivo):

```ts
export const dashboardFiltersSignal = computed<DashboardFilters>(() => routeFilters('dashboard'));
export const selectedPeriodSignal = computed<DashboardPeriod>(() => dashboardFiltersSignal.value.period);
export const selectedBranchSignal = computed<string>(() => dashboardFiltersSignal.value.branch);

export function setDashboardFilters(patch: Partial<DashboardFilters>): void {
  setFilters('dashboard', patch);
}

const summaryQuery = createTenantParamQuery<DashboardData, readonly [DashboardPeriod, string]>({
  domain: 'dashboard',
  params: () => [selectedPeriodSignal.value, selectedBranchSignal.value],
  enabled: () => inSection('dashboard'),
  fn: ({ tenantId, token, params: [period, branch] }) => {
    const query = branch ? `period=${period}&branchId=${encodeURIComponent(branch)}` : `period=${period}`;
    return apiFetch<DashboardData>(`tenants/${tenantId}/dashboard/summary?${query}`, { token });
  },
});

export const dashboardDataSignal = computed<DashboardData | null>(() => summaryQuery.data.value ?? null);
export const dashboardLoadingSignal = summaryQuery.isLoading;
export const dashboardErrorSignal = computed<string | null>(() => summaryQuery.error.value?.message ?? null);
/** Si falla el listado de sucursales, el filtro queda vacío sin bloquear la vista. */
export const branchesListSignal = computed<BranchItem[]>(() => branchesQuery.data.value ?? []);

export async function fetchDashboardData(): Promise<void> {
  await summaryQuery.refetch();
}
```
con imports `computed` de `@preact/signals`, `createTenantParamQuery`, `branchesQuery`, `inSection`,
`routeFilters`, `setFilters`, `type DashboardFilters`; se borran `signal`, `effect`,
`fetchBranches`, `registerDashboardEffects` y el bloque final. El tipo local `BranchItem` del dashboard
se reemplaza por el de `stock-state.ts` (`import type { BranchItem } from './stock-state.ts';`), que
tiene los mismos campos y más.

`DashboardFilters.tsx`: `selectedPeriodSignal.value = p.id` → `setDashboardFilters({ period: p.id })`;
`selectedBranchSignal.value = v` → `setDashboardFilters({ branch: v })`. Las llamadas a
`fetchDashboardData()` siguen igual.

`test/dashboard-client.test.ts`: lo que escribía `dashboardDataSignal.value` pasa a
`queryClient.setQueryData(tenantKey('<slug>', 'dashboard', 'week', ''), datos)` con `atTenant('<slug>')`.

- [ ] **Paso 4: correr** → PASS; `pnpm test` → PASS.

- [ ] **Paso 5: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test
git commit -m "feat: dashboard con TanStack Query y período y sucursal en la URL (#59)"
```

Frenar: revisión de la tarea 8.

---

### Tarea 9: Ventas & Caja

**Archivos:**
- Modificar: `src/client/state/sales-state.ts`, `src/client/components/sales/{SalesTable,DaySummaryDrawer,TicketDrawer,CashSummaryTable}.tsx`,
  `src/client/components/sales/SalesTabs.tsx` (el `href` conserva rango y caja)
- Test: `test/sales-client.test.ts`

**Interfaces:**
- Consume: `SalesRouteFilters`, `RangePreset` (de `admin-routes.ts`; `sales-state` reexporta `RangePreset`).
- Produce (mismos nombres que hoy): `salesTabSignal`, `rangePresetSignal`, `rangeSignal`,
  `registerSignal`, `salesFiltersSignal`, `paymentsFiltersSignal`, `movementsFiltersSignal`,
  `pageSignal` (todos `computed`), los datos (`registersSignal`, `salesListSignal`, `paymentsListSignal`,
  `movementsListSignal`, `cashSummarySignal`, `salesLoadingSignal`, `salesErrorSignal`,
  `ticketSignal`, `daySummarySignal`), los setters (`setTab`, `applyPreset`, `setCustomRange`,
  `setRegister`, `setSalesFilters`, `setPaymentsFilters`, `setMovementsFilters`, `setPage`,
  `openSalesWith`) y `openTicket(saleId: string): void`, `openDaySummary(row): void` (ya no async).
  Nuevo: `sharedSalesFilters(f: SalesRouteFilters): SalesRouteFilters` (rango y caja, el resto por omisión).

- [ ] **Paso 1: tests que fallan** (sumar a `test/sales-client.test.ts`; adaptar el `beforeEach` como el patrón)

```ts
describe('Ventas con URL y caché (#59)', () => {
  it('rango, caja, filtros y página salen de la URL', () => {
    atTenant('t1', 'ventas/cobranzas?desde=2026-10-01&hasta=2026-10-03&caja=&pagina=2&estado=anuladas');
    expect(salesTabSignal.value).toBe('payments');
    expect(rangePresetSignal.value).toBe('custom');
    expect(rangeSignal.value).toEqual({ from: '2026-10-01', to: '2026-10-03' });
    expect(registerSignal.value).toEqual({ pointOfSale: '' });
    expect(paymentsFiltersSignal.value).toEqual({ status: 'voided' });
    expect(pageSignal.value).toBe(2);
  });

  it('un filtro vuelve a la primera página y reemplaza la entrada', () => {
    atTenant('t1', 'ventas?pagina=3');
    setSalesFilters({ status: 'valid' });
    expect(locationSignal.value.search).toBe('?estado=vigentes');
  });

  it('cambiar de solapa conserva rango y caja y suelta los filtros de la solapa', () => {
    atTenant('t1', 'ventas?rango=semana&sucursal=CENTRAL&estado=anuladas&pagina=2');
    setTab('movements');
    expect(`${locationSignal.value.pathname}${locationSignal.value.search}`).toBe('/admin/t1/ventas/movimientos?rango=semana&sucursal=CENTRAL');
  });

  it('el drill del dashboard abre ventas con sus filtros en la URL', () => {
    atTenant('t1', 'dashboard');
    openSalesWith({ range: { from: '2026-10-01', to: '2026-10-01' }, status: 'voided', productId: 'p1' });
    expect(`${locationSignal.value.pathname}${locationSignal.value.search}`).toBe('/admin/t1/ventas?desde=2026-10-01&hasta=2026-10-01&estado=anuladas&producto=p1');
  });

  it('solo pide la solapa activa', async () => {
    vi.mocked(apiFetch).mockClear(); // si el archivo mockea apiFetch; si no, un fetch falso que registre URLs
    atTenant('t1', 'ventas/resumen');
    await vi.waitFor(() => { expect(endpointsCalled().some((e) => e.includes('/cash-summary?'))).toBe(true); });
    expect(endpointsCalled().some((e) => e.includes('/sales?'))).toBe(false);
  });
});
```
> `endpointsCalled()` es un helper local del archivo que devuelve las URLs pedidas (de `vi.mocked(apiFetch).mock.calls`
> o del `fetch` falso, según cómo mockee el archivo hoy).
> Los tests existentes que esperaban `activeSectionSignal 'stock'`/`'customers'` después de un drill
> siguen valiendo con las URLs nuevas.

- [ ] **Paso 2: verlos fallar** — `pnpm vitest run test/sales-client.test.ts`.

- [ ] **Paso 3: implementar** (`sales-state.ts`)

- Tipos: `RangePreset` sale de `admin-routes.ts` (`export type { RangePreset } from '../routing/admin-routes.ts';`
  y se borra la definición local). `SalesTab` ya es `TabId<'sales'>` (tarea 3).
- Reemplazar los signals de filtros y datos (líneas 43-65) por:

```ts
const salesRouteFiltersSignal = computed<SalesRouteFilters>(() => routeFilters('sales'));

export const rangePresetSignal = computed<RangePreset>(() => salesRouteFiltersSignal.value.preset);
export const rangeSignal = computed<DayRange>(() => {
  const f = salesRouteFiltersSignal.value;
  if (f.preset === 'custom' && f.from !== undefined && f.to !== undefined) return { from: f.from, to: f.to };
  return presetRange(f.preset === 'custom' ? 'today' : f.preset, argentinaToday(new Date()));
});
export const registerSignal = computed<RegisterChoice>(() => {
  const { branch, pointOfSale } = salesRouteFiltersSignal.value;
  return { ...(branch === undefined ? {} : { branch }), ...(pointOfSale === undefined ? {} : { pointOfSale }) };
});
export const salesFiltersSignal = computed<SalesFilters>(() => {
  const { status, method, customerId, productId, kind } = salesRouteFiltersSignal.value;
  return {
    status,
    ...(method === undefined ? {} : { method }),
    ...(customerId === undefined ? {} : { customerId }),
    ...(productId === undefined ? {} : { productId }),
    ...(kind === undefined ? {} : { kind }),
  };
});
export const paymentsFiltersSignal = computed<PaymentsFilters>(() => {
  const { status, method, customerId } = salesRouteFiltersSignal.value;
  return { status, ...(method === undefined ? {} : { method }), ...(customerId === undefined ? {} : { customerId }) };
});
export const movementsFiltersSignal = computed<MovementsFilters>(() => {
  const { direction, source } = salesRouteFiltersSignal.value;
  return { ...(direction === undefined ? {} : { direction }), ...(source === undefined ? {} : { source }) };
});
export const pageSignal = computed<number>(() => salesRouteFiltersSignal.value.page);

const salesInputSignal = computed<SalesQueryInput>(() => ({
  tab: salesTabSignal.value,
  range: rangeSignal.value,
  register: registerSignal.value,
  sales: salesFiltersSignal.value,
  payments: paymentsFiltersSignal.value,
  movements: movementsFiltersSignal.value,
  page: pageSignal.value,
}));

/** Una consulta por solapa: solo se pide la activa, con sus filtros en la clave. */
function tabQuery<T>(tab: SalesTab) {
  return createTenantParamQuery<T, readonly [SalesTab, SalesQueryInput]>({
    domain: 'sales',
    params: () => [tab, salesInputSignal.value],
    enabled: () => inSection('sales') && salesTabSignal.value === tab,
    fn: ({ tenantId, token, params: [, input] }) => apiFetch<T>(`tenants/${tenantId}/${endpointFor({ ...input, tab })}`, { token }),
  });
}

const salesListQuery = tabQuery<ListResult<SaleListItem>>('sales');
const paymentsListQuery = tabQuery<ListResult<CustomerPaymentItem>>('payments');
const movementsListQuery = tabQuery<ListResult<CashMovementItem>>('movements');
const cashSummaryQuery = tabQuery<CashSummaryResult>('summary');

const registersQuery = createTenantQuery<RegisterItem[]>({
  domain: 'registers',
  enabled: () => inSection('sales'),
  fn: ({ tenantId, token }) => apiFetch<RegisterItem[]>(`tenants/${tenantId}/registers`, { token }),
});

// Drawers: el ticket y el resumen del día se piden mientras están abiertos
const ticketIdSignal = signal<string | null>(null);
const ticketQuery = createTenantParamQuery<SaleDetail, readonly ['ticket', string]>({
  domain: 'sales',
  params: () => (ticketIdSignal.value === null ? null : ['ticket', ticketIdSignal.value]),
  fn: ({ tenantId, token, params: [, saleId] }) => apiFetch<SaleDetail>(`tenants/${tenantId}/sales/${encodeURIComponent(saleId)}`, { token }),
});
type DayRow = { day: string; branch: string | null; pointOfSale: string | null };
const dayRowSignal = signal<DayRow | null>(null);
const daySummaryQuery = createTenantParamQuery<DaySummaryResult, readonly ['day-summary', string, string, string]>({
  domain: 'sales',
  params: () => {
    const row = dayRowSignal.value;
    return row === null ? null : ['day-summary', row.day, row.branch ?? '', row.pointOfSale ?? ''];
  },
  fn: ({ tenantId, token, params: [, day, branch, pointOfSale] }) =>
    apiFetch<DaySummaryResult>(`tenants/${tenantId}/cash-summary/day?${buildQuery({ day, branch, pointOfSale })}`, { token }),
});

const ALL = [salesListQuery, paymentsListQuery, movementsListQuery, cashSummaryQuery, registersQuery, ticketQuery, daySummaryQuery];

export const registersSignal = computed<RegisterItem[]>(() => registersQuery.data.value ?? []);
export const salesListSignal = computed(() => salesListQuery.data.value ?? null);
export const paymentsListSignal = computed(() => paymentsListQuery.data.value ?? null);
export const movementsListSignal = computed(() => movementsListQuery.data.value ?? null);
export const cashSummarySignal = computed(() => cashSummaryQuery.data.value ?? null);
export const salesLoadingSignal = computed<boolean>(() => [salesListQuery, paymentsListQuery, movementsListQuery, cashSummaryQuery].some((q) => q.isLoading.value));
export const salesErrorSignal = computed<string | null>(() => ALL.map((q) => q.error.value?.message).find((m) => m !== undefined) ?? null);

export const ticketSignal = computed<SaleDetail | null>(() => ticketQuery.data.value ?? null);
export const paymentDetailSignal = signal<CustomerPaymentItem | null>(null);
export const daySummarySignal = computed<DaySummaryResult | null>(() => daySummaryQuery.data.value ?? null);
```
> `buildQuery` y `endpointFor` se definen más abajo en el archivo: mover este bloque **después** de
> ellos (o mover `buildQuery`/`endpointFor` arriba). Las funciones `session`, `errorMessage`, `loadTab`
> y `fetchRegisters` se borran (y los tests que las usaban pasan a la consulta por URL).

- Drawers:
```ts
export function openTicket(saleId: string): void {
  ticketIdSignal.value = saleId;
}
export function closeTicket(): void {
  ticketIdSignal.value = null;
}
export function openDaySummary(row: DayRow): void {
  dayRowSignal.value = row;
}
export function closeDaySummary(): void {
  dayRowSignal.value = null;
}
```
- Setters (reemplazan los de las líneas 195-235):
```ts
/** Rango y caja valen para las cuatro solapas (#20); el resto de los filtros es de cada una. */
export function sharedSalesFilters(f: SalesRouteFilters): SalesRouteFilters {
  return {
    ...decodeFilters('sales', {}),
    preset: f.preset,
    ...(f.from === undefined ? {} : { from: f.from }),
    ...(f.to === undefined ? {} : { to: f.to }),
    ...(f.branch === undefined ? {} : { branch: f.branch }),
    ...(f.pointOfSale === undefined ? {} : { pointOfSale: f.pointOfSale }),
  };
}

export function setTab(tab: SalesTab): void {
  goTo({ section: 'sales', tab, filters: sharedSalesFilters(salesRouteFiltersSignal.peek()) });
}

// Cambiar un filtro vuelve a la primera página
function patchSales(patch: Partial<SalesRouteFilters>): void {
  setFilters('sales', { ...patch, page: 1 });
}

export function applyPreset(preset: Exclude<RangePreset, 'custom'>): void {
  patchSales({ preset, from: undefined, to: undefined });
}
export function setCustomRange(range: DayRange): void {
  patchSales({ preset: 'custom', from: range.from, to: range.to });
}
export function setRegister(choice: RegisterChoice): void {
  patchSales({ branch: choice.branch, pointOfSale: choice.pointOfSale });
}
export function setSalesFilters(patch: Partial<SalesFilters>): void {
  patchSales(patch);
}
export function setPaymentsFilters(patch: Partial<PaymentsFilters>): void {
  patchSales(patch);
}
export function setMovementsFilters(patch: Partial<MovementsFilters>): void {
  patchSales(patch);
}
export function setPage(page: number): void {
  setFilters('sales', { page });
}

export function openSalesWith(drill: SalesDrill): void {
  goTo({
    section: 'sales',
    tab: 'sales',
    filters: {
      ...decodeFilters('sales', {}),
      preset: 'custom',
      from: drill.range.from,
      to: drill.range.to,
      ...(drill.branch === undefined ? {} : { branch: drill.branch }),
      status: drill.status ?? 'all',
      ...(drill.productId === undefined ? {} : { productId: drill.productId }),
    },
  });
}
```
- Borrar `registerSalesEffects` y el bloque final; borrar el import de `customersSignal, fetchCustomers`
  (los clientes del selector ya se habilitan en Ventas, tarea 7).

Componentes: `void openTicket(x)` → `openTicket(x)` (`SalesTable.tsx`, `DaySummaryDrawer.tsx`,
`TicketDrawer.tsx` ×2); `void openDaySummary(r)` → `openDaySummary(r)` (`CashSummaryTable.tsx`).
`SalesTabs.tsx`: `href={tabUrl('sales', t.id, sharedSalesFilters(routeFilters('sales')))}` (conserva rango
y caja al cambiar de solapa con un link).

- [ ] **Paso 4: correr** → PASS; `pnpm test` → PASS.

- [ ] **Paso 5: e2e** — `sales-cash.spec.ts` sigue igual (los filtros y el drill funcionan por URL). `pnpm test:e2e` → PASS.

- [ ] **Paso 6: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test
git commit -m "feat: ventas y caja con TanStack Query, filtros en la URL y drawers como consultas (#59)"
```

Frenar: revisión de la tarea 9.

---

### Tarea 10: Configuración (sucursales y cajas)

**Archivos:**
- Modificar: `src/client/state/settings-state.ts`, `src/client/state/registers-state.ts`
- Tests: `test/settings-client.test.ts`, `test/registers-client.test.ts`

**Interfaces:**
- Produce: `settingsBranchesSignal` y `branchesLoadingSignal` desde `branchesQuery`;
  `registersSignal` y `registersLoadingSignal` desde una consulta `pos-registers`; `fetchSettingsBranches`
  y `fetchRegisters` refrescan.

- [ ] **Paso 1: tests que fallan** (sumar)

```ts
// settings-client.test.ts
it('guardar una sucursal deja viejos sucursales, stock y dashboard (#59)', async () => {
  queryClient.setQueryData(tenantKey('tienda-test', 'stock'), []);
  // … mock de fetch del POST de sucursal, como el test existente
  await submitBranchForm();
  expect(queryClient.getQueryState(tenantKey('tienda-test', 'stock'))?.isInvalidated).toBe(true);
  expect(settingsBranchesSignal.value.some((b) => b.code === 'NORTE')).toBe(true); // el código que use el test existente
});

// registers-client.test.ts
it('las cajas se piden en Configuración, solo para owner y admin (#59)', async () => {
  // fetch falso que registra URLs
  atTenant('tienda-test', 'configuracion');
  await vi.waitFor(() => { expect(urls.some((u) => u.endsWith('/pos-registers'))).toBe(true); });
});
it('una acción sobre una caja deja viejas las cajas y el estado de cobro (#59)', async () => {
  queryClient.setQueryData(tenantKey('tienda-test', 'billing-status'), { state: 'ok' });
  // … mock de fetch, como el test existente de unbindRegister
  await unbindRegister(register);
  expect(queryClient.getQueryState(tenantKey('tienda-test', 'billing-status'))?.isInvalidated).toBe(true);
});
```

- [ ] **Paso 2: verlos fallar.**

- [ ] **Paso 3: implementar**

`settings-state.ts`:
```ts
export const settingsBranchesSignal = computed<BranchItem[]>(() => branchesQuery.data.value ?? []);
export const branchesLoadingSignal = branchesQuery.isLoading;

export async function fetchSettingsBranches(): Promise<void> {
  await branchesQuery.refetch();
}
```
En `submitBranchForm`, las escrituras → `branchesQuery.setData((prev) => (prev ?? []).map(…))` y
`branchesQuery.setData((prev) => [...(prev ?? []), saved])`; antes de `closeBranchModal()`,
`void invalidateAfter('branch-saved');`. Borrar el `effect` final.

`registers-state.ts`:
```ts
const registersQuery = createTenantQuery<RegisterItem[]>({
  domain: 'pos-registers',
  enabled: () => inSection('settings') && canDo('settings.manage'),
  onError: (err) => { showToast({ type: 'error', title: 'No se pudieron cargar las cajas', message: err.message }); },
  fn: ({ tenantId, token }) => apiFetch<RegisterItem[]>(`tenants/${tenantId}/pos-registers`, { token }),
});
export const registersSignal = computed<RegisterItem[]>(() => registersQuery.data.value ?? []);
export const registersLoadingSignal = registersQuery.isLoading;

export async function fetchRegisters(): Promise<void> {
  await registersQuery.refetch();
}
```
(`canDo` de `permissions-state.ts`; se van los imports de `can`, `effectiveTenantRole` y
`activeTenantSignal` si quedan sin uso.) En `submitCreateRegister` y en `act`,
`await fetchRegisters();` → `await invalidateAfter('register-changed');`. Borrar el `effect` final.

- [ ] **Paso 4: correr** → PASS; `pnpm test` → PASS.

- [ ] **Paso 5: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test
git commit -m "feat: sucursales y cajas con TanStack Query e invalidación (#59)"
```

Frenar: revisión de la tarea 10.

---

### Tarea 11: Uso y pagos (#55)

**Archivos:**
- Modificar: `src/client/state/credits-state.ts`, `src/client/components/credits/CreditsView.tsx`,
  `src/client/components/shell/Sidebar.tsx`, `src/client/state/platform-state.ts` (`tenantAction`)
- Tests: `test/credits-client.test.ts`, `test/sidebar-order.test.ts`, `test/brand.test.ts` (si fija textos)

**Interfaces:**
- Produce: `billingStatusSignal`, `creditsSignal`, `chargesSignal`, `movementsSignal`, `giftsSignal`,
  `creditsLoadingSignal` (todos `computed`); `chargesRangeSignal` (`computed`, por omisión los últimos
  30 días argentinos); `setChargesRange(range: { from: string; to: string }): void`,
  `setChargesPage(page: number): void`; `refreshCredits()` invalida `credits` y `billing-status`.
  Se borran `fetchCredits`, `fetchCharges`, `fetchMovements`, `fetchGifts`; `fetchBillingStatus` refresca.

- [ ] **Paso 1: tests que fallan** (sumar a `credits-client.test.ts`)

```ts
describe('Uso y pagos con URL y caché (#55, #59)', () => {
  it('el rango del consumo sale de la URL; sin rango, los últimos 30 días', () => {
    atTenant('tienda-test', 'uso-y-pagos?desde=2026-09-01&hasta=2026-09-30');
    expect(chargesRangeSignal.value).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    atTenant('tienda-test', 'uso-y-pagos');
    const today = argentinaToday(new Date());
    expect(chargesRangeSignal.value).toEqual({ from: shiftDay(today, -29), to: today });
  });

  it('cambiar el rango vuelve a la primera página', () => {
    atTenant('tienda-test', 'uso-y-pagos?pagina=3');
    setChargesRange({ from: '2026-09-01', to: '2026-09-30' });
    expect(locationSignal.value.search).toBe('?desde=2026-09-01&hasta=2026-09-30');
  });

  it('un 402 deja el comercio restringido en la caché del estado de cobro', () => {
    markRestrictedFromError(new ApiError(402, 'x', { code: 'billing-restricted', debt: 500, deadline: '2026-10-01' }));
    expect(billingStatusSignal.value).toEqual({ state: 'restricted', debt: 500, deadline: '2026-10-01' });
  });
});
```

`sidebar-order.test.ts`: el título del test pasa a "Uso y pagos va después de Configuración & POS y
antes de Plataforma" (el orden por `id` no cambia). Agregar:
```ts
it('la sección se llama Uso y pagos (#55)', () => {
  expect(navItems.find((i) => i.id === 'credits')?.label).toBe('Uso y pagos');
});
```

- [ ] **Paso 2: verlos fallar.**

- [ ] **Paso 3: implementar**

`credits-state.ts` (reemplaza signals y fetchers; quedan `isRestrictedSignal`, `markRestrictedFromError`,
`setOnPaymentRequired`, `whatsappPayUrl`):

```ts
const STATUS_REFRESH_MS = 5 * 60 * 1000;

/** El estado de cobro (franja y restricción): siempre que haya comercio, y cada 5 minutos. */
const billingStatusQuery = createTenantQuery<BillingStatus>({
  domain: 'billing-status',
  refetchInterval: STATUS_REFRESH_MS,
  fn: ({ tenantId, token }) => apiFetch<BillingStatus>(`tenants/${tenantId}/billing-status`, { token }),
});
export const billingStatusSignal = computed<BillingStatus | null>(() => billingStatusQuery.data.value ?? null);

export const creditsFiltersSignal = computed<CreditsFilters>(() => routeFilters('credits'));
/** Por defecto, los últimos 30 días argentinos. */
export const chargesRangeSignal = computed<{ from: string; to: string }>(() => {
  const { from, to } = creditsFiltersSignal.value;
  if (from !== undefined && to !== undefined) return { from, to };
  const today = argentinaToday(new Date());
  return { from: shiftDay(today, -29), to: today };
});

export function setChargesRange(range: { from: string; to: string }): void {
  setFilters('credits', { from: range.from, to: range.to, page: 1 });
}
export function setChargesPage(page: number): void {
  setFilters('credits', { page });
}

const onCredits = (): boolean => inSection('credits');
const warnWith = (title: string) => (err: Error): void => { showToast({ type: 'error', title, message: err.message }); };

const creditsQuery = createTenantParamQuery<CreditsResponse, readonly ['summary']>({
  domain: 'credits', params: () => ['summary'], enabled: onCredits, onError: warnWith('No se pudieron cargar los créditos'),
  fn: ({ tenantId, token }) => apiFetch<CreditsResponse>(`tenants/${tenantId}/credits`, { token }),
});
const chargesQuery = createTenantParamQuery<ChargesPage, readonly ['charges', string, string, number]>({
  domain: 'credits',
  params: () => ['charges', chargesRangeSignal.value.from, chargesRangeSignal.value.to, creditsFiltersSignal.value.page],
  enabled: () => onCredits() && creditsTabSignal.value === 'charges',
  onError: warnWith('No se pudo cargar el consumo'),
  fn: ({ tenantId, token, params: [, from, to, page] }) => {
    const query = new URLSearchParams({ from, to, page: String(page), pageSize: '50' });
    return apiFetch<ChargesPage>(`tenants/${tenantId}/credits/charges?${query.toString()}`, { token });
  },
});
const movementsQuery = createTenantParamQuery<CreditMovementItem[], readonly ['movements']>({
  domain: 'credits', params: () => ['movements'], enabled: () => onCredits() && creditsTabSignal.value === 'movements',
  onError: warnWith('No se pudieron cargar los movimientos'),
  fn: ({ tenantId, token }) => apiFetch<CreditMovementItem[]>(`tenants/${tenantId}/credits/movements`, { token }),
});
const giftsQuery = createTenantParamQuery<GiftItem[], readonly ['gifts']>({
  domain: 'credits', params: () => ['gifts'], enabled: () => onCredits() && creditsTabSignal.value === 'gifts',
  onError: warnWith('No se pudieron cargar los créditos regalados'),
  fn: ({ tenantId, token }) => apiFetch<GiftItem[]>(`tenants/${tenantId}/credits/gifts`, { token }),
});

export const creditsSignal = computed<CreditsResponse | null>(() => creditsQuery.data.value ?? null);
export const chargesSignal = computed<ChargesPage | null>(() => chargesQuery.data.value ?? null);
export const movementsSignal = computed<CreditMovementItem[]>(() => movementsQuery.data.value ?? []);
export const giftsSignal = computed<GiftItem[]>(() => giftsQuery.data.value ?? []);
export const creditsLoadingSignal = creditsQuery.isLoading;

/** Todo lo de Uso y pagos y el estado de cobro (después de una acción de plataforma). */
export async function refreshCredits(): Promise<void> {
  await invalidateAfter('platform-changed');
}

export async function fetchBillingStatus(): Promise<void> {
  await billingStatusQuery.refetch();
}
```
`creditsTabSignal` (tarea 3) tiene que estar definido antes de estas consultas.
`markRestrictedFromError`: `billingStatusSignal.value = {…}` → `billingStatusQuery.setData(() => ({ state: 'restricted', debt, deadline }));`.
Borrar el bloque final (`effect`, `setInterval`, `effect`).

`CreditsView.tsx`: título de la pantalla "Créditos" → "Uso y pagos"; `setRange` → `setChargesRange(next)`
(sin `fetchCharges`); el `Pagination` → `onPage={(p) => { setChargesPage(p); }}`.

`Sidebar.tsx`, ítem `credits`: `label: 'Uso y pagos'` y el ícono de billetera:
```tsx
d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-5m0-4h-5a2 2 0 000 4h5m-4-2h.01"
```

`platform-state.ts`: `tenantAction` sigue llamando a `refreshCredits()` (ahora invalida).

Buscar con `rg "Créditos" src/client` y cambiar los textos visibles que nombran la sección (banner,
`RestrictedView`: "Ver créditos y cómo pagar" → "Ver uso y pagos"). Los que hablan de "créditos
regalados" o "saldo de créditos" quedan: es la unidad, no la sección.

- [ ] **Paso 4: correr** → PASS; `pnpm test` → PASS.

- [ ] **Paso 5: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test
git commit -m "feat: Uso y pagos (ex Créditos) con TanStack Query y rango en la URL (#55, #59)"
```

Frenar: revisión de la tarea 11.

---

### Tarea 12: Usuarios y plataforma

**Archivos:**
- Modificar: `src/client/state/users-state.ts`, `src/client/state/platform-state.ts`
- Tests: `test/users-client.test.ts`, `test/platform-client.test.ts`

**Interfaces:**
- Produce: `membersSignal`, `invitationsSignal`, `auditSignal`, `usersLoadingSignal` (`computed`);
  `platformPaymentsSignal`, `platformSettingsSignal` (`computed`). Se borran `loadUsers`, `loadAudit`;
  `fetchPlatformPayments` y `fetchPlatformSettings` refrescan.

- [ ] **Paso 1: tests que fallan** (sumar)

```ts
// users-client.test.ts
it('al entrar a Usuarios pide usuarios y, al owner, la actividad (#59)', async () => {
  atTenant('t1', 'usuarios');
  await vi.waitFor(() => { expect(endpoints().some((e) => e.endsWith('/users'))).toBe(true); });
  expect(endpoints().some((e) => e.endsWith('/audit'))).toBe(true);
});
it('invitar deja viejos usuarios y actividad (#59)', async () => {
  queryClient.setQueryData(tenantKey('t1', 'audit'), []);
  // … mock del POST de invitación, como el test existente
  await submitInvite();
  expect(queryClient.getQueryState(tenantKey('t1', 'audit'))?.isInvalidated).toBe(true);
});

// platform-client.test.ts
it('en /plataforma pide pagos y configuración (#59)', async () => {
  navigate('/plataforma');
  await vi.waitFor(() => { expect(endpoints()).toEqual(expect.arrayContaining(['/api/platform/payments', '/api/platform/settings'])); });
});
it('aplicar la planilla deja viejos los pagos y el estado de cobro (#59)', async () => {
  queryClient.setQueryData(['platform', 'payments'], []);
  // … mock de la planilla aplicada, como el test existente
  await applySheet();
  expect(queryClient.getQueryState(['platform', 'payments'])?.isInvalidated).toBe(true);
});
```
(`endpoints()` es el helper local de URLs pedidas, como en ventas.)

- [ ] **Paso 2: verlos fallar.**

- [ ] **Paso 3: implementar**

`users-state.ts`:
```ts
const usersQuery = createTenantQuery<{ members: MemberItem[]; invitations: InvitationItem[] }>({
  domain: 'users',
  enabled: () => inSection('users') && canDo('users.manage'),
  onError: (err) => { fail('No se pudieron cargar los usuarios', err); },
  fn: ({ tenantId, token }) => apiFetch(`tenants/${tenantId}/users`, { token }),
});
const auditQuery = createTenantQuery<AuditItem[]>({
  domain: 'audit',
  enabled: () => inSection('users') && canDo('owners.manage'),
  onError: (err) => { fail('No se pudo cargar la actividad', err); },
  fn: ({ tenantId, token }) => apiFetch<AuditItem[]>(`tenants/${tenantId}/audit`, { token }),
});
export const membersSignal = computed<MemberItem[]>(() => usersQuery.data.value?.members ?? []);
export const invitationsSignal = computed<InvitationItem[]>(() => usersQuery.data.value?.invitations ?? []);
export const auditSignal = computed<AuditItem[]>(() => auditQuery.data.value ?? []);
export const usersLoadingSignal = usersQuery.isLoading;

async function reloadAll(): Promise<void> {
  await invalidateAfter('users-changed');
}
```
`fn` con `apiFetch<{ members: MemberItem[]; invitations: InvitationItem[] }>(…)`. En `createResetLink`,
`if (canDo('owners.manage')) await loadAudit();` → `await reloadAll();`. Borrar `loadUsers`, `loadAudit`
y el `effect` final. `fail` tiene que estar definido antes de las consultas.

`platform-state.ts`:
```ts
const platformSource = <T>(name: 'payments' | 'settings', path: string) => (): QuerySource<T> | null => {
  const token = tokenSignal.value;
  return token ? { key: platformKey(name), fn: () => apiFetch<T>(path, { token }) } : null;
};
const paymentsQuery = createSignalQuery<PlatformPaymentItem[]>({
  source: platformSource('payments', '/api/platform/payments'),
  enabled: () => inSection('platform'),
  onError: (err) => { fail(err, 'No se pudieron cargar los pagos'); },
});
const settingsQuery = createSignalQuery<BillingSettings>({
  source: platformSource('settings', '/api/platform/settings'),
  enabled: () => inSection('platform'),
  onError: (err) => { fail(err, 'No se pudo cargar la configuración'); },
});
export const platformPaymentsSignal = computed<PlatformPaymentItem[]>(() => paymentsQuery.data.value ?? []);
export const platformSettingsSignal = computed<BillingSettings | null>(() => settingsQuery.data.value ?? null);
export async function fetchPlatformPayments(): Promise<void> {
  await paymentsQuery.refetch();
}
export async function fetchPlatformSettings(): Promise<void> {
  await settingsQuery.refetch();
}
```
En `sendSheet`, `await fetchPlatformPayments();` → `await invalidateAfter('platform-changed');`. En
`savePlatformSettings`, `platformSettingsSignal.value = await apiFetch…` →
`const saved = await apiFetch<BillingSettings>(…); settingsQuery.setData(() => saved); void invalidateAfter('platform-changed');`.
Borrar el `effect` final.

- [ ] **Paso 4: correr** → PASS; `pnpm test` → PASS.

- [ ] **Paso 5: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test
git commit -m "feat: usuarios y plataforma con TanStack Query e invalidación (#59)"
```

Frenar: revisión de la tarea 12.

---

### Tarea 13: Masivas e importación

**Archivos:**
- Modificar: `src/client/state/bulk-state.ts`, `src/client/state/import-state.ts`,
  `src/client/state/example-catalog-state.ts`, `src/client/state/merchant-onboarding-state.ts`
  (`loadExampleCatalogOnSignup`)
- Tests: `test/bulk-client.test.ts`, `test/import-client.test.ts`, `test/example-catalog-client.test.ts`

**Interfaces:**
- Produce: `exampleCatalogSignal` (`computed`); `fetchExampleCatalog` refresca.

- [ ] **Paso 1: tests que fallan** (sumar)

```ts
// bulk-client.test.ts
it('aplicar precios masivos deja viejos catálogo y dashboard (#59)', async () => {
  queryClient.setQueryData(tenantKey('tienda-test', 'products'), []);
  // … mock de fetch del POST, como el test existente de applyBulkPrices
  await applyBulkPrices();
  expect(queryClient.getQueryState(tenantKey('tienda-test', 'products'))?.isInvalidated).toBe(true);
});
it('devengar intereses deja viejos clientes y extractos (#59)', async () => {
  queryClient.setQueryData(tenantKey('tienda-test', 'customers'), []);
  // … mock de applyBulkInterests
  await applyBulkInterests();
  expect(queryClient.getQueryState(tenantKey('tienda-test', 'customers'))?.isInvalidated).toBe(true);
});

// import-client.test.ts
it.each([
  ['customers', 'customers'],
  ['products', 'stock'],
] as const)('importar %s deja vieja la pantalla de %s (#59)', async (entity, domain) => {
  queryClient.setQueryData(tenantKey('t1', domain), []);
  importEntitySignal.value = entity;
  // … mock de confirmImport, como el test existente
  await confirmImport();
  expect(queryClient.getQueryState(tenantKey('t1', domain))?.isInvalidated).toBe(true);
});

// example-catalog-client.test.ts
it('se consulta en Masivas → Importar / Exportar (#59)', async () => {
  atTenant('t1', 'masivas/archivos');
  await vi.waitFor(() => { expect(endpoints().some((e) => e.endsWith('/catalog/example'))).toBe(true); });
});
```

- [ ] **Paso 2: verlos fallar.**

- [ ] **Paso 3: implementar**

- `bulk-state.ts`: en `applyBulkPrices`, después del toast de éxito, `void invalidateAfter('bulk-prices');`;
  en `applyBulkInterests`, `void invalidateAfter('bulk-interests');`.
- `import-state.ts`: en `confirmImport`, después de `importStepSignal.value = 'done';`,
  `void invalidateAfter(importEntitySignal.value === 'customers' ? 'customers-imported' : 'products-imported');`.
  El `effect` que resetea al cambiar de comercio queda (lee `effectiveTenantIdSignal`, que ahora sale de la URL).
- `example-catalog-state.ts`:
  ```ts
  const exampleQuery = createTenantQuery<ExampleCatalogStatus | null>({
    domain: 'example-catalog',
    // Mientras se mapea un archivo no cambia nada; al terminar, quizás ya hay productos
    enabled: () => inSection('bulk') && activeBulkTabSignal.value === 'io' && importStepSignal.value !== 'mapping',
    fn: ({ tenantId, token }) => apiFetch<ExampleCatalogStatus>(`tenants/${tenantId}/catalog/example`, { token }).catch(() => null),
  });
  export const exampleCatalogSignal = computed<ExampleCatalogStatus | null>(() => exampleQuery.data.value ?? null);
  export async function fetchExampleCatalog(): Promise<void> {
    await exampleQuery.refetch();
  }
  ```
  En `applyExampleCatalog`, la escritura → `exampleQuery.setData((prev) => ({ businessType: prev?.businessType ?? null, available: false }));`
  y `void invalidateAfter('products-imported');`. Borrar el `effect` final.
- `merchant-onboarding-state.ts`, `loadExampleCatalogOnSignup`: después del POST,
  `void invalidateAfter('products-imported');`.

- [ ] **Paso 4: correr** → PASS; `pnpm test` → PASS.

- [ ] **Paso 5: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A src/client test
git commit -m "feat: masivas, importación y catálogo de ejemplo invalidan lo que cambian (#59)"
```

Frenar: revisión de la tarea 13.

---

### Tarea 14: e2e de navegación, AGENTS.md, versión y cierre

**Archivos:**
- Crear: `e2e/navigation.spec.ts`
- Modificar: `AGENTS.md`, `docs/superpowers/specs/2026-10-04-router-query-design.md` (los ajustes de este
  plan), `package.json` (versión)
- Borrar: `docs/superpowers/plans/2026-10-04-router-query.md`

- [ ] **Paso 1: el e2e**

```ts
// e2e/navigation.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Criterio de aceptación de #59: cada pantalla con su URL, atrás y adelante, un link directo a otro
 * comercio, y una cobranza que se ve en Ventas y en Clientes sin recargar.
 */

async function enterAs(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => { window.localStorage.setItem('mini_erp_token', t); }, token);
}

test('URLs, atrás y adelante, link directo y datos al día después de cobrar', async ({ page, request }) => {
  const id = randomUUID().slice(0, 8);
  const alta = await request.post('/api/alta', {
    data: { name: 'Owner Nav', email: `nav-${id}@local.test`, password: 'clave-owner-1', businessName: `Kiosco Nav ${id}`, businessType: 'kiosco', whatsapp: '1155550000' },
  });
  expect(alta.status()).toBe(201);
  const { token, tenant } = (await alta.json()) as { token: string; tenant: { id: string } };
  const auth = { Authorization: `Bearer ${token}` };
  const second = await request.post('/api/alta', { headers: auth, data: { businessName: `Almacén Nav ${id}`, businessType: 'almacen' } });
  expect(second.status()).toBe(201);
  const other = ((await second.json()) as { tenant: { id: string } }).tenant.id;
  const customer = await request.post(`/api/tenants/${other}/customers`, {
    headers: auth, data: { name: `Ana Nav ${id}`, creditLimit: 50000, margin: 0, unrestricted: false, initialBalance: 5000 },
  });
  expect(customer.status()).toBe(201);

  await enterAs(page, token);

  // Link directo a una pantalla con filtro de otro comercio
  await page.goto(`/admin/${other}/clientes?q=Ana`);
  await expect(page.getByText(`Almacén Nav ${id}`).first()).toBeVisible();
  await expect(page.getByPlaceholder('Buscar por nombre, DNI/CUIT o teléfono...')).toHaveValue('Ana');
  await expect(page.getByRole('row', { name: new RegExp(`Ana Nav ${id}`) })).toBeVisible();

  // Pantallas y solapas con su URL; atrás y adelante
  await page.getByRole('link', { name: 'Catálogo & Precios' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/catalogo$`));
  await page.getByRole('link', { name: 'Ventas & Caja' }).click();
  await page.getByRole('tab', { name: 'Cobranzas' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/ventas/cobranzas$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/ventas$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/catalogo$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/ventas$`));

  // Cobrar en Clientes y verlo en Ventas → Cobranzas y en el saldo, sin recargar
  await page.getByRole('link', { name: 'Clientes & CC' }).click();
  await page.getByRole('row', { name: new RegExp(`Ana Nav ${id}`) }).getByTitle('Registrar pago / cobranza').click();
  await page.locator('input[type="number"]').fill('1000');
  await page.getByRole('button', { name: /Confirmar Cobro/ }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Ana Nav ${id}`) })).toContainText(/4[.,]000/);
  await page.getByRole('link', { name: 'Ventas & Caja' }).click();
  await page.getByRole('tab', { name: 'Cobranzas' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Ana Nav ${id}`) })).toBeVisible();

  // Cambiar de comercio mantiene la pantalla
  await page.getByRole('button', { name: new RegExp(`Almacén Nav ${id}`) }).click();
  await page.getByRole('button', { name: new RegExp(`Kiosco Nav ${id}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${tenant.id}/ventas/cobranzas$`));
});

test('un empleado cae en el dashboard sin permiso, y en "sin acceso" con un comercio ajeno', async ({ page, request }) => {
  const login = await request.post('/api/auth/login', { data: { email: 'empleado-k@local.test', password: 'admin123' } });
  expect(login.status()).toBe(200);
  const { token } = (await login.json()) as { token: string };
  await enterAs(page, token);

  await page.goto('/admin/kiosco-don-pepe/usuarios');
  await expect(page).toHaveURL(/\/admin\/kiosco-don-pepe\/dashboard$/);

  await page.goto('/admin/ferreteria-el-tornillo/dashboard');
  await expect(page.getByText('No tenés acceso a este comercio o no existe')).toBeVisible();
});
```

> Si algún nombre accesible no coincide (el selector de comercio del header, el `input` del importe),
> ajustarlo al que muestre `pnpm test:e2e --debug` sin cambiar lo que el test verifica.

Run: `pnpm test:e2e` → PASS (los cuatro specs).

- [ ] **Paso 2: AGENTS.md (sección Cliente)**

Reemplazar el párrafo "Un solo SPA con ruteo por path (`state/route-state.ts`): …" por:

```markdown
  - **Router propio con una URL por pantalla** (#59, spec `docs/superpowers/specs/2026-10-04-router-query-design.md`):
    landing en `/`, alta en `/alta` (`/onboarding` se reescribe), los links en `/invitacion` y
    `/restablecer`, el admin en `/admin/<slug-comercio>/<sección>[/<solapa>][?filtros]` y la
    plataforma en `/plataforma`. La tabla (secciones, solapas y códecs de filtros, en castellano y sin
    acentos) es pura, en `routing/admin-routes.ts`; `state/route-state.ts` tiene la URL como signal y
    es el único que escribe el historial (`test/client-guards.test.ts`). Cambiar de comercio, sección
    o solapa agrega una entrada (`goTo`, `<Link>`); un filtro la reemplaza (`setFilters`). El menú abre
    la sección limpia.
  - **El comercio activo es el de la URL** (`effectiveTenantIdSignal`, en `auth-state.ts`): un slug
    ajeno muestra "No tenés acceso", nunca una redirección muda; `localStorage` solo guarda el último
    usado, para `/admin` pelado. Así cada pestaña tiene su comercio (base de M7).
  - **Datos con TanStack Query** (`@tanstack/query-core`): `createSignalQuery`/`createTenantQuery`
    (`api/query-client.ts`, `state/query-keys.ts`) con clave `['t', comercio, dominio, …]`,
    habilitadas con su pantalla (`inSection`). Caché al toque y refresco al entrar y al volver a la
    pestaña (`staleTime: 0`). Cada mutación llama a `invalidateAfter(evento)` y la tabla evento →
    dominios está en `state/invalidation.ts`. La caché se borra al cambiar de sesión y lo de otros
    comercios al cambiar de comercio. Nada de `effect` de carga en los stores ni de `view-loader`.
```

En "Créditos y cobro", agregar al final: "La sección del admin se llama **Uso y pagos**
(`/admin/<comercio>/uso-y-pagos`, #55)."

- [ ] **Paso 3: la spec**

Agregar al final de la spec una sección "Ajustes de la implementación" con los seis puntos de "Ajustes a
la spec que fija este plan" (arriba), tal cual.

- [ ] **Paso 4: versión y borrado del plan**

```bash
pnpm version minor --no-git-tag-version
git rm docs/superpowers/plans/2026-10-04-router-query.md
```
Esperado: `package.json` en `0.11.0`.

- [ ] **Paso 5: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm test:e2e
git add -A e2e AGENTS.md docs package.json
git commit -m "docs: router y TanStack Query en AGENTS.md, e2e de navegación y versión 0.11.0 (#59, #55)"
```

Frenar: revisión final y el informe con la prueba manual (lista para tildar, empezando por la carpeta
del worktree y la rama). El PR, con "Closes #59" y "Closes #55", solo con el OK del usuario.
