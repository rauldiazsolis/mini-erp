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
