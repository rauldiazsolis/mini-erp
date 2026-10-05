import { computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { createSignalQuery, type QuerySource } from '../api/query-client.ts';
import { impersonationSignal, isRootOrSupportSignal, tokenSignal } from './auth-state.ts';
import { routeSignal } from './route-state.ts';
import { platformKey } from './query-keys.ts';
import { invalidateAfter } from './invalidation.ts';
import { showToast } from './toast-state.ts';
import type { FunnelReport, FunnelVisitorDetail, FunnelVisitorList } from '../../shared/funnel-types.ts';

/**
 * El embudo de la plataforma (#25), para root y soporte: el reporte, la lista de visitantes, la
 * historia de uno y los contactos sin atender (el contador del menú). Los filtros salen de la URL.
 */

type Params = Record<string, string>;

/** Los filtros de la sección, si es la activa y no es la historia de un visitante. Reactiva. */
function paramsOf(section: 'funnel' | 'visitors'): Params | null {
  const route = routeSignal.value;
  if (route.kind !== 'plataforma' || route.section !== section || route.tenantSlug !== null || route.params['id'] !== undefined) return null;
  return route.params;
}

function queryString(p: Params): string {
  const s = new URLSearchParams(p).toString();
  return s === '' ? '' : `?${s}`;
}

function failed(title: string): (err: unknown) => void {
  return (err: unknown) => {
    showToast({ type: 'error', title, message: err instanceof Error ? err.message : 'Error inesperado' });
  };
}

const reportQuery = createSignalQuery<FunnelReport>({
  source: (): QuerySource<FunnelReport> | null => {
    const t = tokenSignal.value;
    const p = paramsOf('funnel');
    if (t === null || p === null) return null;
    return { key: platformKey('funnel', p), fn: () => apiFetch<FunnelReport>(`/api/platform/funnel${queryString(p)}`, { token: t }) };
  },
  keepPrevious: () => true,
  onError: failed('No se pudo cargar el embudo'),
});

const visitorsQuery = createSignalQuery<FunnelVisitorList>({
  source: (): QuerySource<FunnelVisitorList> | null => {
    const t = tokenSignal.value;
    const p = paramsOf('visitors');
    if (t === null || p === null) return null;
    return { key: platformKey('visitors', p), fn: () => apiFetch<FunnelVisitorList>(`/api/platform/visitors${queryString(p)}`, { token: t }) };
  },
  keepPrevious: () => true,
  onError: failed('No se pudieron cargar los visitantes'),
});

/** El id de la historia, en `/plataforma/visitantes/<id>`. */
export const visitorIdSignal = computed<string | null>(() => {
  const route = routeSignal.value;
  return route.kind === 'plataforma' && route.section === 'visitors' ? (route.params['id'] ?? null) : null;
});

const visitorQuery = createSignalQuery<FunnelVisitorDetail>({
  source: (): QuerySource<FunnelVisitorDetail> | null => {
    const t = tokenSignal.value;
    const id = visitorIdSignal.value;
    if (t === null || id === null) return null;
    return {
      key: platformKey('visitor', id),
      fn: () => apiFetch<FunnelVisitorDetail>(`/api/platform/visitors/${encodeURIComponent(id)}`, { token: t }),
    };
  },
  onError: failed('No se pudo cargar el visitante'),
});

/** Root y soporte con su sesión propia: impersonando se ve el menú del usuario. */
const pendingQuery = createSignalQuery<{ count: number }>({
  source: (): QuerySource<{ count: number }> | null => {
    const t = tokenSignal.value;
    if (t === null || !isRootOrSupportSignal.value || impersonationSignal.value !== null) return null;
    return { key: platformKey('contacts-pending'), fn: () => apiFetch<{ count: number }>('/api/platform/contacts/pending-count', { token: t }) };
  },
});

export const funnelReportSignal = computed<FunnelReport | null>(() => reportQuery.data.value ?? null);
export const funnelReportLoadingSignal = reportQuery.isLoading;
export const visitorListSignal = computed<FunnelVisitorList | null>(() => visitorsQuery.data.value ?? null);
export const visitorListLoadingSignal = visitorsQuery.isLoading;
export const visitorDetailSignal = computed<FunnelVisitorDetail | null>(() => visitorQuery.data.value ?? null);
export const visitorDetailLoadingSignal = visitorQuery.isLoading;
export const pendingContactsSignal = computed<number>(() => pendingQuery.data.value?.count ?? 0);

export async function markContactHandled(contactId: string): Promise<boolean> {
  const t = tokenSignal.peek();
  if (t === null) return false;
  try {
    await apiFetch(`/api/platform/contacts/${encodeURIComponent(contactId)}/handled`, { method: 'POST', token: t });
    await invalidateAfter('platform-changed');
    showToast({ type: 'success', title: 'Contacto atendido' });
    return true;
  } catch (err: unknown) {
    failed('No se pudo marcar el contacto')(err);
    return false;
  }
}

/** El WhatsApp del contacto, con el saludo armado (#25), como los pedidos de ayuda. */
export function contactWhatsappUrl(name: string | null, whatsapp: string): string {
  const hello = name === null || name.trim() === '' ? 'Hola' : `Hola ${name.trim()}`;
  const text = `${hello}, te escribo de mini contax por tu pedido de ayuda para empezar.`;
  return `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** % entero sobre la cohorte; sin cohorte, un guion. */
export function percentOf(part: number, whole: number): string {
  return whole === 0 ? '—' : `${String(Math.round((part / whole) * 100))} %`;
}
