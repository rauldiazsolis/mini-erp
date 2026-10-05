import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  adoptImpersonation,
  currentUserSignal,
  impersonationEndedSignal,
  impersonationSignal,
  isImpersonatingSignal,
  lastTenantIdSignal,
  loadSessionFromStorage,
  logout,
  profileLoadedSignal,
  registerTenantRouteEffects,
  rememberTenant,
  resumeOwnSession,
  setStoragesForTests,
  tokenSignal,
  userTenantsSignal,
  type StorageLike,
} from '../src/client/state/auth-state.ts';
import { enterFromRoute, enterStatusSignal } from '../src/client/state/impersonation-state.ts';
import { apiFetch } from '../src/client/api/client.ts';
import { locationSignal, navigate, setHistoryForTests } from '../src/client/state/route-state.ts';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  writes: string[] = [];
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.writes.push(`set ${k}`);
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.writes.push(`remove ${k}`);
    this.data.delete(k);
  }
}

const juan = { id: 'u-juan', email: 'juan@x.com', name: 'Juan', globalRole: 'user' as const };
const ana = { id: 'u-ana', name: 'Ana', globalRole: 'support' as const };
const start = { token: 'tok-imp', user: juan, impersonator: ana, tenantSlug: 'kiosco', path: '/admin/kiosco/clientes' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const path = (): string => `${locationSignal.value.pathname}${locationSignal.value.search}`;

describe('sesión por pestaña (#23, M7b)', () => {
  let local: MemoryStorage;
  let session: MemoryStorage;

  beforeEach(() => {
    vi.restoreAllMocks();
    setHistoryForTests(null);
    local = new MemoryStorage();
    session = new MemoryStorage();
    local.data.set('mini_erp_token', 'tok-soporte');
    local.data.set('mini_erp_tenant_id', 't-viejo');
    setStoragesForTests({ local, session });
    loadSessionFromStorage();
    currentUserSignal.value = null;
    impersonationEndedSignal.value = null;
    enterStatusSignal.value = { kind: 'idle' };
    navigate('/');
  });

  it('sin impersonación, el token es el de localStorage', () => {
    expect(tokenSignal.value).toBe('tok-soporte');
    expect(isImpersonatingSignal.value).toBe(false);
    expect(lastTenantIdSignal.value).toBe('t-viejo');
  });

  it('lee primero el sessionStorage de la pestaña', () => {
    session.data.set('mini_erp_impersonation', JSON.stringify(start));
    loadSessionFromStorage();
    expect(tokenSignal.value).toBe('tok-imp');
    expect(impersonationSignal.value).toEqual({ user: juan, impersonator: ana, tenantSlug: 'kiosco' });
    expect(lastTenantIdSignal.value).toBeNull();
  });

  it('un sessionStorage roto se ignora', () => {
    session.data.set('mini_erp_impersonation', '{"token":1}');
    loadSessionFromStorage();
    expect(tokenSignal.value).toBe('tok-soporte');
    expect(isImpersonatingSignal.value).toBe(false);
  });

  it('adoptar la impersonación escribe solo el sessionStorage y lleva a la pantalla', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ user: juan, impersonator: ana, tenants: [{ tenantId: 'k', slug: 'kiosco', name: 'Kiosco X', status: 'active', role: 'owner' }] }),
    );
    await adoptImpersonation(start);
    expect(tokenSignal.value).toBe('tok-imp');
    expect(path()).toBe('/admin/kiosco/clientes');
    rememberTenant('k');
    expect(local.writes).toEqual([]);
    expect(JSON.parse(session.data.get('mini_erp_impersonation') ?? '{}')).toEqual(start);
  });

  it('un 401 impersonando borra solo el sessionStorage y avisa que terminó', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ user: juan, impersonator: ana, tenants: [] }));
    await adoptImpersonation(start);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'Sesión expirada' }, 401));
    await expect(apiFetch('auth/me', { token: 'tok-imp' })).rejects.toThrow();
    expect(impersonationEndedSignal.value).toEqual({ userName: 'Juan' });
    expect(session.data.has('mini_erp_impersonation')).toBe(false);
    expect(local.data.get('mini_erp_token')).toBe('tok-soporte');
    expect(local.writes).toEqual([]);
    expect(tokenSignal.value).toBeNull();
  });

  it('volver a la sesión propia usa el token de localStorage y va a /plataforma', async () => {
    impersonationEndedSignal.value = { userName: 'Juan' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ user: { ...ana, email: 'ana@x.com' }, impersonator: null, tenants: [] }));
    await resumeOwnSession();
    expect(tokenSignal.value).toBe('tok-soporte');
    expect(impersonationEndedSignal.value).toBeNull();
    expect(path()).toBe('/plataforma');
  });

  it('sin impersonar, logout sí borra el localStorage', () => {
    logout();
    expect(local.data.has('mini_erp_token')).toBe(false);
  });

  it('root o soporte sin comercios: /admin lleva a /plataforma', () => {
    const dispose = registerTenantRouteEffects();
    currentUserSignal.value = { id: 'r', email: 'root@x.com', name: 'Root', globalRole: 'root' };
    userTenantsSignal.value = [];
    profileLoadedSignal.value = true;
    navigate('/admin');
    expect(path()).toBe('/plataforma');
    dispose();
  });

  it('entrar pide la impersonación con el token propio y la adopta', async () => {
    currentUserSignal.value = { id: 'u-ana', email: 'ana@x.com', name: 'Ana', globalRole: 'support' };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(start, 201))
      .mockResolvedValueOnce(json({ user: juan, impersonator: ana, tenants: [] }));
    await enterFromRoute({ kind: 'ayuda', requestId: 'help_1' });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/impersonations');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-soporte');
    expect(init?.body).toBe(JSON.stringify({ helpRequestId: 'help_1' }));
    expect(tokenSignal.value).toBe('tok-imp');
  });

  it('un pedido vencido avisa "venció"; un usuario sin rol de plataforma no entra', async () => {
    currentUserSignal.value = { id: 'u-ana', email: 'ana@x.com', name: 'Ana', globalRole: 'support' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'Este pedido venció' }, 410));
    await enterFromRoute({ kind: 'ayuda', requestId: 'help_1' });
    expect(enterStatusSignal.value).toEqual({ kind: 'expired' });
    currentUserSignal.value = juan;
    await enterFromRoute({ kind: 'entrar', userId: 'u-x', tenantSlug: null });
    expect(enterStatusSignal.value).toEqual({ kind: 'not-staff' });
  });
});
