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
  return createTenantParamQuery<T, readonly []>({ ...o, params: () => [], fn: ({ tenantId, token }) => o.fn({ tenantId, token }) });
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
