import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  tokenSignal,
  currentUserSignal,
  userTenantsSignal,
  lastTenantIdSignal,
  impersonationSignal,
  isAuthenticatedSignal,
  isRootOrSupportSignal,
  effectiveTenantIdSignal,
  activeTenantSignal,
  isImpersonatingSignal,
  logout,
  selectTenant,
  type AuthUser,
  type TenantMembershipItem,
} from '../src/client/state/auth-state.ts';
import { createSignalQuery } from '../src/client/api/query-client.ts';
import { locationSignal, setHistoryForTests } from '../src/client/state/route-state.ts';
import { atTenant } from './helpers/client-route.ts';
import { apiFetch, setOnUnauthorized } from '../src/client/api/client.ts';

describe('Capa de Estado Reactivo, Cliente API y Auth (Etapa 3.3)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    logout();
  });

  describe('auth-state Signals & Computeds', () => {
    it('selectTenant cambia el comercio y devuelve el nombre del elegido, no el anterior (#45)', () => {
      userTenantsSignal.value = [
        { tenantId: 'ferreteria', slug: 'ferreteria', name: 'Ferretería El Candado', status: 'active', role: 'owner' },
        { tenantId: 'kiosco', slug: 'kiosco', name: 'Kiosco San Martín', status: 'active', role: 'owner' },
      ];
      atTenant('ferreteria', 'clientes');
      expect(selectTenant('kiosco')).toBe('Kiosco San Martín');
      expect(activeTenantSignal.value?.tenantId).toBe('kiosco');
      expect(locationSignal.value.pathname).toBe('/admin/kiosco/clientes');
      expect(selectTenant('no-esta')).toBe('no-esta');
    });

    it('inicia en estado no autenticado', () => {
      expect(tokenSignal.value).toBeNull();
      expect(currentUserSignal.value).toBeNull();
      expect(isAuthenticatedSignal.value).toBe(false);
      expect(userTenantsSignal.value).toEqual([]);
      expect(effectiveTenantIdSignal.value).toBeNull();
      expect(activeTenantSignal.value).toBeNull();
    });

    it('reacciona correctamente cuando se autentica un usuario', () => {
      const mockUser: AuthUser = {
        id: 'usr-1',
        email: 'admin@local.test',
        name: 'Administrador',
        globalRole: 'root',
      };
      const mockTenants: TenantMembershipItem[] = [
        { tenantId: 't-1', slug: 'kiosco-1', name: 'Kiosco 1', status: 'active', role: 'owner' },
        { tenantId: 't-2', slug: 'ferre-2', name: 'Ferretería 2', status: 'active', role: 'owner' },
      ];

      tokenSignal.value = 'fake-jwt-token';
      currentUserSignal.value = mockUser;
      userTenantsSignal.value = mockTenants;
      atTenant('t-1');

      expect(isAuthenticatedSignal.value).toBe(true);
      expect(isRootOrSupportSignal.value).toBe(true);
      expect(effectiveTenantIdSignal.value).toBe('t-1');
      expect(activeTenantSignal.value?.name).toBe('Kiosco 1');
      expect(isImpersonatingSignal.value).toBe(false);
    });

    it('logout limpia todas las señales y el estado de sesión', () => {
      tokenSignal.value = 'token';
      currentUserSignal.value = { id: 'u1', email: 'a@b.com', name: 'A', globalRole: 'user' };
      atTenant('t1');

      logout();

      expect(tokenSignal.value).toBeNull();
      expect(currentUserSignal.value).toBeNull();
      expect(lastTenantIdSignal.value).toBeNull();
      expect(impersonationSignal.value).toBeNull();
      expect(isAuthenticatedSignal.value).toBe(false);
    });
  });

  describe('createSignalQuery (TanStack Query + Signals)', () => {
    it('encapsula consultas y actualiza señales reactivas sin hooks', async () => {
      const mockFetch = vi.fn(() => Promise.resolve({ items: ['prod-1', 'prod-2'] }));

      const query = createSignalQuery({
        source: () => ({ key: ['mock-items-key'], fn: mockFetch }),
      });

      expect(query.isLoading.value).toBe(true);
      expect(query.data.value).toBeUndefined();

      // Esperar resolución
      await new Promise((r) => setTimeout(r, 50));

      expect(query.isLoading.value).toBe(false);
      expect(query.data.value).toEqual({ items: ['prod-1', 'prod-2'] });
      expect(query.error.value).toBeNull();

      query.dispose();
    });
  });

  describe('apiFetch & Error Handling', () => {
    it('dispara callback de 401 no autorizado', async () => {
      const originalFetch = globalThis.fetch;
      const onUnauthMock = vi.fn();
      setOnUnauthorized(onUnauthMock);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: 'Token inválido o expirado' }),
      });

      await expect(apiFetch('/api/test-401', { token: 'vencido' })).rejects.toThrow('Token inválido o expirado');
      expect(onUnauthMock).toHaveBeenCalled();

      globalThis.fetch = originalFetch;
    });

    it('un 401 de un pedido sin sesión (login, links) no cierra la sesión (#19)', async () => {
      const originalFetch = globalThis.fetch;
      const onUnauthMock = vi.fn();
      setOnUnauthorized(onUnauthMock);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: 'Contraseña incorrecta' }),
      });

      await expect(apiFetch('/api/invitations/accept', { method: 'POST', body: {} })).rejects.toThrow('Contraseña incorrecta');
      expect(onUnauthMock).not.toHaveBeenCalled();

      globalThis.fetch = originalFetch;
    });

    it('agrega token Bearer a los headers si se provee', async () => {
      const originalFetch = globalThis.fetch;
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ ok: true }),
        } as unknown as Response);
      });

      await apiFetch('http://example.com/api', { token: 'sample-jwt' });
      expect(capturedHeaders['Authorization']).toBe('Bearer sample-jwt');

      globalThis.fetch = originalFetch;
    });
  });
});
