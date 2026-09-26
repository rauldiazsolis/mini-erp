import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  tokenSignal,
  currentUserSignal,
  userTenantsSignal,
  activeTenantIdSignal,
  impersonatedTenantIdSignal,
  isAuthenticatedSignal,
  isRootOrSupportSignal,
  effectiveTenantIdSignal,
  activeTenantSignal,
  isImpersonatingSignal,
  logout,
  setActiveTenant,
  impersonateTenant,
  stopImpersonation,
  type AuthUser,
  type TenantMembershipItem,
} from '../src/client/state/auth-state.ts';
import { createSignalQuery } from '../src/client/api/query-client.ts';
import { apiFetch, setOnUnauthorized } from '../src/client/api/client.ts';

describe('Capa de Estado Reactivo, Cliente API y Auth (Etapa 3.3)', () => {
  beforeEach(() => {
    logout();
  });

  describe('auth-state Signals & Computeds', () => {
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
      setActiveTenant('t-1');

      expect(isAuthenticatedSignal.value).toBe(true);
      expect(isRootOrSupportSignal.value).toBe(true);
      expect(effectiveTenantIdSignal.value).toBe('t-1');
      expect(activeTenantSignal.value?.name).toBe('Kiosco 1');
      expect(isImpersonatingSignal.value).toBe(false);
    });

    it('permite impersonar un tenant a usuarios con rol root o support', () => {
      currentUserSignal.value = {
        id: 'usr-root',
        email: 'root@local.test',
        name: 'Super Admin',
        globalRole: 'root',
      };
      tokenSignal.value = 'token-root';
      userTenantsSignal.value = [
        { tenantId: 'tenant-a', slug: 't-a', name: 'Tenant A', status: 'active', role: 'owner' },
        { tenantId: 'tenant-b', slug: 't-b', name: 'Tenant B', status: 'active', role: 'impersonated' },
      ];
      setActiveTenant('tenant-a');

      expect(effectiveTenantIdSignal.value).toBe('tenant-a');
      expect(isImpersonatingSignal.value).toBe(false);

      // Impersonar tenant-b
      impersonateTenant('tenant-b');
      expect(effectiveTenantIdSignal.value).toBe('tenant-b');
      expect(activeTenantSignal.value?.name).toBe('Tenant B');
      expect(isImpersonatingSignal.value).toBe(true);

      // Salir de impersonación
      stopImpersonation();
      expect(effectiveTenantIdSignal.value).toBe('tenant-a');
      expect(activeTenantSignal.value?.name).toBe('Tenant A');
      expect(isImpersonatingSignal.value).toBe(false);
    });

    it('impide impersonar a usuarios estándar sin permisos globales', () => {
      currentUserSignal.value = {
        id: 'usr-regular',
        email: 'cajero@local.test',
        name: 'Cajero',
        globalRole: 'user',
      };

      expect(() => { impersonateTenant('otro-tenant'); }).toThrow(
        'Solo usuarios root o support pueden impersonar comercios',
      );
    });

    it('logout limpia todas las señales y el estado de sesión', () => {
      tokenSignal.value = 'token';
      currentUserSignal.value = { id: 'u1', email: 'a@b.com', name: 'A', globalRole: 'user' };
      setActiveTenant('t1');

      logout();

      expect(tokenSignal.value).toBeNull();
      expect(currentUserSignal.value).toBeNull();
      expect(activeTenantIdSignal.value).toBeNull();
      expect(impersonatedTenantIdSignal.value).toBeNull();
      expect(isAuthenticatedSignal.value).toBe(false);
    });
  });

  describe('createSignalQuery (TanStack Query + Signals)', () => {
    it('encapsula consultas y actualiza señales reactivas sin hooks', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ items: ['prod-1', 'prod-2'] });

      const query = createSignalQuery({
        queryKey: ['mock-items-key'],
        queryFn: mockFetch,
      });

      expect(query.isLoading.value).toBe(true);
      expect(query.data.value).toBeUndefined();

      // Esperar resolución
      await new Promise((r) => setTimeout(r, 50));

      expect(query.isLoading.value).toBe(false);
      expect(query.data.value).toEqual({ items: ['prod-1', 'prod-2'] });
      expect(query.isError.value).toBe(false);

      query.unsubscribe();
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

      await expect(apiFetch('/api/test-401')).rejects.toThrow('Token inválido o expirado');
      expect(onUnauthMock).toHaveBeenCalled();

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
