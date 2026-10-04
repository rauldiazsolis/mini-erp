import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  creditsSignal,
  chargesSignal,
  chargesRangeSignal,
  billingStatusSignal,
  isRestrictedSignal,
  fetchBillingStatus,
  markRestrictedFromError,
  refreshCredits,
  setChargesPage,
  setChargesRange,
  whatsappPayUrl,
} from '../src/client/state/credits-state.ts';
import { ApiError, apiFetch } from '../src/client/api/client.ts';
import { userTenantsSignal, impersonationSignal } from '../src/client/state/auth-state.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { locationSignal, setHistoryForTests } from '../src/client/state/route-state.ts';
import { argentinaToday, shiftDay } from '../src/shared/argentina-day.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

type Call = { url: string; method: string };

describe('estado de Uso y pagos (#21, #55)', () => {
  let calls: Call[];
  let reply: { status: number; body: unknown };
  let billing: unknown;

  beforeEach(() => {
    setHistoryForTests(null);
    freshSession('mock-token');
    impersonationSignal.value = null;
    calls = [];
    reply = { status: 200, body: {} };
    billing = { state: 'ok', debt: 0, deadline: null };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init?.method ?? 'GET' });
      const isStatus = url.endsWith('/billing-status');
      return Promise.resolve(new Response(JSON.stringify(isStatus ? billing : reply.body), {
        status: isStatus ? 200 : reply.status,
        headers: { 'content-type': 'application/json' },
      }));
    });
    userTenantsSignal.value = [{ tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' }];
    atTenant('tienda-test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Sin pedidos en curso: el estado de cobro del comercio ya llegó. */
  const settled = (): Promise<void> => vi.waitFor(() => { expect(queryClient.isFetching()).toBe(0); });

  it('al entrar pide el resumen y el consumo del rango y la página de la URL', async () => {
    reply.body = { state: 'ok', giftBalance: 50000, items: [], count: 0, page: 2, pageSize: 50, total: 0 };
    atTenant('tienda-test', 'uso-y-pagos?desde=2026-09-06&hasta=2026-10-05&pagina=2');
    await vi.waitFor(() => {
      expect(calls.map((c) => c.url)).toEqual(expect.arrayContaining([
        '/api/tenants/tienda-test/credits',
        '/api/tenants/tienda-test/credits/charges?from=2026-09-06&to=2026-10-05&page=2&pageSize=50',
      ]));
    });
    await vi.waitFor(() => { expect(creditsSignal.value).toMatchObject({ giftBalance: 50000 }); });
    expect(chargesSignal.value?.page).toBe(2);
  });

  it('movimientos y bonos se piden en su solapa', async () => {
    reply.body = [];
    atTenant('tienda-test', 'uso-y-pagos/movimientos');
    await vi.waitFor(() => { expect(calls.some((c) => c.url.endsWith('/credits/movements'))).toBe(true); });
    expect(calls.some((c) => c.url.includes('/credits/charges'))).toBe(false);
    atTenant('tienda-test', 'uso-y-pagos/bonos');
    await vi.waitFor(() => { expect(calls.some((c) => c.url.endsWith('/credits/gifts'))).toBe(true); });
  });

  it('el rango del consumo sale de la URL; sin rango, los últimos 30 días', () => {
    atTenant('tienda-test', 'uso-y-pagos?desde=2026-09-01&hasta=2026-09-30');
    expect(chargesRangeSignal.value).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    atTenant('tienda-test', 'uso-y-pagos');
    const today = argentinaToday(new Date());
    expect(chargesRangeSignal.value).toEqual({ from: shiftDay(today, -29), to: today });
  });

  it('cambiar el rango vuelve a la primera página; la página va en la URL', () => {
    atTenant('tienda-test', 'uso-y-pagos?pagina=3');
    setChargesRange({ from: '2026-09-01', to: '2026-09-30' });
    expect(locationSignal.value.search).toBe('?desde=2026-09-01&hasta=2026-09-30');
    setChargesPage(2);
    expect(locationSignal.value.search).toBe('?desde=2026-09-01&hasta=2026-09-30&pagina=2');
  });

  it('el estado de cobro se pide con el comercio, en cualquier pantalla', async () => {
    await vi.waitFor(() => { expect(calls.some((c) => c.url === '/api/tenants/tienda-test/billing-status')).toBe(true); });
  });

  it('el estado restringido bloquea al usuario, no a soporte impersonando', async () => {
    await settled();
    billing = { state: 'restricted', debt: 1000, deadline: '2026-10-13' };
    await fetchBillingStatus();
    expect(isRestrictedSignal.value).toBe(true);
    impersonationSignal.value = { slug: 'tienda-test', fromSlug: null };
    expect(isRestrictedSignal.value).toBe(false);
  });

  it('un 402 billing-restricted deja el comercio restringido en la caché del estado de cobro', async () => {
    await settled();
    expect(markRestrictedFromError(new ApiError(500, 'x', {}))).toBe(false);
    expect(isRestrictedSignal.value).toBe(false);
    expect(markRestrictedFromError(new ApiError(402, 'x', { code: 'billing-restricted', debt: 500, deadline: '2026-10-01' }))).toBe(true);
    expect(billingStatusSignal.value).toEqual({ state: 'restricted', debt: 500, deadline: '2026-10-01' });
  });

  it('cualquier pedido que recibe el 402 deja la restricción a la vista', async () => {
    await settled();
    reply = { status: 402, body: { code: 'billing-restricted', error: 'mini contax está restringido por deuda', debt: 2000, deadline: '2026-10-13' } };
    await expect(apiFetch('tenants/tienda-test/products', { token: 'mock-token' })).rejects.toThrow('mini contax está restringido por deuda');
    expect(isRestrictedSignal.value).toBe(true);
  });

  it('refreshCredits deja viejo Uso y pagos y vuelve a pedir el estado de cobro, que está siempre a la vista', async () => {
    await settled();
    const statusCalls = (): number => calls.filter((c) => c.url.endsWith('/billing-status')).length;
    const before = statusCalls();
    queryClient.setQueryData(tenantKey('tienda-test', 'credits', 'summary'), {});
    await refreshCredits();
    expect(queryClient.getQueryState(tenantKey('tienda-test', 'credits', 'summary'))?.isInvalidated).toBe(true);
    expect(statusCalls()).toBe(before + 1);
  });

  it('el link de WhatsApp deja solo los dígitos del teléfono y arma el mensaje', () => {
    expect(whatsappPayUrl({ phone: '+54 9 11 5555-1234', tenantName: 'Kiosco' })).toBe(
      `https://wa.me/5491155551234?text=${encodeURIComponent('Hola, soy de Kiosco. Ya transferí para cargar saldo en mini contax.')}`,
    );
  });
});
