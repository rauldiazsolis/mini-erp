import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exampleCatalogSignal, fetchExampleCatalog, applyExampleCatalog } from '../src/client/state/example-catalog-state.ts';
import { userTenantsSignal } from '../src/client/state/auth-state.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { setHistoryForTests } from '../src/client/state/route-state.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('catálogo de ejemplo en Operaciones masivas (#22)', () => {
  let calls: { url: string; method: string }[];
  let example: () => Promise<Response>;

  const endpoints = (): string[] => calls.filter((c) => c.method === 'GET').map((c) => c.url);

  beforeEach(() => {
    vi.restoreAllMocks();
    setHistoryForTests(null);
    calls = [];
    example = () => json({ businessType: 'kiosco', available: true });
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.endsWith('/catalog/example')) return method === 'POST' ? json({ productsCreated: 40 }) : example();
      if (url.endsWith('/billing-status')) return json({ state: 'ok', debt: 0, deadline: null });
      return json([]);
    });
    freshSession('tok');
    userTenantsSignal.value = [{ tenantId: 't1', name: 'T1', slug: 't1', role: 'owner', status: 'active' }];
    atTenant('t1');
  });

  it('se consulta en Masivas → Importar / Exportar (#59)', async () => {
    expect(endpoints()).not.toContain('/api/tenants/t1/catalog/example');
    atTenant('t1', 'masivas/archivos');
    await vi.waitFor(() => { expect(endpoints()).toContain('/api/tenants/t1/catalog/example'); });
    await vi.waitFor(() => { expect(exampleCatalogSignal.value).toEqual({ businessType: 'kiosco', available: true }); });
  });

  it('pregunta si está disponible y, al aplicarlo, deja de estarlo y deja viejo el catálogo', async () => {
    queryClient.setQueryData(tenantKey('t1', 'products'), []);
    await fetchExampleCatalog();
    expect(exampleCatalogSignal.value).toEqual({ businessType: 'kiosco', available: true });
    expect(await applyExampleCatalog()).toBe(40);
    expect(exampleCatalogSignal.value).toEqual({ businessType: 'kiosco', available: false });
    expect(calls.filter((c) => c.url === '/api/tenants/t1/catalog/example').map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(queryClient.getQueryState(tenantKey('t1', 'products'))?.isInvalidated).toBe(true);
  });

  it('si la consulta falla, no ofrece nada', async () => {
    example = () => json({ error: 'x' }, 403);
    await fetchExampleCatalog();
    expect(exampleCatalogSignal.value).toBeNull();
  });
});
