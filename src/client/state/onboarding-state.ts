import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import {
  tokenSignal,
  fetchProfile,
  setActiveTenant,
} from './auth-state.ts';
import { closeOnboardingModal } from './navigation-state.ts';
import { showToast } from './toast-state.ts';

export type BusinessPreset = 'kiosco' | 'ferreteria' | 'almacen' | 'empty';

export type ProvisionResult = {
  tenantId: string;
  name: string;
  apiKey: string;
  branch: string;
  pointOfSale: string;
  connectorUrl: string;
};

/** "Crear nuevo comercio…" (con sesión, #19): 1 nombre, 2 rubro, 3 resultado. */
export const DONE_STEP = 3;

export const stepSignal = signal<number>(1);
export const nameSignal = signal<string>('');
export const selectedPresetSignal = signal<BusinessPreset>('kiosco');
export const isSubmittingSignal = signal<boolean>(false);
export const errorMessageSignal = signal<string | null>(null);
export const provisionResultSignal = signal<ProvisionResult | null>(null);

export function setName(val: string): void {
  nameSignal.value = val;
  errorMessageSignal.value = null;
}

export function resetOnboarding(): void {
  stepSignal.value = 1;
  nameSignal.value = '';
  selectedPresetSignal.value = 'kiosco';
  isSubmittingSignal.value = false;
  errorMessageSignal.value = null;
  provisionResultSignal.value = null;
}

export function nextStep(): void {
  errorMessageSignal.value = null;

  if (stepSignal.value === 1) {
    if (nameSignal.value.trim().length < 2) {
      errorMessageSignal.value = 'El nombre del comercio debe tener al menos 2 caracteres';
      return;
    }
    stepSignal.value = 2;
    return;
  }

  if (stepSignal.value === 2) {
    void submitOnboarding();
  }
}

export function prevStep(): void {
  errorMessageSignal.value = null;
  if (stepSignal.value > 1 && stepSignal.value < DONE_STEP) {
    stepSignal.value--;
  }
}

/** El servidor arma el identificador y crea la key de Caja 1 en CENTRAL (POST /api/alta, #19). */
export async function submitOnboarding(): Promise<void> {
  const token = tokenSignal.value;
  if (!token) {
    errorMessageSignal.value = 'Debes estar autenticado para crear un comercio';
    return;
  }

  try {
    isSubmittingSignal.value = true;
    errorMessageSignal.value = null;

    const name = nameSignal.value.trim();
    const res = await apiFetch<{
      tenant: { id: string; name: string };
      posKey: { key: string; branch: string; pointOfSale: string };
    }>('alta', {
      method: 'POST',
      token,
      body: { businessName: name, template: selectedPresetSignal.value },
    });

    await fetchProfile();

    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4100';
    provisionResultSignal.value = {
      tenantId: res.tenant.id,
      name: res.tenant.name,
      apiKey: res.posKey.key,
      branch: res.posKey.branch,
      pointOfSale: res.posKey.pointOfSale,
      connectorUrl: `${origin}/connector`,
    };

    stepSignal.value = DONE_STEP;
    showToast({
      type: 'success',
      title: '¡Comercio Creado!',
      message: `"${res.tenant.name}" fue aprovisionado con éxito`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al aprovisionar comercio';
    errorMessageSignal.value = msg;
  } finally {
    isSubmittingSignal.value = false;
  }
}

export function finishAndEnterTenant(): void {
  const res = provisionResultSignal.value;
  if (res) {
    setActiveTenant(res.tenantId);
  }
  closeOnboardingModal();
  resetOnboarding();
}
