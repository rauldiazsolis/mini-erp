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
  wipeKeySignal,
  readAltaParams,
  errorMessageSignal,
  merchantResultSignal,
  isExistingAccountSignal,
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

  describe('Parámetros de /alta (#9)', () => {
    it('lee return_url, wipe_key y template', () => {
      expect(
        readAltaParams(
          'http://localhost:4100/alta?template=almacen&return_url=https%3A%2F%2Foffline-pos.pages.dev%2F0.1.0%2F&wipe_key=wk-9',
        ),
      ).toEqual({ returnUrl: 'https://offline-pos.pages.dev/0.1.0/', wipeKey: 'wk-9', template: 'almacen' });
    });

    it('ignora un template desconocido y los parámetros viejos', () => {
      expect(readAltaParams('http://localhost:4100/alta?template=panaderia&returnUrl=x&preset=almacen')).toEqual({
        returnUrl: null,
        wipeKey: null,
        template: null,
      });
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
      expect(errorMessageSignal.value).toBe('La contraseña debe tener al menos 8 caracteres');

      userPasswordSignal.value = '1234567';
      await advanceMerchantStep();
      expect(merchantStepSignal.value).toBe(1);
    });

    it('avanza al Paso 2 sin llamar al servidor: la cuenta se crea con el alta (#19)', async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      merchantStepSignal.value = 1;
      userNameSignal.value = 'Martín Gómez';
      userEmailSignal.value = 'martin@gmail.com';
      userPasswordSignal.value = 'segura123';

      await advanceMerchantStep();
      expect(merchantStepSignal.value).toBe(2);
      expect(errorMessageSignal.value).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
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
    it('crea cuenta y comercio con un solo POST /api/alta y arma la URL de retorno para el POS', async () => {
      const fetchCalls: Array<{ url: string; method?: string; body?: unknown; auth?: string | undefined }> = [];

      global.fetch = vi.fn().mockImplementation((url: string | URL | Request, opts?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        const method = opts?.method ?? 'GET';
        const parsedBody = typeof opts?.body === 'string' ? (JSON.parse(opts.body) as Record<string, unknown>) : undefined;
        const headers = (opts?.headers ?? {}) as Record<string, string>;
        fetchCalls.push({ url: urlStr, method, body: parsedBody, auth: headers['Authorization'] });

        if (urlStr.endsWith('/api/alta') && method === 'POST') {
          return Promise.resolve(new Response(JSON.stringify({
            token: 'mock-jwt-merchant',
            user: { id: 'usr_new', email: 'pepe@kiosco.com', name: 'Pepe Argento', globalRole: 'user' },
            tenant: { id: 'kiosco-pepe-amigos', name: 'Kiosco Pepe & Amigos' },
            posKey: { key: 'pos_live_merchant_xyz', branch: 'CENTRAL', pointOfSale: 'Caja 1' },
          }), { status: 201, headers: { 'content-type': 'application/json' } }));
        }

        if (urlStr.includes('/auth/me')) {
          return Promise.resolve(new Response(JSON.stringify({
            user: { id: 'usr_new', email: 'pepe@kiosco.com', name: 'Pepe Argento', globalRole: 'user' },
            tenants: [{ tenantId: 'kiosco-pepe-amigos', slug: 'kiosco-pepe-amigos', name: 'Kiosco Pepe & Amigos', status: 'active', role: 'owner' }],
          }), { status: 200, headers: { 'content-type': 'application/json' } }));
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
      wipeKeySignal.value = 'wk-123';

      await executeMerchantProvisioning();

      expect(merchantStepSignal.value).toBe(4);
      expect(merchantResultSignal.value).not.toBeNull();
      const altaCalls = fetchCalls.filter((c) => c.url.endsWith('/api/alta'));
      expect(altaCalls).toHaveLength(1);
      expect(altaCalls[0]?.body).toEqual({
        name: 'Pepe Argento',
        email: 'pepe@kiosco.com',
        password: 'pepe123456',
        businessName: 'Kiosco Pepe & Amigos',
        template: 'kiosco',
      });
      expect(altaCalls[0]?.auth).toBeUndefined();
      expect(tokenSignal.value).toBe('mock-jwt-merchant');
      expect(merchantResultSignal.value?.name).toBe('Kiosco Pepe & Amigos');
      expect(merchantResultSignal.value?.apiKey).toBe('pos_live_merchant_xyz');
      expect(merchantResultSignal.value?.branch).toBe('CENTRAL');
      expect(merchantResultSignal.value?.pointOfSale).toBe('Caja 1');

      // La vuelta al POS lleva la conexión en #connect (contrato 4.4.0), nunca en la query
      const connectUrl = merchantResultSignal.value?.connectReturnUrl ?? '';
      expect(connectUrl.startsWith('http://localhost:5173/#connect=')).toBe(true);
      expect(connectUrl).not.toContain('api_key=');
      const payload: unknown = JSON.parse(
        Buffer.from(new URL(connectUrl).hash.slice('#connect='.length), 'base64url').toString('utf-8'),
      );
      expect(payload).toEqual({
        baseUrl: 'http://localhost:4100/connector',
        apiKey: 'pos_live_merchant_xyz',
        branch: 'CENTRAL',
        pointOfSale: 'Caja 1',
        wipeKey: 'wk-123',
      });
      expect(merchantResultSignal.value?.returnHost).toBe('localhost:5173');

      // Verificar que el tenant creado quedó como activo en el cliente
      expect(activeTenantIdSignal.value).toBe('kiosco-pepe-amigos');

      // Finalizar e ingresar al dashboard
      enterDashboardFromOnboarding();
      expect(merchantOnboardingActiveSignal.value).toBe(false);
      expect(activeViewSignal.value).toBe('dashboard');
    });

    it('con sesión manda solo el comercio, con el token', async () => {
      tokenSignal.value = 'jwt-existente';
      currentUserSignal.value = { id: 'u1', email: 'a@b.com', name: 'Ana', globalRole: 'user' };
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/api/alta')) {
          return Promise.resolve(new Response(JSON.stringify({
            user: { id: 'u1', email: 'a@b.com', name: 'Ana', globalRole: 'user' },
            tenant: { id: 'otro', name: 'Otro' },
            posKey: { key: 'k', branch: 'CENTRAL', pointOfSale: 'Caja 1' },
          }), { status: 201, headers: { 'content-type': 'application/json' } }));
        }
        return Promise.resolve(new Response(JSON.stringify({ user: { id: 'u1', email: 'a@b.com', name: 'Ana', globalRole: 'user' }, tenants: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      });
      global.fetch = fetchMock;
      businessNameSignal.value = 'Otro';
      selectedMerchantPresetSignal.value = 'almacen';

      await executeMerchantProvisioning();

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.body).toBe(JSON.stringify({ businessName: 'Otro', template: 'almacen' }));
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-existente');
      expect(tokenSignal.value).toBe('jwt-existente');
    });

    it('un mail ya registrado vuelve al Paso 1 con "iniciá sesión"', async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Ya tenés una cuenta con ese correo: iniciá sesión' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      );
      userNameSignal.value = 'Martín';
      userEmailSignal.value = 'existente@gmail.com';
      userPasswordSignal.value = 'segura123';
      businessNameSignal.value = 'Kiosco';

      await executeMerchantProvisioning();

      expect(merchantStepSignal.value).toBe(1);
      expect(isExistingAccountSignal.value).toBe(true);
      expect(errorMessageSignal.value).toBe('Ya tenés una cuenta con ese correo: iniciá sesión');
    });
  });
});
