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

export const stepSignal = signal<number>(1);
export const nameSignal = signal<string>('');
export const slugSignal = signal<string>('');
export const tenantIdSignal = signal<string>('');
export const selectedPresetSignal = signal<BusinessPreset>('kiosco');
export const branchNameSignal = signal<string>('Casa Central');
export const branchCodeSignal = signal<string>('CENTRAL');
export const posNameSignal = signal<string>('Caja 1');
export const isSubmittingSignal = signal<boolean>(false);
export const errorMessageSignal = signal<string | null>(null);
export const provisionResultSignal = signal<ProvisionResult | null>(null);

export function generateSlug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function setName(val: string): void {
  nameSignal.value = val;
  const generated = generateSlug(val);
  slugSignal.value = generated;
  tenantIdSignal.value = generated;
  errorMessageSignal.value = null;
}

export function resetOnboarding(): void {
  stepSignal.value = 1;
  nameSignal.value = '';
  slugSignal.value = '';
  tenantIdSignal.value = '';
  selectedPresetSignal.value = 'kiosco';
  branchNameSignal.value = 'Casa Central';
  branchCodeSignal.value = 'CENTRAL';
  posNameSignal.value = 'Caja 1';
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
    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(slugSignal.value)) {
      errorMessageSignal.value = 'El slug solo puede contener minúsculas, números y guiones';
      return;
    }
    if (!slugRegex.test(tenantIdSignal.value)) {
      errorMessageSignal.value = 'El identificador solo puede contener minúsculas, números y guiones';
      return;
    }
    stepSignal.value = 2;
    return;
  }

  if (stepSignal.value === 2) {
    stepSignal.value = 3;
    return;
  }

  if (stepSignal.value === 3) {
    if (!branchNameSignal.value.trim() || !branchCodeSignal.value.trim() || !posNameSignal.value.trim()) {
      errorMessageSignal.value = 'Completa los datos de la sucursal inicial y terminal';
      return;
    }
    void submitOnboarding();
  }
}

export function prevStep(): void {
  errorMessageSignal.value = null;
  if (stepSignal.value > 1 && stepSignal.value < 4) {
    stepSignal.value--;
  }
}

export async function submitOnboarding(): Promise<void> {
  const token = tokenSignal.value;
  if (!token) {
    errorMessageSignal.value = 'Debes estar autenticado para crear un comercio';
    return;
  }

  try {
    isSubmittingSignal.value = true;
    errorMessageSignal.value = null;

    const id = tenantIdSignal.value.trim();
    const slug = slugSignal.value.trim();
    const name = nameSignal.value.trim();
    const preset = selectedPresetSignal.value;
    const branchCode = branchCodeSignal.value.trim().toUpperCase();
    const posName = posNameSignal.value.trim();

    // 1. Crear el Tenant
    await apiFetch('tenants', {
      method: 'POST',
      body: {
        id,
        slug,
        name,
        seedDemoData: false,
      },
      token,
    });

    // 2. Si se eligió un preset comercial, poblar catálogo y stock semilla
    if (preset !== 'empty') {
      try {
        await apiFetch(`tenants/${id}/seed-preset`, {
          method: 'POST',
          body: { preset },
          token,
        });
      } catch (err: unknown) {
        console.warn('Aviso al poblar preset:', err);
      }
    }

    // 3. Generar la primera API Key para el POS
    const keyRes = await apiFetch<{
      id: string;
      key: string;
      branch: string;
      pointOfSale: string;
    }>(`tenants/${id}/api-keys`, {
      method: 'POST',
      body: {
        name: posName,
        branch: branchCode,
        pointOfSale: posName,
      },
      token,
    });

    // 4. Actualizar lista de tenants del usuario
    await fetchProfile();

    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4100';
    const connectorUrl = `${origin}/connector`;
    const apiKey = keyRes.key || (keyRes as unknown as { rawKey?: string }).rawKey || '';

    provisionResultSignal.value = {
      tenantId: id,
      name,
      apiKey,
      branch: branchCode,
      pointOfSale: posName,
      connectorUrl,
    };

    stepSignal.value = 4;
    showToast({
      type: 'success',
      title: '¡Comercio Creado!',
      message: `"${name}" fue aprovisionado con éxito`,
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
