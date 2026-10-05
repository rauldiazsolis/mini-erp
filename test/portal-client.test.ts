import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  adoptSession,
  anonymousSignal,
  currentUserSignal,
  demoEndedSignal,
  fetchProfile,
  isAnonymousSignal,
  loadSessionFromStorage,
  logout,
  profileLoadedSignal,
  setStoragesForTests,
  tokenSignal,
  userTenantsSignal,
  type StorageLike,
} from '../src/client/state/auth-state.ts';
import { portalStatusSignal, redeemFromHash } from '../src/client/state/portal-state.ts';
import { canDo, isSettingsTabAllowed } from '../src/client/state/permissions-state.ts';
import { apiFetch } from '../src/client/api/client.ts';
import { locationSignal, navigate, setHistoryForTests } from '../src/client/state/route-state.ts';
import { buildUrl, parseLocation } from '../src/client/routing/admin-routes.ts';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

const start = {
  access: 'demo',
  token: 'tok-anon',
  tenant: { id: 'demo-kiosco', slug: 'demo-kiosco', name: 'Kiosco Demo' },
  branch: 'CENTRAL',
  pointOfSale: 'Demo 7F3A',
  template: 'kiosco',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const path = (): string => `${locationSignal.value.pathname}${locationSignal.value.search}`;

describe('acceso anónimo de la demo en el cliente (#24)', () => {
  let local: MemoryStorage;
  let session: MemoryStorage;

  beforeEach(() => {
    vi.restoreAllMocks();
    setHistoryForTests(null);
    local = new MemoryStorage();
    session = new MemoryStorage();
    setStoragesForTests({ local, session });
    logout();
    loadSessionFromStorage();
    demoEndedSignal.value = null;
    portalStatusSignal.value = { kind: 'idle' };
    navigate('/');
  });

  it('un auth/me de otra sesión que llega después del canje no pisa la demo', async () => {
    local.data.set('mini_erp_token', 'tok-root');
    loadSessionFromStorage();
    let release: (r: Response) => void = () => undefined;
    const slow = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(slow).mockResolvedValueOnce(json(start));
    const profile = fetchProfile();
    await redeemFromHash('#t=abc');
    release(json({ user: { id: 'r', email: 'root@x.com', name: 'Root', globalRole: 'root' }, tenants: [] }));
    expect(await profile).toBe(false);
    expect(currentUserSignal.value?.name).toBe('Visitante');
    expect(userTenantsSignal.value.map((t) => t.slug)).toEqual(['demo-kiosco']);
  });

  it('/portal es una ruta propia', () => {
    expect(parseLocation('/portal', '')).toEqual({ kind: 'portal' });
    expect(buildUrl({ kind: 'portal' })).toBe('/portal');
  });

  it('canjea el link, guarda la sesión en la pestaña y abre Ventas en su caja', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(start));
    await redeemFromHash('#t=abc');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/portal/redeem');
    expect(init?.body).toBe(JSON.stringify({ token: 'abc' }));
    expect(session.data.has('mini_erp_demo')).toBe(true);
    expect(local.data.size).toBe(0);
    expect(isAnonymousSignal.value).toBe(true);
    expect(tokenSignal.value).toBe('tok-anon');
    expect(currentUserSignal.value?.name).toBe('Visitante');
    expect(userTenantsSignal.value).toEqual([{ tenantId: 'demo-kiosco', slug: 'demo-kiosco', name: 'Kiosco Demo', status: 'active', role: 'admin' }]);
    expect(profileLoadedSignal.value).toBe(true);
    expect(path()).toBe('/admin/demo-kiosco/ventas?sucursal=CENTRAL&caja=Demo+7F3A');
  });

  it('con un link vencido queda en "venció" y sin sesión', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ error: 'Este link venció' }, 410));
    await redeemFromHash('#t=abc');
    expect(portalStatusSignal.value).toEqual({ kind: 'expired' });
    expect(anonymousSignal.value).toBeNull();
    expect(session.data.size).toBe(0);
  });

  it('sin token en el fragmento, "venció" sin pedir nada', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await redeemFromHash('');
    expect(portalStatusSignal.value).toEqual({ kind: 'expired' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('al recargar, recupera la sesión de la pestaña sin pedir auth/me', async () => {
    session.data.set('mini_erp_demo', JSON.stringify(start));
    loadSessionFromStorage();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await fetchProfile()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tokenSignal.value).toBe('tok-anon');
    expect(anonymousSignal.value?.tenant.slug).toBe('demo-kiosco');
  });

  it('el menú esconde lo que el acceso anónimo no puede', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(start));
    await redeemFromHash('#t=abc');
    expect(canDo('tenant.use')).toBe(true);
    expect(canDo('bulk')).toBe(true);
    expect(canDo('settings.manage')).toBe(false);
    expect(canDo('credits.view')).toBe(false);
    expect(canDo('users.manage')).toBe(false);
    expect(isSettingsTabAllowed('appearance')).toBe(true);
    expect(isSettingsTabAllowed('account')).toBe(false);
  });

  it('el alta desde la demo suelta la sesión anónima y guarda la cuenta nueva', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(start));
    await redeemFromHash('#t=abc');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ user: { id: 'u1', email: 'a@b.com', name: 'Ana', globalRole: 'user' }, tenants: [] }));
    await adoptSession('tok-cuenta');
    expect(anonymousSignal.value).toBeNull();
    expect(session.data.has('mini_erp_demo')).toBe(false);
    expect(local.data.get('mini_erp_token')).toBe('tok-cuenta');
  });

  it('un 401 dice que la demo terminó y solo borra la sesión de la pestaña', async () => {
    local.data.set('mini_erp_token', 'tok-de-otro');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(start));
    await redeemFromHash('#t=abc');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'Sesión expirada' }, 401));
    await expect(apiFetch('tenants/demo-kiosco/products', { token: tokenSignal.value })).rejects.toThrow();
    expect(demoEndedSignal.value).toEqual({ template: 'kiosco' });
    expect(session.data.has('mini_erp_demo')).toBe(false);
    expect(local.data.get('mini_erp_token')).toBe('tok-de-otro');
    expect(anonymousSignal.value).toBeNull();
  });
});
