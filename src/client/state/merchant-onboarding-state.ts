import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import {
  tokenSignal,
  currentUserSignal,
  isAuthenticatedSignal,
  fetchProfile,
  setActiveTenant,
  login,
} from './auth-state.ts';
import { navigateTo } from './navigation-state.ts';
import { showToast } from './toast-state.ts';
import type { BusinessPreset } from './onboarding-state.ts';

export type MerchantProvisionResult = {
  tenantId: string;
  name: string;
  apiKey: string;
  branch: string;
  pointOfSale: string;
  connectorUrl: string;
  returnUrl: string | null;
  returnWithParamsUrl: string | null;
  preset: BusinessPreset;
};

// Control de visibilidad del flujo comercial
export const merchantOnboardingActiveSignal = signal<boolean>(false);

// Parámetros de URL capturados (ej: desde POS demo o Landing)
export const returnUrlSignal = signal<string | null>(null);

// Estado de pasos: 1: Cuenta, 2: Negocio/Rubro, 3: Aprovisionando, 4: Éxito
export const merchantStepSignal = signal<number>(1);

// Paso 1: Cuenta de usuario
export const isExistingAccountSignal = signal<boolean>(false);
export const userNameSignal = signal<string>('');
export const userEmailSignal = signal<string>('');
export const userPasswordSignal = signal<string>('');

// Paso 2: Datos del Comercio (100% amigable para el comerciante)
export const businessNameSignal = signal<string>('');
export const selectedMerchantPresetSignal = signal<BusinessPreset>('kiosco');

// Estados de proceso
export const isSubmittingSignal = signal<boolean>(false);
export const progressStepMessageSignal = signal<string>('');
export const errorMessageSignal = signal<string | null>(null);
export const merchantResultSignal = signal<MerchantProvisionResult | null>(null);

// Helper para sanitizar nombres a slug/identificador
export function sanitizeToSlug(text: string): string {
  const clean = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (clean.length < 3) {
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    return `${clean ? clean + '-' : 'tienda-'}${randomSuffix}`;
  }
  return clean;
}

/**
 * Inicializa el onboarding detectando parámetros de query o hash.
 */
export function initMerchantOnboardingFromUrl(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  const searchParams = url.searchParams;

  const pathname = url.pathname.toLowerCase();
  const hash = url.hash.toLowerCase();
  const isOnboardingParam = searchParams.get('onboarding') === 'true' || searchParams.get('view') === 'onboarding';

  if (pathname.includes('/onboarding') || hash.includes('onboarding') || isOnboardingParam) {
    merchantOnboardingActiveSignal.value = true;
  }

  // Capturar return_url (para retorno al POS demo)
  const ret = searchParams.get('return_url') || searchParams.get('returnUrl') || searchParams.get('redirect_uri');
  if (ret) {
    returnUrlSignal.value = ret;
  }

  // Capturar preset sugerido si viniera del demo
  const presetParam = searchParams.get('preset') as BusinessPreset | null;
  if (presetParam && ['kiosco', 'ferreteria', 'almacen', 'empty'].includes(presetParam)) {
    selectedMerchantPresetSignal.value = presetParam;
  }

  // Si el usuario ya está autenticado, avanzamos directamente al paso de negocio
  if (isAuthenticatedSignal.value) {
    merchantStepSignal.value = 2;
  }
}

/**
 * Reinicia los valores del onboarding
 */
export function resetMerchantOnboarding(): void {
  merchantStepSignal.value = isAuthenticatedSignal.value ? 2 : 1;
  isExistingAccountSignal.value = false;
  userNameSignal.value = '';
  userEmailSignal.value = '';
  userPasswordSignal.value = '';
  businessNameSignal.value = '';
  selectedMerchantPresetSignal.value = 'kiosco';
  isSubmittingSignal.value = false;
  progressStepMessageSignal.value = '';
  errorMessageSignal.value = null;
  merchantResultSignal.value = null;
}

export function openMerchantOnboarding(customReturnUrl?: string): void {
  resetMerchantOnboarding();
  if (customReturnUrl) {
    returnUrlSignal.value = customReturnUrl;
  }
  merchantOnboardingActiveSignal.value = true;
}

export function closeMerchantOnboarding(): void {
  merchantOnboardingActiveSignal.value = false;
  resetMerchantOnboarding();
  if (typeof window !== 'undefined' && window.location.pathname.includes('/onboarding')) {
    window.history.pushState(null, '', '/');
  }
}

/**
 * Avanza el paso con validaciones específicas
 */
export async function advanceMerchantStep(): Promise<void> {
  errorMessageSignal.value = null;

  // Paso 1: Cuenta de usuario
  if (merchantStepSignal.value === 1) {
    if (!isAuthenticatedSignal.value) {
      if (isExistingAccountSignal.value) {
        // Iniciar sesión con cuenta existente
        if (!userEmailSignal.value.trim() || !userPasswordSignal.value.trim()) {
          errorMessageSignal.value = 'Ingresa tu correo y contraseña para continuar';
          return;
        }
        const ok = await login({
          email: userEmailSignal.value.trim(),
          password: userPasswordSignal.value,
        });
        if (!ok) {
          errorMessageSignal.value = 'Credenciales inválidas o correo no registrado';
          return;
        }
      } else {
        // Registro de nueva cuenta
        if (!userNameSignal.value.trim()) {
          errorMessageSignal.value = 'Por favor ingresa tu nombre o el de la persona a cargo';
          return;
        }
        if (!userEmailSignal.value.trim() || !userEmailSignal.value.includes('@')) {
          errorMessageSignal.value = 'Ingresa un correo electrónico válido';
          return;
        }
        if (userPasswordSignal.value.length < 6) {
          errorMessageSignal.value = 'La contraseña debe tener al menos 6 caracteres';
          return;
        }
      }
    }
    // Pasa a datos del negocio
    merchantStepSignal.value = 2;
    return;
  }

  // Paso 2: Negocio & Rubro -> Disparar aprovisionamiento
  if (merchantStepSignal.value === 2) {
    if (businessNameSignal.value.trim().length < 2) {
      errorMessageSignal.value = 'Por favor escribe el nombre de tu comercio o negocio';
      return;
    }
    await executeMerchantProvisioning();
  }
}

/**
 * Retroceder un paso
 */
export function goBackMerchantStep(): void {
  errorMessageSignal.value = null;
  if (merchantStepSignal.value === 2 && !isAuthenticatedSignal.value) {
    merchantStepSignal.value = 1;
  }
}

/**
 * Ejecuta el aprovisionamiento transparente
 */
export async function executeMerchantProvisioning(): Promise<void> {
  try {
    isSubmittingSignal.value = true;
    errorMessageSignal.value = null;
    merchantStepSignal.value = 3;

    let token = tokenSignal.value;

    // 1. Si el usuario no estaba autenticado, registrarlo ahora
    if (!token && !isAuthenticatedSignal.value) {
      progressStepMessageSignal.value = 'Creando tu cuenta de usuario...';
      const registerRes = await apiFetch<{
        user: { id: string; email: string; name: string };
        token: string;
      }>('auth/register', {
        method: 'POST',
        body: {
          name: userNameSignal.value.trim(),
          email: userEmailSignal.value.trim(),
          password: userPasswordSignal.value,
        },
      });

      token = registerRes.token;
      tokenSignal.value = registerRes.token;
      currentUserSignal.value = {
        id: registerRes.user.id,
        email: registerRes.user.email,
        name: registerRes.user.name,
        globalRole: 'user',
      };
      await fetchProfile();
    }

    if (!token) {
      throw new Error('No se pudo establecer la sesión para crear el comercio');
    }

    // 2. Generar slug e ID limpio para SQLite
    progressStepMessageSignal.value = 'Aprovisionando base de datos segura y aislada...';
    const businessName = businessNameSignal.value.trim();
    const baseSlug = sanitizeToSlug(businessName);
    const uniqueSuffix = Math.random().toString(36).substring(2, 6);
    const tenantId = `${baseSlug}-${uniqueSuffix}`;
    const slug = tenantId;

    // Crear Tenant
    await apiFetch('tenants', {
      method: 'POST',
      body: {
        id: tenantId,
        slug,
        name: businessName,
        seedDemoData: false,
      },
      token,
    });

    // 3. Poblar preset si corresponde
    const preset = selectedMerchantPresetSignal.value;
    if (preset !== 'empty') {
      progressStepMessageSignal.value = `Precargando catálogo y rubro modelo (${preset})...`;
      try {
        await apiFetch(`tenants/${tenantId}/seed-preset`, {
          method: 'POST',
          body: { preset },
          token,
        });
      } catch (err: unknown) {
        console.warn('Aviso al sembrar preset comercial:', err);
      }
    }

    // 4. Crear API Key inicial para la terminal POS (Casa Central / Caja 1)
    progressStepMessageSignal.value = 'Generando credenciales de sincronización para tu caja...';
    const branchCode = 'CENTRAL';
    const posTerminalName = 'Caja 1';

    const keyRes = await apiFetch<{
      id: string;
      key?: string;
      rawKey?: string;
      branch: string;
      pointOfSale: string;
    }>(`tenants/${tenantId}/api-keys`, {
      method: 'POST',
      body: {
        name: posTerminalName,
        branch: branchCode,
        pointOfSale: posTerminalName,
      },
      token,
    });

    const apiKey = keyRes.key || keyRes.rawKey || '';

    // Actualizar perfil del usuario y seleccionar el nuevo tenant
    await fetchProfile();
    setActiveTenant(tenantId);

    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4100';
    const connectorUrl = `${origin}/connector`;

    // Armar URL de retorno con credenciales para auto-conexión del POS si se especificó returnUrl
    let returnWithParamsUrl: string | null = null;
    const rawReturnUrl = returnUrlSignal.value;
    if (rawReturnUrl) {
      try {
        const u = new URL(rawReturnUrl, origin);
        u.searchParams.set('api_key', apiKey);
        u.searchParams.set('tenant_id', tenantId);
        u.searchParams.set('connector_url', connectorUrl);
        u.searchParams.set('branch', branchCode);
        u.searchParams.set('pos_terminal', posTerminalName);
        u.searchParams.set('business_name', businessName);
        u.searchParams.set('preset', preset);
        returnWithParamsUrl = u.toString();
      } catch {
        returnWithParamsUrl = rawReturnUrl;
      }
    }

    merchantResultSignal.value = {
      tenantId,
      name: businessName,
      apiKey,
      branch: branchCode,
      pointOfSale: posTerminalName,
      connectorUrl,
      returnUrl: rawReturnUrl,
      returnWithParamsUrl,
      preset,
    };

    merchantStepSignal.value = 4;
    showToast({
      type: 'success',
      title: '¡Comercio Creado!',
      message: `"${businessName}" está listo para operar`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error inesperado durante el aprovisionamiento';
    errorMessageSignal.value = msg;
    merchantStepSignal.value = 2; // Permitir reintentar
  } finally {
    isSubmittingSignal.value = false;
  }
}

/**
 * Finaliza el onboarding e ingresa al Dashboard de Mini-ERP
 */
export function enterDashboardFromOnboarding(): void {
  const res = merchantResultSignal.value;
  if (res) {
    setActiveTenant(res.tenantId);
  }
  merchantOnboardingActiveSignal.value = false;
  if (typeof window !== 'undefined' && window.location.pathname.includes('/onboarding')) {
    window.history.pushState(null, '', '/');
  }
  navigateTo('dashboard');
}

/**
 * Retorna al POS con las credenciales automáticas
 */
export function returnToPosWithCredentials(): void {
  const res = merchantResultSignal.value;
  if (res?.returnWithParamsUrl && typeof window !== 'undefined') {
    window.location.href = res.returnWithParamsUrl;
  }
}
