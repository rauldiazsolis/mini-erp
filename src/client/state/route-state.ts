import { computed, signal } from '@preact/signals';
import {
  adminUrl, buildUrl, decodeFilters, encodeFilters, parseLocation,
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
export function tabUrl<S extends TenantSection>(section: S, tab: TabId<S>, filters?: FiltersOf[S]): string {
  const slug = currentTenantSlugSignal.value;
  return slug === null ? '/admin' : adminUrl(slug, section, { tab, filters });
}
