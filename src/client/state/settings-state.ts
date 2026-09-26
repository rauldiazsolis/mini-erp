import { signal, effect } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import type { BranchItem } from './stock-state.ts';

export type SettingsTab = 'pos' | 'branches' | 'connection' | 'appearance';


export type PosApiKeyItem = {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  branch: string;
  pointOfSale: string;
  active: boolean;
  createdAt: string;
};

export type CreatedSecretKey = {
  id: string;
  rawKey: string;
  name: string;
  branch: string;
  pointOfSale: string;
};

// Pestaña activa
export const activeSettingsTabSignal = signal<SettingsTab>('pos');

// API Keys
export const apiKeysSignal = signal<PosApiKeyItem[]>([]);
export const apiKeysLoadingSignal = signal<boolean>(false);
export const createKeyModalOpenSignal = signal<boolean>(false);
export const createKeyFormSignal = signal<{
  name: string;
  branch: string;
  pointOfSale: string;
}>({
  name: 'Caja Principal',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 1',
});
export const isCreatingKeySignal = signal<boolean>(false);
export const createKeyErrorSignal = signal<string | null>(null);
export const createdSecretKeySignal = signal<CreatedSecretKey | null>(null);

// Sucursales
export const settingsBranchesSignal = signal<BranchItem[]>([]);
export const branchesLoadingSignal = signal<boolean>(false);
export const branchModalOpenSignal = signal<boolean>(false);
export const editingBranchSignal = signal<BranchItem | null>(null);
export const branchFormSignal = signal<{
  name: string;
  code: string;
}>({
  name: '',
  code: '',
});
export const isSavingBranchSignal = signal<boolean>(false);
export const branchFormErrorSignal = signal<string | null>(null);

// Conexión Connector Info
export const connectorInfoSignal = signal<{
  version: string;
  status: string;
  checkedAt: string;
} | null>(null);
export const connectorCheckingSignal = signal<boolean>(false);

// --- API KEYS ---

export async function fetchApiKeys(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    apiKeysLoadingSignal.value = true;
    const keys = await apiFetch<PosApiKeyItem[]>(`tenants/${tenantId}/api-keys`, { token });
    apiKeysSignal.value = keys;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al cargar API Keys';
    showToast({ type: 'error', title: 'Error de terminales POS', message: msg });
  } finally {
    apiKeysLoadingSignal.value = false;
  }
}

export function openCreateKeyModal(): void {
  const branches = settingsBranchesSignal.value;
  const defaultBranchCode = branches[0]?.code ?? 'CENTRAL';

  createKeyFormSignal.value = {
    name: `Caja ${String(apiKeysSignal.value.length + 1)}`,
    branch: defaultBranchCode,
    pointOfSale: `Caja ${String(apiKeysSignal.value.length + 1)}`,
  };
  createKeyErrorSignal.value = null;
  createKeyModalOpenSignal.value = true;
}

export function closeCreateKeyModal(): void {
  createKeyModalOpenSignal.value = false;
  createKeyErrorSignal.value = null;
}

export async function submitCreateApiKey(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  const form = createKeyFormSignal.value;
  if (!form.name.trim() || !form.branch.trim() || !form.pointOfSale.trim()) {
    createKeyErrorSignal.value = 'Completa todos los campos obligatorios';
    return;
  }

  try {
    isCreatingKeySignal.value = true;
    createKeyErrorSignal.value = null;

    const res = await apiFetch<{
      id: string;
      rawKey?: string;
      key?: string;
      keyPrefix: string;
    }>(`tenants/${tenantId}/api-keys`, {
      method: 'POST',
      body: {
        name: form.name.trim(),
        branch: form.branch.trim().toUpperCase(),
        pointOfSale: form.pointOfSale.trim(),
      },
      token,
    });

    const secretKey = res.rawKey ?? res.key ?? '';
    createdSecretKeySignal.value = {
      id: res.id,
      rawKey: secretKey,
      name: form.name,
      branch: form.branch.toUpperCase(),
      pointOfSale: form.pointOfSale,
    };

    closeCreateKeyModal();
    await fetchApiKeys();

    showToast({
      type: 'success',
      title: 'API Key Generada',
      message: `Nueva credencial creada para "${form.name}"`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al generar API Key';
    createKeyErrorSignal.value = msg;
  } finally {
    isCreatingKeySignal.value = false;
  }
}

export function dismissSecretKeyModal(): void {
  createdSecretKeySignal.value = null;
}

export async function revokeApiKey(keyId: string, name: string): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  const confirmed = typeof window !== 'undefined' ? window.confirm(`¿Estás seguro de revocar la llave de "${name}"? El POS perderá la sincronización hasta recibir una nueva clave.`) : true;
  if (!confirmed) return;

  try {
    await apiFetch(`tenants/${tenantId}/api-keys/${keyId}`, {
      method: 'DELETE',
      token,
    });

    apiKeysSignal.value = apiKeysSignal.value.filter((k) => k.id !== keyId);
    showToast({
      type: 'warning',
      title: 'API Key Revocada',
      message: `La llave de "${name}" fue desactivada`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al revocar API Key';
    showToast({ type: 'error', title: 'Error', message: msg });
  }
}

// --- SUCURSALES ---

export async function fetchSettingsBranches(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    branchesLoadingSignal.value = true;
    const branches = await apiFetch<BranchItem[]>(`tenants/${tenantId}/branches`, { token });
    settingsBranchesSignal.value = branches;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al cargar sucursales';
    showToast({ type: 'error', title: 'Error', message: msg });
  } finally {
    branchesLoadingSignal.value = false;
  }
}

export function openNewBranchModal(): void {
  editingBranchSignal.value = null;
  branchFormSignal.value = {
    name: '',
    code: '',
  };
  branchFormErrorSignal.value = null;
  branchModalOpenSignal.value = true;
}

export function openEditBranchModal(branch: BranchItem): void {
  editingBranchSignal.value = branch;
  branchFormSignal.value = {
    name: branch.name,
    code: branch.code,
  };
  branchFormErrorSignal.value = null;
  branchModalOpenSignal.value = true;
}

export function closeBranchModal(): void {
  branchModalOpenSignal.value = false;
  editingBranchSignal.value = null;
  branchFormErrorSignal.value = null;
}

export async function submitBranchForm(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  const form = branchFormSignal.value;
  if (!form.name.trim() || !form.code.trim()) {
    branchFormErrorSignal.value = 'El nombre y código son requeridos';
    return;
  }

  try {
    isSavingBranchSignal.value = true;
    branchFormErrorSignal.value = null;

    const currentBranch = editingBranchSignal.value;
    const isEdit = Boolean(currentBranch);
    const endpoint = isEdit && currentBranch
      ? `tenants/${tenantId}/branches/${currentBranch.id}`
      : `tenants/${tenantId}/branches`;

    const saved = await apiFetch<BranchItem>(endpoint, {
      method: isEdit ? 'PUT' : 'POST',
      body: {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
      },
      token,
    });

    if (isEdit) {
      settingsBranchesSignal.value = settingsBranchesSignal.value.map((b) => (b.id === saved.id ? saved : b));
      showToast({
        type: 'success',
        title: 'Sucursal Actualizada',
        message: `"${saved.name}" (${saved.code}) guardada`,
      });
    } else {
      settingsBranchesSignal.value = [...settingsBranchesSignal.value, saved];
      showToast({
        type: 'success',
        title: 'Sucursal Creada',
        message: `"${saved.name}" (${saved.code}) dada de alta`,
      });
    }

    closeBranchModal();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al guardar sucursal';
    branchFormErrorSignal.value = msg;
  } finally {
    isSavingBranchSignal.value = false;
  }
}

// --- CONNECTOR INFO ---

export async function checkConnectorStatus(): Promise<void> {
  try {
    connectorCheckingSignal.value = true;
    const res = await fetch('/connector/info');
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    const data = (await res.json()) as { version: string; status: string };

    connectorInfoSignal.value = {
      version: data.version,
      status: data.status,
      checkedAt: new Date().toLocaleTimeString('es-AR'),
    };
    showToast({
      type: 'info',
      title: 'Connector En Línea',
      message: `Contrato ${data.version} - Estado: ${data.status}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error conectando con endpoint /connector/info';
    showToast({ type: 'error', title: 'Connector Offline', message: msg });
  } finally {
    connectorCheckingSignal.value = false;
  }
}

// Auto-cargar configuración de sucursales y llaves al cambiar tenant
if (typeof window !== 'undefined') {
  effect(() => {
    const tenantId = effectiveTenantIdSignal.value;
    const token = tokenSignal.value;
    if (tenantId && token) {
      void fetchApiKeys();
      void fetchSettingsBranches();
    }
  });
}
