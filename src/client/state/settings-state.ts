import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import type { BranchItem } from './stock-state.ts';
import { routeTab } from './route-state.ts';
import { branchesQuery } from './shared-queries.ts';
import { invalidateAfter } from './invalidation.ts';
import type { TabId } from '../routing/admin-routes.ts';

export type SettingsTab = TabId<'settings'>;
const SETTINGS_TABS: readonly SettingsTab[] = ['pos', 'branches', 'connection', 'account', 'appearance'];

// Pestaña activa: la de la URL (#59)
export const activeSettingsTabSignal = computed<SettingsTab>(() => routeTab('settings', SETTINGS_TABS, 'pos'));

// Sucursales: la consulta compartida con dashboard, stock y ventas (#59)
export const settingsBranchesSignal = computed<BranchItem[]>(() => branchesQuery.data.value ?? []);
export const branchesLoadingSignal = branchesQuery.isLoading;
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
  await branchesQuery.refetch();
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
      branchesQuery.setData((prev) => (prev ?? []).map((b) => (b.id === saved.id ? saved : b)));
      showToast({
        type: 'success',
        title: 'Sucursal Actualizada',
        message: `"${saved.name}" (${saved.code}) guardada`,
      });
    } else {
      branchesQuery.setData((prev) => [...(prev ?? []), saved]);
      showToast({
        type: 'success',
        title: 'Sucursal Creada',
        message: `"${saved.name}" (${saved.code}) dada de alta`,
      });
    }

    void invalidateAfter('branch-saved');
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
