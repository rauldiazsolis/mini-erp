import { signal } from '@preact/signals';
import { apiFetch, ApiError } from '../api/client.ts';
import {
  tokenSignal,
  isAuthenticatedSignal,
  fetchProfile,
  adoptSession,
  setActiveTenant,
  login,
} from './auth-state.ts';
import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE } from '../../shared/password.ts';
import { navigateTo } from './navigation-state.ts';
import { navigate, routeFromPath } from './route-state.ts';
import { showToast } from './toast-state.ts';
import { buildConnectReturnUrl } from './connect-return.ts';
import type { BusinessPreset } from './onboarding-state.ts';

export type MerchantProvisionResult = {
  tenantId: string;
  name: string;
  apiKey: string;
  branch: string;
  pointOfSale: string;
  connectorUrl: string;
  returnUrl: string | null;
  /** `<return_url>#connect=…` para volver al POS; null si no vino `return_url` o no es válido. */
  connectReturnUrl: string | null;
  /** El host al que vuelve, para mostrarlo antes de mandar la conexión. */
  returnHost: string | null;
  preset: BusinessPreset;
};

// Control de visibilidad del flujo comercial
export const merchantOnboardingActiveSignal = signal<boolean>(false);

// Parámetros de URL capturados (ej: desde POS demo o Landing)
export const returnUrlSignal = signal<string | null>(null);
export const wipeKeySignal = signal<string | null>(null);

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

export type AltaTemplate = 'kiosco' | 'almacen' | 'ferreteria';
const ALTA_TEMPLATES: readonly AltaTemplate[] = ['kiosco', 'almacen', 'ferreteria'];

function isAltaTemplate(value: string): value is AltaTemplate {
  return (ALTA_TEMPLATES as readonly string[]).includes(value);
}

/** Lo que el POS (o el link de una demo) le pasa a `/alta`: `return_url`, `wipe_key` y `template`. */
export function readAltaParams(href: string): {
  returnUrl: string | null;
  wipeKey: string | null;
  template: AltaTemplate | null;
} {
  const params = new URL(href).searchParams;
  const template = params.get('template');
  return {
    returnUrl: params.get('return_url') || null,
    wipeKey: params.get('wipe_key') || null,
    template: template !== null && isAltaTemplate(template) ? template : null,
  };
}

/**
 * En `/alta`, abre el alta con lo que mandó el POS (#9): adónde volver, el `wipe_key` y el rubro de
 * la demo.
 */
export function initMerchantOnboardingFromUrl(): void {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (routeFromPath(url.pathname) !== 'alta') return;

  merchantOnboardingActiveSignal.value = true;
  const { returnUrl, wipeKey, template } = readAltaParams(url.href);
  returnUrlSignal.value = returnUrl;
  wipeKeySignal.value = wipeKey;
  if (template !== null) {
    selectedMerchantPresetSignal.value = template;
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
  wipeKeySignal.value = null;
}

export function openMerchantOnboarding(customReturnUrl?: string): void {
  resetMerchantOnboarding();
  if (customReturnUrl) {
    returnUrlSignal.value = customReturnUrl;
  }
  merchantOnboardingActiveSignal.value = true;
  navigate('/alta');
}

export function closeMerchantOnboarding(): void {
  merchantOnboardingActiveSignal.value = false;
  resetMerchantOnboarding();
  navigate('/admin');
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
        isSubmittingSignal.value = true;
        try {
          const ok = await login({
            email: userEmailSignal.value.trim(),
            password: userPasswordSignal.value,
          });
          if (!ok) {
            errorMessageSignal.value = 'Credenciales inválidas o correo no registrado';
            return;
          }
        } finally {
          isSubmittingSignal.value = false;
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
        if (userPasswordSignal.value.length < PASSWORD_MIN_LENGTH) {
          errorMessageSignal.value = PASSWORD_MIN_MESSAGE;
          return;
        }
        // La cuenta se crea junto con el comercio, en un solo POST /api/alta (#19)
      }
    }
    // Pasa a datos del negocio habiendo validado/autenticado con éxito
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

    // Cuenta (si no hay sesión), comercio, catálogo del rubro y key de Caja 1 en un solo pedido (#19)
    progressStepMessageSignal.value = 'Creando tu comercio, su catálogo y la conexión de tu caja...';
    const businessName = businessNameSignal.value.trim();
    const preset = selectedMerchantPresetSignal.value;
    const authenticated = isAuthenticatedSignal.value;
    const res = await apiFetch<{
      token?: string;
      tenant: { id: string; name: string };
      posKey: { key: string; branch: string; pointOfSale: string };
    }>('alta', {
      method: 'POST',
      token: authenticated ? tokenSignal.value : null,
      body: authenticated
        ? { businessName, template: preset }
        : {
            name: userNameSignal.value.trim(),
            email: userEmailSignal.value.trim(),
            password: userPasswordSignal.value,
            businessName,
            template: preset,
          },
    });

    if (res.token !== undefined) {
      await adoptSession(res.token);
    } else {
      await fetchProfile();
    }
    const tenantId = res.tenant.id;
    setActiveTenant(tenantId);
    const apiKey = res.posKey.key;
    const branchCode = res.posKey.branch;
    const posTerminalName = res.posKey.pointOfSale;

    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4100';
    const connectorUrl = `${origin}/connector`;

    // Vuelta al POS con la conexión en el fragmento (contrato 4.4.0), si vino return_url
    const rawReturnUrl = returnUrlSignal.value;
    const connectReturnUrl =
      rawReturnUrl === null
        ? undefined
        : buildConnectReturnUrl(rawReturnUrl, {
            baseUrl: connectorUrl,
            apiKey,
            branch: branchCode,
            pointOfSale: posTerminalName,
            wipeKey: wipeKeySignal.value ?? undefined,
          });

    merchantResultSignal.value = {
      tenantId,
      name: businessName,
      apiKey,
      branch: branchCode,
      pointOfSale: posTerminalName,
      connectorUrl,
      returnUrl: rawReturnUrl,
      connectReturnUrl: connectReturnUrl ?? null,
      returnHost: connectReturnUrl === undefined ? null : new URL(connectReturnUrl).host,
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
    if (err instanceof ApiError && err.status === 409) {
      // El mail ya tiene cuenta: vuelve al paso 1 para iniciar sesión
      isExistingAccountSignal.value = true;
      merchantStepSignal.value = 1;
    } else {
      merchantStepSignal.value = 2; // Permitir reintentar
    }
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
  navigate('/admin');
  navigateTo('dashboard');
}

/**
 * Retorna al POS con las credenciales automáticas
 */
export function returnToPosWithCredentials(): void {
  const res = merchantResultSignal.value;
  if (res?.connectReturnUrl && typeof window !== 'undefined') {
    window.location.href = res.connectReturnUrl;
  }
}
