import { effect, signal } from '@preact/signals';
import { ApiError, apiFetch } from '../api/client.ts';
import { adoptAnonymous } from './auth-state.ts';
import { navigate, routeSignal } from './route-state.ts';
import { adminUrl } from '../routing/admin-routes.ts';
import type { PortalRedeemResponse } from '../../shared/portal-types.ts';

/**
 * El portal en el cliente (#24, M10): el POS abre `/portal#t=<token>` en una pestaña nueva; acá se
 * canjea el token por la sesión anónima (que guarda `auth-state`). Una demo abre Ventas en su caja; una
 * caja real, el resumen de hoy de su caja.
 */
export type PortalStatus = { kind: 'idle' | 'working' | 'expired' } | { kind: 'error'; message: string };
export const portalStatusSignal = signal<PortalStatus>({ kind: 'idle' });

export async function redeemFromHash(hash: string): Promise<void> {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('t') ?? '';
  if (token === '') {
    portalStatusSignal.value = { kind: 'expired' };
    return;
  }
  portalStatusSignal.value = { kind: 'working' };
  try {
    const start = await apiFetch<PortalRedeemResponse>('portal/redeem', { method: 'POST', body: { token } });
    adoptAnonymous(start);
    portalStatusSignal.value = { kind: 'idle' };
    // `replace`: el token del fragmento no queda en el historial
    const filters = { preset: 'today', page: 1, status: 'all', branch: start.branch, pointOfSale: start.pointOfSale } as const;
    const tab = start.access === 'register' ? 'summary' : undefined;
    navigate(adminUrl(start.tenant.slug, 'sales', { filters, tab }), { replace: true });
  } catch (err: unknown) {
    portalStatusSignal.value =
      err instanceof ApiError && err.status === 410
        ? { kind: 'expired' }
        : { kind: 'error', message: err instanceof Error ? err.message : 'No se pudo abrir mini' };
  }
}

/** En `/portal`, canjea una vez. */
export function registerPortalEffects(): () => void {
  return effect(() => {
    if (routeSignal.value.kind !== 'portal' || portalStatusSignal.peek().kind !== 'idle') return;
    void redeemFromHash(typeof window === 'undefined' ? '' : window.location.hash);
  });
}

if (typeof window !== 'undefined') {
  registerPortalEffects();
}
