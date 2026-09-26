import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  merchantOnboardingActiveSignal,
  merchantStepSignal,
  userNameSignal,
  userEmailSignal,
  userPasswordSignal,
  businessNameSignal,
  selectedMerchantPresetSignal,
  returnUrlSignal,
  errorMessageSignal,
  merchantResultSignal,
  sanitizeToSlug,
  resetMerchantOnboarding,
  openMerchantOnboarding,
  closeMerchantOnboarding,
  advanceMerchantStep,
  goBackMerchantStep,
  executeMerchantProvisioning,
  enterDashboardFromOnboarding,
} from '../src/client/state/merchant-onboarding-state.ts';
import {
  tokenSignal,
  currentUserSignal,
  activeTenantIdSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';
import { activeViewSignal } from '../src/client/state/navigation-state.ts';

describe('Merchant Onboarding Express (Orientado a Comerciantes)', () => {
  beforeEach(() => {
    resetMerchantOnboarding();
    merchantOnboardingActiveSignal.value = false;
    tokenSignal.value = null;
    currentUserSignal.value = null;
    activeTenantIdSignal.value = null;
    userTenantsSignal.value = [];
    returnUrlSignal.value = null;
    activeViewSignal.value = 'dashboard';
    vi.restoreAllMocks();
  });

  describe('Sanitización de Nombres de Negocio (Slug & DB ID)', () => {
    it('convierte nombres comerciales a slugs seguros para SQLite sin requerir input técnico', () => {
      expect(sanitizeToSlug('Kiosco "San Martín" & Cía')).toBe('kiosco-san-martin-cia');
      expect(sanitizeToSlug('Ferretería & Corralón 24 Horas')).toBe('ferreteria-corralon-24-horas');
    });

    it('agrega sufijo seguro si el nombre es demasiado corto (<3 caracteres)', () => {
      const slug = sanitizeToSlug('K');
      expect(slug.length).toBeGreaterThanOrEqual(3);
      expect(slug.startsWith('k-')).toBe(true);
    });
  });

  describe('Control de Apertura y Reset', () => {
    it('openMerchantOnboarding abre el flujo y reinicia los campos', () => {
      openMerchantOnboarding('http://localhost:5173/');
      expect(merchantOnboardingActiveSignal.value).toBe(true);
      expect(returnUrlSignal.value).toBe('http://localhost:5173/');
      expect(merchantStepSignal.value).toBe(1);
    });

    it('si el usuario ya está autenticado, arranca directamente en el Paso 2 (Negocio)', () => {
      tokenSignal.value = 'jwt-mock';
      currentUserSignal.value = {
        id: 'u1',
        email: 'test@pos.com',
        name: 'Carlos',
        globalRole: 'user',
      };
      resetMerchantOnboarding();
      expect(merchantStepSignal.value).toBe(2);
    });

    it('closeMerchantOnboarding cierra el flujo y limpia el estado', () => {
      merchantOnboardingActiveSignal.value = true;
      closeMerchantOnboarding();
      expect(merchantOnboardingActiveSignal.value).toBe(false);
    });
  });

  describe('Validaciones de Paso 1 (Cuenta)', () => {
    it('valida campos obligatorios al registrar cuenta nueva', async () => {
      merchantStepSignal.value = 1;
      userNameSignal.value = '';
      await advanceMerchantStep();
      expect(errorMessageSignal.value).toContain('nombre');

      userNameSignal.value = 'Martín Gómez';
      userEmailSignal.value = 'invalido';
      await advanceMerchantStep();
      expect(errorMessageSignal.value).toContain('correo');

      userEmailSignal.value = 'martin@gmail.com';
      userPasswordSignal.value = '123';
      await advanceMerchantStep();
      expect(errorMessageSignal.value).toContain('6 caracteres');
    });

    it('avanza al Paso 2 si los datos de cuenta son válidos y registra al usuario', async () => {
      global.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/auth/register')) {
          return Promise.resolve(new Response(JSON.stringify({
            token: 'mock-jwt-step1',
            user: { id: 'usr_step1', email: 'martin@gmail.com', name: 'Martín Gómez' },
          }), { status: 201, headers: { 'content-type': 'application/json' } }));
        }
        if (urlStr.includes('/auth/me')) {
          return Promise.resolve(new Response(JSON.stringify({
            user: { id: 'usr_step1', email: 'martin@gmail.com', name: 'Martín Gómez', globalRole: 'user' },
            tenants: [],
          }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      });

      merchantStepSignal.value = 1;
      userNameSignal.value = 'Martín Gómez';
      userEmailSignal.value = 'martin@gmail.com';
      userPasswordSignal.value = 'segura123';

      await advanceMerchantStep();
      expect(merchantStepSignal.value).toBe(2);
      expect(errorMessageSignal.value).toBeNull();
      expect(tokenSignal.value).toBe('mock-jwt-step1');
    });

    it('detiene y advierte en el Paso 1 si el correo ya está registrado', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'El correo electrónico ya está registrado' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      );

      merchantStepSignal.value = 1;
      userNameSignal.value = 'Martín Gómez';
      userEmailSignal.value = 'existente@gmail.com';
      userPasswordSignal.value = 'segura123';

      await advanceMerchantStep();
      expect(merchantStepSignal.value).toBe(1);
      expect(errorMessageSignal.value).toContain('ya está registrado');
    });

    it('goBackMerchantStep permite volver del Paso 2 al 1 si no está autenticado', () => {
      merchantStepSignal.value = 2;
      goBackMerchantStep();
      expect(merchantStepSignal.value).toBe(1);
    });
  });

  describe('Validaciones de Paso 2 (Negocio)', () => {
    it('valida que el nombre del negocio no esté vacío', async () => {
      merchantStepSignal.value = 2;
      businessNameSignal.value = ' ';
      await advanceMerchantStep();
      expect(errorMessageSignal.value).toContain('nombre de tu comercio');
    });
  });

  describe('Aprovisionamiento Completo y Retorno con Credenciales', () => {
    it('registra usuario, crea tenant, siembra preset, genera API Key y arma URL de retorno para el POS', async () => {
      const fetchCalls: Array<{ url: string; method?: string; body?: unknown }> = [];

      global.fetch = vi.fn().mockImplementation((url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        const method = opts?.method ?? 'GET';
        const parsedBody = typeof opts?.body === 'string' ? (JSON.parse(opts.body) as Record<string, unknown>) : undefined;
        fetchCalls.push({ url: urlStr, method, body: parsedBody });

        // 1. Registro
        if (urlStr.includes('/auth/register')) {
          return Promise.resolve(new Response(JSON.stringify({
            token: 'mock-jwt-merchant',
            user: { id: 'usr_new', email: 'pepe@kiosco.com', name: 'Pepe' },
          }), { status: 201, headers: { 'content-type': 'application/json' } }));
        }

        // 2. Auth me
        if (urlStr.includes('/auth/me')) {
          return Promise.resolve(new Response(JSON.stringify({
            user: { id: 'usr_new', email: 'pepe@kiosco.com', name: 'Pepe', globalRole: 'user' },
            tenants: [{ tenantId: 'kiosco-pepe-1234', slug: 'kiosco-pepe-1234', name: 'Kiosco Pepe', status: 'active', role: 'owner' }],
          }), { status: 200, headers: { 'content-type': 'application/json' } }));
        }

        // 3. Crear tenant
        if (urlStr.endsWith('/tenants') && method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({
            id: typeof parsedBody?.['id'] === 'string' ? parsedBody['id'] : 'tenant-id',
            slug: typeof parsedBody?.['slug'] === 'string' ? parsedBody['slug'] : 'slug',
            name: typeof parsedBody?.['name'] === 'string' ? parsedBody['name'] : 'name',
          }), { status: 201, headers: { 'content-type': 'application/json' } }));
        }

        // 4. Sembrar preset
        if (urlStr.includes('/seed-preset') && method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({ success: true, count: 15 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }));
        }

        // 5. Crear API Key
        if (urlStr.includes('/api-keys') && method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({
            id: 'key_123',
            key: 'pos_live_merchant_xyz',
            branch: 'CENTRAL',
            pointOfSale: 'Caja 1',
          }), { status: 201, headers: { 'content-type': 'application/json' } }));
        }

        return Promise.resolve(new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }));
      });

      // Configurar inputs
      userNameSignal.value = 'Pepe Argento';
      userEmailSignal.value = 'pepe@kiosco.com';
      userPasswordSignal.value = 'pepe123456';
      businessNameSignal.value = 'Kiosco Pepe & Amigos';
      selectedMerchantPresetSignal.value = 'kiosco';
      returnUrlSignal.value = 'http://localhost:5173/';

      await executeMerchantProvisioning();

      expect(merchantStepSignal.value).toBe(4);
      expect(merchantResultSignal.value).not.toBeNull();
      expect(merchantResultSignal.value?.name).toBe('Kiosco Pepe & Amigos');
      expect(merchantResultSignal.value?.apiKey).toBe('pos_live_merchant_xyz');
      expect(merchantResultSignal.value?.branch).toBe('CENTRAL');
      expect(merchantResultSignal.value?.pointOfSale).toBe('Caja 1');

      // Verificar que la URL de retorno incluya las credenciales listas para el POS
      const returnWithParams = merchantResultSignal.value?.returnWithParamsUrl;
      expect(returnWithParams).toContain('http://localhost:5173/');
      expect(returnWithParams).toContain('api_key=pos_live_merchant_xyz');
      expect(returnWithParams).toContain('branch=CENTRAL');
      expect(returnWithParams).toContain('pos_terminal=Caja+1');

      // Verificar que el tenant creado quedó como activo en el cliente
      expect(activeTenantIdSignal.value).toBe(merchantResultSignal.value?.tenantId);

      // Finalizar e ingresar al dashboard
      enterDashboardFromOnboarding();
      expect(merchantOnboardingActiveSignal.value).toBe(false);
      expect(activeViewSignal.value).toBe('dashboard');
    });
  });
});
