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
