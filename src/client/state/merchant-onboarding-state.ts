import { signal } from '@preact/signals';
import { apiFetch, ApiError } from '../api/client.ts';
import {
  tokenSignal,
  isAuthenticatedSignal,
  fetchProfile,
  adoptSession,
  rememberTenant,
  login,
} from './auth-state.ts';
import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE } from '../../shared/password.ts';
import { navigate, routeFromPath } from './route-state.ts';
import { showToast } from './toast-state.ts';
import { buildConnectReturnUrl } from './connect-return.ts';
import { resetImport } from './import-state.ts';
import { invalidateAfter } from './invalidation.ts';
import type { BusinessType } from '../../shared/business-type.ts';
import { normalizeWhatsapp, WHATSAPP_MESSAGE } from '../../shared/whatsapp.ts';
import { beaconOnce } from './funnel-public-state.ts';

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
  businessType: BusinessType;
};

// Control de visibilidad del flujo comercial
export const merchantOnboardingActiveSignal = signal<boolean>(false);

// Parámetros de URL capturados (ej: desde POS demo o Landing)
export const returnUrlSignal = signal<string | null>(null);
export const wipeKeySignal = signal<string | null>(null);
/** La demo de la que viene el alta (#25), para ligar el comercio nuevo a su visitante. */
export const demoSessionIdSignal = signal<string | null>(null);

// Estado de pasos: 1: Cuenta, 2: Negocio/Rubro, 3: Aprovisionando, 4: Éxito
/**
 * Pasos del alta: 1 cuenta, 2 comercio, 3 creando, 4 "Cargá tus datos" (#22) y 5 listo. El comercio
 * nace vacío en el 3: desde el 4 no se vuelve atrás.
 */
export const LOAD_STEP = 4;
export const DONE_STEP = 5;
export const merchantStepSignal = signal<number>(1);

// Paso 1: Cuenta de usuario
export const isExistingAccountSignal = signal<boolean>(false);
export const userNameSignal = signal<string>('');
export const userEmailSignal = signal<string>('');
export const userPasswordSignal = signal<string>('');
export const userWhatsappSignal = signal<string>('');

// Paso 2: Datos del Comercio (100% amigable para el comerciante)
export const businessNameSignal = signal<string>('');
export const selectedBusinessTypeSignal = signal<BusinessType>('kiosco');
/** En "Cargá tus datos": las tarjetas o el asistente de importación. */
export const loadModeSignal = signal<'choose' | 'files'>('choose');

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
  demo: string | null;
} {
  const params = new URL(href).searchParams;
  const template = params.get('template');
  return {
    returnUrl: params.get('return_url') || null,
    wipeKey: params.get('wipe_key') || null,
    template: template !== null && isAltaTemplate(template) ? template : null,
    // La demo de la que viene (#25): liga el comercio que nazca a su visitante
    demo: params.get('demo') || null,
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
  const { returnUrl, wipeKey, template, demo } = readAltaParams(url.href);
  returnUrlSignal.value = returnUrl;
  wipeKeySignal.value = wipeKey;
  demoSessionIdSignal.value = demo;
  // El alta abierta (#25): con demo, el evento del visitante; sin demo, el total anónimo del día
  beaconOnce('alta-open', demo ?? undefined);
  if (template !== null) {
    selectedBusinessTypeSignal.value = template;
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
  userWhatsappSignal.value = '';
  businessNameSignal.value = '';
  selectedBusinessTypeSignal.value = 'kiosco';
  loadModeSignal.value = 'choose';
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
        if (normalizeWhatsapp(userWhatsappSignal.value) === undefined) {
          errorMessageSignal.value = WHATSAPP_MESSAGE;
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

    // Cuenta (si no hay sesión), comercio vacío con su rubro y key de Caja 1 en un solo pedido (#19, #22)
    progressStepMessageSignal.value = 'Creando tu comercio y la conexión de tu caja...';
    const businessName = businessNameSignal.value.trim();
    const businessType = selectedBusinessTypeSignal.value;
    const authenticated = isAuthenticatedSignal.value;
    const demo = demoSessionIdSignal.value === null ? {} : { demoSessionId: demoSessionIdSignal.value };
    const res = await apiFetch<{
      token?: string;
      tenant: { id: string; name: string };
      posKey: { key: string; branch: string; pointOfSale: string };
    }>('alta', {
      method: 'POST',
      token: authenticated ? tokenSignal.value : null,
      body: authenticated
        ? { businessName, businessType, ...demo }
        : {
            name: userNameSignal.value.trim(),
            email: userEmailSignal.value.trim(),
            password: userPasswordSignal.value,
            whatsapp: userWhatsappSignal.value.trim(),
            businessName,
            businessType,
            ...demo,
          },
    });

    if (res.token !== undefined) {
      await adoptSession(res.token);
    } else {
      await fetchProfile();
    }
    const tenantId = res.tenant.id;
    rememberTenant(tenantId);
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
      businessType,
    };

    // Sigue "Cargá tus datos": el comercio nació vacío (#22)
    loadModeSignal.value = 'choose';
    resetImport();
    merchantStepSignal.value = LOAD_STEP;
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

/** "Subir mis archivos": el asistente de importación, ahí mismo, sobre el comercio recién creado (#22). */
export function chooseUploadFiles(): void {
  resetImport();
  loadModeSignal.value = 'files';
}

/** "Lo hago después" (o "Seguir" al terminar de importar). */
export function skipLoadStep(): void {
  errorMessageSignal.value = null;
  merchantStepSignal.value = DONE_STEP;
}

/** "Empezar con el catálogo de ejemplo" del rubro elegido (#22). */
export async function loadExampleCatalogOnSignup(): Promise<void> {
  const res = merchantResultSignal.value;
  const token = tokenSignal.value;
  if (res === null || !token) return;
  isSubmittingSignal.value = true;
  errorMessageSignal.value = null;
  try {
    await apiFetch<{ productsCreated: number }>(`tenants/${res.tenantId}/catalog/example`, { method: 'POST', token });
    void invalidateAfter('products-imported');
    merchantStepSignal.value = DONE_STEP;
  } catch (err: unknown) {
    errorMessageSignal.value = err instanceof Error ? err.message : 'No se pudo cargar el catálogo de ejemplo';
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
    rememberTenant(res.tenantId);
  }
  merchantOnboardingActiveSignal.value = false;
  navigate('/admin');
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
