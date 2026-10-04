import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/client/api/client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client/api/client.ts')>()),
  apiFetch: vi.fn(() => Promise.resolve([])),
}));

import { apiFetch } from '../src/client/api/client.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { invalidateAfter } from '../src/client/state/invalidation.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { locationSignal, setHistoryForTests } from '../src/client/state/route-state.ts';
import { dashboardFiltersSignal, setDashboardFilters } from '../src/client/state/dashboard-state.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

const calls = (fragment: string): number =>
  vi.mocked(apiFetch).mock.calls.filter(([endpoint]) => endpoint.includes(fragment)).length;

describe('Cargas del dashboard (#7, #59)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    freshSession('token');
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

  it('período y sucursal salen de la URL y se escriben en ella', () => {
    atTenant('kiosco', 'dashboard?periodo=mes&sucursal=CENTRAL');
    expect(dashboardFiltersSignal.value).toEqual({ period: 'month', branch: 'CENTRAL' });
    setDashboardFilters({ period: 'week' });
    expect(locationSignal.value.search).toBe('?sucursal=CENTRAL');
  });

  it('una cobranza hecha en Clientes se ve al volver al dashboard', async () => {
    atTenant('kiosco', 'dashboard');
    await vi.waitFor(() => { expect(queryClient.getQueryState(tenantKey('kiosco', 'dashboard', 'week', ''))?.status).toBe('success'); });
    atTenant('kiosco', 'clientes');
    await invalidateAfter('customer-payment');
    expect(queryClient.getQueryState(tenantKey('kiosco', 'dashboard', 'week', ''))?.isInvalidated).toBe(true);
    vi.mocked(apiFetch).mockClear();
    atTenant('kiosco', 'dashboard');
    await vi.waitFor(() => { expect(calls('/dashboard/summary')).toBe(1); });
  });
});
