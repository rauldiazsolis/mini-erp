import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  stepSignal,
  nameSignal,
  slugSignal,
  tenantIdSignal,
  selectedPresetSignal,
  branchNameSignal,
  branchCodeSignal,
  posNameSignal,
  isSubmittingSignal,
  errorMessageSignal,
  provisionResultSignal,
  generateSlug,
  setName,
  resetOnboarding,
  nextStep,
  prevStep,
  submitOnboarding,
  finishAndEnterTenant,
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

describe('Wizard de Onboarding para Nuevos Comercios (Etapa 3.6)', () => {
  beforeEach(() => {
    resetOnboarding();
    tokenSignal.value = 'mock-jwt-token';
    activeTenantIdSignal.value = null;
    userTenantsSignal.value = [];
    onboardingModalOpenSignal.value = false;
    vi.restoreAllMocks();
  });

  describe('Generador de Slug y Normalización', () => {
    it('normaliza tildes, caracteres especiales y espacios en kebab-case limpio', () => {
      expect(generateSlug('Kiosco San Martín & CIA!')).toBe('kiosco-san-martin-cia');
      expect(generateSlug('Ferretería El Trébol - Casa Central')).toBe('ferreteria-el-trebol-casa-central');
      expect(generateSlug('  Almacén 24/7  ')).toBe('almacen-24-7');
      expect(generateSlug('¡SÚPER OFERTAS!')).toBe('super-ofertas');
    });

    it('setName actualiza reactivamente el nombre, slug y tenantId', () => {
      setName('Farmacia Belgrano');
      expect(nameSignal.value).toBe('Farmacia Belgrano');
      expect(slugSignal.value).toBe('farmacia-belgrano');
      expect(tenantIdSignal.value).toBe('farmacia-belgrano');
      expect(errorMessageSignal.value).toBeNull();
    });
  });

  describe('Navegación y Validaciones Paso a Paso', () => {
    it('inicia en el Paso 1 con valores por defecto limpios', () => {
      expect(stepSignal.value).toBe(1);
      expect(nameSignal.value).toBe('');
      expect(selectedPresetSignal.value).toBe('kiosco');
      expect(branchNameSignal.value).toBe('Casa Central');
      expect(branchCodeSignal.value).toBe('CENTRAL');
      expect(posNameSignal.value).toBe('Caja 1');
      expect(isSubmittingSignal.value).toBe(false);
    });

    it('bloquea avanzar al paso 2 si el nombre tiene menos de 2 caracteres', () => {
      setName('A');
      nextStep();
      expect(stepSignal.value).toBe(1);
      expect(errorMessageSignal.value).toBe('El nombre del comercio debe tener al menos 2 caracteres');
    });

    it('bloquea avanzar al paso 2 si el slug o tenantId contiene caracteres inválidos', () => {
      setName('Válido');
      slugSignal.value = 'slug con espacios';
      nextStep();
      expect(stepSignal.value).toBe(1);
      expect(errorMessageSignal.value).toBe('El slug solo puede contener minúsculas, números y guiones');
    });

    it('avanza al paso 2 si los datos del paso 1 son válidos', () => {
      setName('Minimarket Sol');
      nextStep();
      expect(stepSignal.value).toBe(2);
      expect(errorMessageSignal.value).toBeNull();
    });

    it('permite cambiar entre presets comerciales en el paso 2 y avanzar al paso 3', () => {
      setName('Minimarket Sol');
      nextStep(); // to step 2

      selectedPresetSignal.value = 'ferreteria';
      expect(selectedPresetSignal.value).toBe('ferreteria');

      nextStep(); // to step 3
      expect(stepSignal.value).toBe(3);
    });

    it('permite regresar con prevStep sin bajar del paso 1', () => {
      setName('Minimarket Sol');
      nextStep(); // to 2
      nextStep(); // to 3
      expect(stepSignal.value).toBe(3);

      prevStep();
      expect(stepSignal.value).toBe(2);

      prevStep();
      expect(stepSignal.value).toBe(1);

      prevStep();
      expect(stepSignal.value).toBe(1);
    });

    it('bloquea el aprovisionamiento en el paso 3 si los datos de sucursal están incompletos', () => {
      setName('Minimarket Sol');
      nextStep(); // 2
      nextStep(); // 3

      branchNameSignal.value = '';
      nextStep();
      expect(errorMessageSignal.value).toBe('Completa los datos de la sucursal inicial y terminal');
    });
  });

  describe('Aprovisionamiento de Tenant y API Key', () => {
    it('muestra error si no hay token de autenticación', async () => {
      tokenSignal.value = null;
      setName('Comercio Test');
      await submitOnboarding();
      expect(errorMessageSignal.value).toBe('Debes estar autenticado para crear un comercio');
    });

    it('ejecuta exitosamente el flujo de aprovisionamiento en 4 pasos y genera credenciales', async () => {
      setName('Kiosco Avenida');
      selectedPresetSignal.value = 'kiosco';
      branchNameSignal.value = 'Casa Central';
      branchCodeSignal.value = 'CENTRAL';
      posNameSignal.value = 'Caja 1';

      // Mock de fetch global
      const originalFetch = globalThis.fetch;
      const fetchCalls: Array<{ url: string; method?: string; body?: unknown }> = [];

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({
          url: String(url),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });

        if (String(url).endsWith('/api/tenants')) {
          return new Response(
            JSON.stringify({
              id: 'kiosco-avenida',
              name: 'Kiosco Avenida',
              slug: 'kiosco-avenida',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          );
        }

        if (String(url).includes('/seed-preset')) {
          return new Response(
            JSON.stringify({
              preset: 'kiosco',
              productsImported: 15,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        if (String(url).includes('/api-keys')) {
          return new Response(
            JSON.stringify({
              id: 'key-123',
              name: 'Caja 1',
              key: 'pos_live_mock_secret_key_789',
              branch: 'CENTRAL',
              pointOfSale: 'Caja 1',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          );
        }

        if (String(url).endsWith('/api/auth/me')) {
          return new Response(
            JSON.stringify({
              user: { id: 'usr-1', email: 'admin@pos.local', globalRole: 'admin', name: 'Admin' },
              tenants: [
                {
                  tenantId: 'kiosco-avenida',
                  name: 'Kiosco Avenida',
                  slug: 'kiosco-avenida',
                  role: 'owner',
                  status: 'active',
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      try {
        await submitOnboarding();

        expect(stepSignal.value).toBe(4);
        expect(errorMessageSignal.value).toBeNull();
        expect(provisionResultSignal.value).not.toBeNull();
        expect(provisionResultSignal.value?.tenantId).toBe('kiosco-avenida');
        expect(provisionResultSignal.value?.apiKey).toBe('pos_live_mock_secret_key_789');
        expect(provisionResultSignal.value?.branch).toBe('CENTRAL');
        expect(provisionResultSignal.value?.pointOfSale).toBe('Caja 1');
        expect(provisionResultSignal.value?.connectorUrl).toContain('/connector');

        // Verificar que las llamadas se hayan realizado en orden
        expect(fetchCalls.some((c) => c.url.endsWith('/api/tenants') && c.method === 'POST')).toBe(true);
        expect(fetchCalls.some((c) => c.url.includes('/seed-preset') && c.method === 'POST')).toBe(true);
        expect(fetchCalls.some((c) => c.url.includes('/api-keys') && c.method === 'POST')).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('finishAndEnterTenant activa el tenant aprovisionado y cierra el wizard', () => {
      openOnboardingModal();
      expect(onboardingModalOpenSignal.value).toBe(true);

      userTenantsSignal.value = [
        {
          tenantId: 'nuevo-comercio',
          name: 'Nuevo Comercio',
          slug: 'nuevo-comercio',
          role: 'owner',
          status: 'active',
        },
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
