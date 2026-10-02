import { effect, signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { effectiveTenantIdSignal, tokenSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';

export type DiscrepancyItem = {
  id: string;
  kind: string;
  message: string;
  customerId: string;
  refType: 'sale' | 'customer-payment';
  refId: string;
  amount: number;
  originBranch: string | null;
  originPos: string | null;
  deviceId: string | null;
  createdAt: string;
};

/** Discrepancias abiertas del comercio (#2): franja y panel en Clientes. */
export const discrepanciesSignal = signal<DiscrepancyItem[]>([]);
export const discrepancyDrawerOpenSignal = signal(false);
export const dismissingIdSignal = signal<string | null>(null);
export const dismissNoteSignal = signal('');

export async function fetchDiscrepancies(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;
  try {
    discrepanciesSignal.value = await apiFetch<DiscrepancyItem[]>(`tenants/${tenantId}/discrepancies`, { token });
  } catch {
    // Sin la lista, la franja no aparece: no es un error para mostrar
  }
}

export function openDiscrepancies(): void {
  dismissingIdSignal.value = null;
  dismissNoteSignal.value = '';
  discrepancyDrawerOpenSignal.value = true;
}

export function closeDiscrepancies(): void {
  discrepancyDrawerOpenSignal.value = false;
}

export function startDismiss(id: string): void {
  dismissingIdSignal.value = id;
  dismissNoteSignal.value = '';
}

export async function dismissDiscrepancy(id: string): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;
  try {
    await apiFetch(`tenants/${tenantId}/discrepancies/${id}/dismiss`, { method: 'POST', token, body: { note: dismissNoteSignal.value } });
    dismissingIdSignal.value = null;
    await fetchDiscrepancies();
    if (discrepanciesSignal.value.length === 0) {
      discrepancyDrawerOpenSignal.value = false;
    }
    showToast({ type: 'success', title: 'Discrepancia descartada', message: 'Ya no aparece en la caja.' });
  } catch (err: unknown) {
    showToast({ type: 'error', title: 'No se pudo descartar', message: err instanceof Error ? err.message : 'Error inesperado' });
  }
}

if (typeof window !== 'undefined') {
  effect(() => {
    if (effectiveTenantIdSignal.value && tokenSignal.value) {
      void fetchDiscrepancies();
    }
  });
}
