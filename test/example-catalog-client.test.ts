import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exampleCatalogSignal, fetchExampleCatalog, applyExampleCatalog } from '../src/client/state/example-catalog-state.ts';
import { tokenSignal, activeTenantIdSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';

const json = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('catálogo de ejemplo en Operaciones masivas (#22)', () => {
  beforeEach(() => {
    tokenSignal.value = 'tok';
    activeTenantIdSignal.value = 't1';
    userTenantsSignal.value = [{ tenantId: 't1', name: 'T1', slug: 't1', role: 'owner', status: 'active' }];
    exampleCatalogSignal.value = null;
    vi.restoreAllMocks();
  });

  it('pregunta si está disponible y, al aplicarlo, deja de estarlo', async () => {
    const urls: string[] = [];
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce((url: string) => {
        urls.push(url);
        return json({ businessType: 'kiosco', available: true });
      })
      .mockImplementationOnce((url: string) => {
        urls.push(url);
        return json({ productsCreated: 40 });
      });
    await fetchExampleCatalog();
    expect(exampleCatalogSignal.value).toEqual({ businessType: 'kiosco', available: true });
    expect(await applyExampleCatalog()).toBe(40);
    expect(exampleCatalogSignal.value).toEqual({ businessType: 'kiosco', available: false });
    expect(urls).toEqual(['/api/tenants/t1/catalog/example', '/api/tenants/t1/catalog/example']);
  });

  it('si la consulta falla, no ofrece nada', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 403, headers: { 'content-type': 'application/json' } }));
    await fetchExampleCatalog();
    expect(exampleCatalogSignal.value).toBeNull();
  });
});
