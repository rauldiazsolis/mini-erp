import { computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { createSignalQuery, type QuerySource } from '../api/query-client.ts';
import { tokenSignal } from './auth-state.ts';
import { routeSignal } from './route-state.ts';
import { platformKey } from './query-keys.ts';
import { invalidateAfter } from './invalidation.ts';
import { showToast } from './toast-state.ts';
import type { PlatformMemberItem, PlatformTenantDetail, PlatformTenantItem } from '../../shared/platform-types.ts';

/**
 * El panel de plataforma (#23), para root y soporte: comercios y su detalle. Los filtros y el comercio
 * del detalle salen de la URL (`/plataforma?q=…`, `/plataforma/comercios/<slug>`).
 */

function fail(err: unknown, title: string): false {
  showToast({ type: 'error', title, message: err instanceof Error ? err.message : 'Error inesperado' });
  return false;
}

/** El texto de búsqueda de una solapa de la plataforma, si es la activa; si no, `null`. */
function searchOf(tab: 'tenants' | 'users'): string | null {
  const route = routeSignal.value;
  if (route.kind !== 'plataforma' || route.tab !== tab || route.tenantSlug !== null) return null;
  return route.params['q'] ?? '';
}

const tenantsQuery = createSignalQuery<PlatformTenantItem[]>({
  source: (): QuerySource<PlatformTenantItem[]> | null => {
    const t = tokenSignal.value;
    const q = searchOf('tenants') ?? '';
    if (t === null) return null;
    const query = q === '' ? '' : `?q=${encodeURIComponent(q)}`;
    return { key: platformKey('tenants', q), fn: () => apiFetch<PlatformTenantItem[]>(`/api/platform/tenants${query}`, { token: t }) };
  },
  enabled: () => searchOf('tenants') !== null,
  keepPrevious: (prev, next) => prev[1] === next[1],
  onError: (err) => {
    fail(err, 'No se pudieron cargar los comercios');
  },
});

/** El slug del comercio del detalle, en `/plataforma/comercios/<slug>`. */
const detailSlugSignal = computed<string | null>(() => {
  const route = routeSignal.value;
  return route.kind === 'plataforma' ? route.tenantSlug : null;
});

const detailQuery = createSignalQuery<PlatformTenantDetail>({
  source: (): QuerySource<PlatformTenantDetail> | null => {
    const t = tokenSignal.value;
    const slug = detailSlugSignal.value;
    if (t === null || slug === null) return null;
    return {
      key: platformKey('tenant', slug),
      fn: () => apiFetch<PlatformTenantDetail>(`/api/platform/tenants/by-slug/${encodeURIComponent(slug)}`, { token: t }),
    };
  },
  onError: (err) => {
    fail(err, 'No se pudo cargar el comercio');
  },
});

export const platformTenantsSignal = computed<PlatformTenantItem[]>(() => tenantsQuery.data.value ?? []);
export const platformTenantsLoadingSignal = tenantsQuery.isLoading;
export const platformTenantDetailSignal = computed<PlatformTenantDetail | null>(() => detailQuery.data.value ?? null);
export const platformTenantDetailLoadingSignal = detailQuery.isLoading;
export const platformTenantDetailErrorSignal = detailQuery.error;

/** Los owners activos del comercio: los únicos que pueden ser titulares. */
export function activeOwners(detail: PlatformTenantDetail | null): PlatformMemberItem[] {
  return (detail?.members ?? []).filter((m) => m.role === 'owner' && m.status === 'active');
}

async function post(path: string, body: Record<string, unknown>, done: string, failTitle: string): Promise<boolean> {
  const t = tokenSignal.value;
  if (t === null) return false;
  try {
    await apiFetch(path, { method: 'POST', token: t, body });
    showToast({ type: 'success', title: 'Listo', message: done });
    await invalidateAfter('platform-changed');
    return true;
  } catch (err: unknown) {
    return fail(err, failTitle);
  }
}

export function suspendTenant(tenantId: string, reason: string): Promise<boolean> {
  return post(`/api/platform/tenants/${encodeURIComponent(tenantId)}/suspend`, { reason }, 'Comercio suspendido', 'No se pudo suspender');
}

export function reactivateTenant(tenantId: string): Promise<boolean> {
  return post(`/api/platform/tenants/${encodeURIComponent(tenantId)}/reactivate`, {}, 'Comercio reactivado', 'No se pudo reactivar');
}
