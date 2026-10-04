import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  stepSignal,
  nameSignal,
  selectedPresetSignal,
  isSubmittingSignal,
  errorMessageSignal,
  provisionResultSignal,
  setName,
  resetOnboarding,
  nextStep,
  prevStep,
  submitOnboarding,
  finishAndEnterTenant,
  DONE_STEP,
} from '../src/client/state/onboarding-state.ts';
import {
  tokenSignal,
  activeTenantIdSignal,
  activeTenantSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';
import {
  onboardingModalOpenSignal,
  openOnboardingModal,
} from '../src/client/state/navigation-state.ts';

describe('Wizard "Crear nuevo comercio" (con sesión, #19)', () => {
  beforeEach(() => {
    resetOnboarding();
    tokenSignal.value = 'mock-jwt-token';
    activeTenantIdSignal.value = null;
    userTenantsSignal.value = [];
    onboardingModalOpenSignal.value = false;
    vi.restoreAllMocks();
  });

  describe('Navegación y Validaciones Paso a Paso', () => {
    it('inicia en el Paso 1 con valores por defecto limpios', () => {
      expect(stepSignal.value).toBe(1);
      expect(nameSignal.value).toBe('');
      expect(selectedPresetSignal.value).toBe('kiosco');
      expect(isSubmittingSignal.value).toBe(false);
      expect(DONE_STEP).toBe(3);
    });

    it('bloquea avanzar al paso 2 si el nombre tiene menos de 2 caracteres', () => {
      setName('A');
      nextStep();
      expect(stepSignal.value).toBe(1);
      expect(errorMessageSignal.value).toBe('El nombre del comercio debe tener al menos 2 caracteres');
    });

    it('avanza al paso 2 si el nombre es válido', () => {
      setName('Minimarket Sol');
      nextStep();
      expect(stepSignal.value).toBe(2);
      expect(errorMessageSignal.value).toBeNull();
    });

    it('permite regresar con prevStep sin bajar del paso 1', () => {
      setName('Minimarket Sol');
      nextStep();
      prevStep();
      expect(stepSignal.value).toBe(1);
      prevStep();
      expect(stepSignal.value).toBe(1);
    });
  });

  describe('Aprovisionamiento por POST /api/alta', () => {
    it('muestra error si no hay token de autenticación', async () => {
      tokenSignal.value = null;
      setName('Comercio Test');
      await submitOnboarding();
      expect(errorMessageSignal.value).toBe('Debes estar autenticado para crear un comercio');
    });

    it('crea el comercio con nombre y rubro y muestra la key de Caja 1', async () => {
      setName('Kiosco Avenida');
      selectedPresetSignal.value = 'ferreteria';

      const fetchCalls: Array<{ url: string; method?: string | undefined; body?: unknown; auth?: string | undefined }> = [];
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        fetchCalls.push({
          url,
          method: init?.method,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
          auth: headers['Authorization'],
        });

        if (url.endsWith('/api/alta')) {
          return Promise.resolve(new Response(
            JSON.stringify({
              user: { id: 'usr-1', email: 'admin@pos.local', name: 'Admin', globalRole: 'user' },
              tenant: { id: 'kiosco-avenida', name: 'Kiosco Avenida' },
              posKey: { key: 'pos_live_mock_secret_key_789', branch: 'CENTRAL', pointOfSale: 'Caja 1' },
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ));
        }

        return Promise.resolve(new Response(
          JSON.stringify({
            user: { id: 'usr-1', email: 'admin@pos.local', globalRole: 'user', name: 'Admin' },
            tenants: [{ tenantId: 'kiosco-avenida', name: 'Kiosco Avenida', slug: 'kiosco-avenida', role: 'owner', status: 'active' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      });

      await submitOnboarding();

      expect(stepSignal.value).toBe(DONE_STEP);
      expect(errorMessageSignal.value).toBeNull();
      expect(provisionResultSignal.value).toEqual({
        tenantId: 'kiosco-avenida',
        name: 'Kiosco Avenida',
        apiKey: 'pos_live_mock_secret_key_789',
        branch: 'CENTRAL',
        pointOfSale: 'Caja 1',
        connectorUrl: 'http://localhost:4100/connector',
      });
      const alta = fetchCalls.filter((c) => c.url.endsWith('/api/alta'));
      expect(alta).toHaveLength(1);
      expect(alta[0]?.method).toBe('POST');
      expect(alta[0]?.body).toEqual({ businessName: 'Kiosco Avenida', businessType: 'ferreteria' });
      expect(alta[0]?.auth).toBe('Bearer mock-jwt-token');
    });

    it('nextStep en el paso 2 dispara el aprovisionamiento', () => {
      const fetchMock = vi.fn().mockReturnValue(new Promise(() => undefined));
      globalThis.fetch = fetchMock;
      setName('Kiosco Avenida');
      nextStep();
      nextStep();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('finishAndEnterTenant activa el tenant aprovisionado y cierra el wizard', () => {
      openOnboardingModal();
      expect(onboardingModalOpenSignal.value).toBe(true);

      userTenantsSignal.value = [
        { tenantId: 'nuevo-comercio', name: 'Nuevo Comercio', slug: 'nuevo-comercio', role: 'owner', status: 'active' },
      ];

      provisionResultSignal.value = {
        tenantId: 'nuevo-comercio',
        name: 'Nuevo Comercio',
        apiKey: 'test-key',
        branch: 'CENTRAL',
        pointOfSale: 'Caja 1',
        connectorUrl: 'http://localhost:4100/connector',
      };

      finishAndEnterTenant();

      expect(activeTenantSignal.value?.tenantId).toBe('nuevo-comercio');
      expect(onboardingModalOpenSignal.value).toBe(false);
      expect(stepSignal.value).toBe(1);
    });
  });
});
