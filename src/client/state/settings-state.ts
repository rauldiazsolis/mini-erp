import { signal, computed, effect } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal, activeTenantSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import type { BranchItem } from './stock-state.ts';
import { routeTab } from './route-state.ts';
import type { TabId } from '../routing/admin-routes.ts';

export type SettingsTab = TabId<'settings'>;
const SETTINGS_TABS: readonly SettingsTab[] = ['pos', 'branches', 'connection', 'account', 'appearance'];

// Pestaña activa: la de la URL (#59)
export const activeSettingsTabSignal = computed<SettingsTab>(() => routeTab('settings', SETTINGS_TABS, 'pos'));

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
      checkedAt: new Date().toISOString(),
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

// Auto-cargar las sucursales al cambiar de comercio
if (typeof window !== 'undefined') {
  effect(() => {
    const tenantId = effectiveTenantIdSignal.value;
    const token = tokenSignal.value;
    const tenant = activeTenantSignal.value;
    if (tenantId && token && tenant !== null) {
      // Las sucursales las ve cualquiera; las cajas cargan en registers-state (#21)
      void fetchSettingsBranches();
    }
  });
}
