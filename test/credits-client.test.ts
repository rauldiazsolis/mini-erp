import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  creditsSignal,
  chargesSignal,
  chargesRangeSignal,
  billingStatusSignal,
  isRestrictedSignal,
  fetchCredits,
  fetchCharges,
  fetchBillingStatus,
  markRestrictedFromError,
  whatsappPayUrl,
} from '../src/client/state/credits-state.ts';
import { ApiError, apiFetch } from '../src/client/api/client.ts';
import { tokenSignal, userTenantsSignal, impersonationSignal } from '../src/client/state/auth-state.ts';
import { atTenant } from './helpers/client-route.ts';

type Call = { url: string; method: string };

describe('estado de Créditos (#21)', () => {
  let calls: Call[];
  let reply: { status: number; body: unknown };

  beforeEach(() => {
    tokenSignal.value = 'mock-token';
    impersonationSignal.value = null;
    userTenantsSignal.value = [{ tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' }];
    atTenant('tienda-test');
    creditsSignal.value = null;
    chargesSignal.value = null;
    billingStatusSignal.value = null;
    chargesRangeSignal.value = { from: '2026-09-06', to: '2026-10-05' };
    calls = [];
    reply = { status: 200, body: {} };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init?.method ?? 'GET' });
      return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchCredits trae el resumen del comercio', async () => {
    reply.body = { state: 'ok', giftBalance: 50000 };
    await fetchCredits();
    expect(calls).toEqual([{ url: '/api/tenants/tienda-test/credits', method: 'GET' }]);
    expect(creditsSignal.value).toMatchObject({ state: 'ok', giftBalance: 50000 });
  });

  it('fetchCharges pide el rango y la página', async () => {
    reply.body = { items: [], count: 0, page: 2, pageSize: 50, total: 0 };
    await fetchCharges(2);
    expect(calls[0]?.url).toBe('/api/tenants/tienda-test/credits/charges?from=2026-09-06&to=2026-10-05&page=2&pageSize=50');
    expect(chargesSignal.value?.page).toBe(2);
  });

  it('el estado restringido bloquea al usuario, no a soporte impersonando', async () => {
    reply.body = { state: 'restricted', debt: 1000, deadline: '2026-10-13' };
    await fetchBillingStatus();
    expect(calls[0]?.url).toBe('/api/tenants/tienda-test/billing-status');
    expect(isRestrictedSignal.value).toBe(true);
    impersonationSignal.value = { slug: 'tienda-test', fromSlug: null };
    expect(isRestrictedSignal.value).toBe(false);
  });

  it('un 402 billing-restricted marca el comercio como restringido', () => {
    expect(markRestrictedFromError(new ApiError(500, 'x', {}))).toBe(false);
    expect(billingStatusSignal.value).toBeNull();
    expect(markRestrictedFromError(new ApiError(402, 'x', { code: 'billing-restricted', debt: 1000, deadline: '2026-10-13' }))).toBe(true);
    expect(billingStatusSignal.value).toEqual({ state: 'restricted', debt: 1000, deadline: '2026-10-13' });
  });

  it('cualquier pedido que recibe el 402 deja la restricción a la vista', async () => {
    reply = { status: 402, body: { code: 'billing-restricted', error: 'mini contax está restringido por deuda', debt: 2000, deadline: '2026-10-13' } };
    await expect(apiFetch('tenants/tienda-test/products', { token: 'mock-token' })).rejects.toThrow('mini contax está restringido por deuda');
    expect(isRestrictedSignal.value).toBe(true);
  });

  it('el link de WhatsApp deja solo los dígitos del teléfono y arma el mensaje', () => {
    expect(whatsappPayUrl({ phone: '+54 9 11 5555-1234', tenantName: 'Kiosco' })).toBe(
      `https://wa.me/5491155551234?text=${encodeURIComponent('Hola, soy de Kiosco. Ya transferí para cargar saldo en mini contax.')}`,
    );
  });
});
