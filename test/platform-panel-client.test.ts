import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  platformTenantsSignal,
  platformTenantDetailSignal,
  activeOwners,
  suspendTenant,
  reactivateTenant,
} from '../src/client/state/platform-panel-state.ts';
import { currentUserSignal } from '../src/client/state/auth-state.ts';
import { navigate, setHistoryForTests, setPlatformFilters, locationSignal } from '../src/client/state/route-state.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { freshSession } from './helpers/client-route.ts';
import type { PlatformTenantDetail } from '../src/shared/platform-types.ts';

type Call = { url: string; method: string; body: unknown };

function detailFixture(id: string, slug: string): PlatformTenantDetail {
  return {
    tenant: { id, slug, name: 'Kiosco', status: 'active', businessType: 'kiosco', holder: null, billingState: 'ok', members: 2, createdAt: '2026-10-01T00:00:00.000Z' },
    suspension: null,
    credits: {
      billable: true, state: 'ok', holder: null, paidBalance: 0, giftBalance: 0, nextGiftExpiry: null, debt: 0, deadline: null, daysCovered: null, dailyBurn: 0,
    },
    gifts: [],
    members: [
      { userId: 'u-1', name: 'Ana', email: 'a@x.com', role: 'owner', status: 'active' },
      { userId: 'u-2', name: 'Beto', email: 'b@x.com', role: 'admin', status: 'active' },
      { userId: 'u-3', name: 'Caro', email: 'c@x.com', role: 'owner', status: 'disabled' },
    ],
  };
}

describe('panel de plataforma: comercios (#23)', () => {
  let calls: Call[];
  let reply: { status: number; body: unknown };

  beforeEach(async () => {
    setHistoryForTests(null);
    calls = [];
    reply = { status: 200, body: [] };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined });
      return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } }));
    });
    freshSession('mock-token');
    currentUserSignal.value = { id: 'root', email: 'root@x.com', name: 'Root', globalRole: 'root' };
    navigate('/admin');
    await vi.waitFor(() => { expect(queryClient.isFetching()).toBe(0); });
    calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const gets = () => calls.filter((c) => c.method === 'GET').map((c) => c.url);
  const writes = () => calls.filter((c) => c.method !== 'GET');

  it('Comercios pide la lista con el filtro de la URL', async () => {
    reply.body = [{ id: 'k', slug: 'kiosco' }];
    navigate('/plataforma?q=kio');
    await vi.waitFor(() => { expect(gets()).toContain('/api/platform/tenants?q=kio'); });
    await vi.waitFor(() => { expect(platformTenantsSignal.value).toEqual([{ id: 'k', slug: 'kiosco' }]); });
  });

  it('el buscador cambia el filtro sin agregar historial', () => {
    navigate('/plataforma');
    setPlatformFilters({ q: 'ferre' });
    expect(locationSignal.value).toEqual({ pathname: '/plataforma', search: '?q=ferre' });
    setPlatformFilters({ q: '' });
    expect(locationSignal.value).toEqual({ pathname: '/plataforma', search: '' });
  });

  it('el detalle se pide por slug; los owners activos salen de sus miembros', async () => {
    reply.body = detailFixture('kiosco-id', 'kiosco');
    navigate('/plataforma/comercios/kiosco');
    await vi.waitFor(() => { expect(platformTenantDetailSignal.value?.tenant.id).toBe('kiosco-id'); });
    expect(gets()).toContain('/api/platform/tenants/by-slug/kiosco');
    expect(gets()).not.toContain('/api/platform/tenants');
    expect(activeOwners(platformTenantDetailSignal.value).map((m) => m.userId)).toEqual(['u-1']);
  });

  it('suspender lleva el motivo y reactivar no; los dos dejan vieja la plataforma', async () => {
    queryClient.setQueryData(['platform', 'tenants', ''], []);
    reply.body = { success: true };
    expect(await suspendTenant('kiosco-id', 'Pedido')).toBe(true);
    expect(await reactivateTenant('kiosco-id')).toBe(true);
    expect(writes()).toEqual([
      { url: '/api/platform/tenants/kiosco-id/suspend', method: 'POST', body: { reason: 'Pedido' } },
      { url: '/api/platform/tenants/kiosco-id/reactivate', method: 'POST', body: {} },
    ]);
    expect(queryClient.getQueryState(['platform', 'tenants', ''])?.isInvalidated).toBe(true);
  });

  it('un error al suspender devuelve false', async () => {
    reply = { status: 409, body: { error: 'El comercio ya está suspendido' } };
    expect(await suspendTenant('kiosco-id', 'x')).toBe(false);
  });
});
