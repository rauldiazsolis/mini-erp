import { canDo } from './permissions-state.ts';
import { computed, signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { effectiveTenantIdSignal, tokenSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import { createTenantQuery } from './query-keys.ts';
import { inSection } from './route-state.ts';
import { invalidateAfter } from './invalidation.ts';

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

// Sin la lista, la franja no aparece: un error de carga no se muestra
const discrepanciesQuery = createTenantQuery<DiscrepancyItem[]>({
  domain: 'discrepancies',
  // Una caja desde el POS (M10) no las ve
  enabled: () => inSection('customers') && canDo('tenant.use'),
  fn: ({ tenantId, token }) => apiFetch<DiscrepancyItem[]>(`tenants/${tenantId}/discrepancies`, { token }),
});

/** Discrepancias abiertas del comercio (#2): franja y panel en Clientes. */
export const discrepanciesSignal = computed<DiscrepancyItem[]>(() => discrepanciesQuery.data.value ?? []);
export const discrepancyDrawerOpenSignal = signal(false);
export const dismissingIdSignal = signal<string | null>(null);
export const dismissNoteSignal = signal('');

export async function fetchDiscrepancies(): Promise<void> {
  await discrepanciesQuery.refetch();
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
    await invalidateAfter('discrepancy-dismissed');
    if (discrepanciesSignal.value.length === 0) {
      discrepancyDrawerOpenSignal.value = false;
    }
    showToast({ type: 'success', title: 'Discrepancia descartada', message: 'Ya no aparece en la caja.' });
  } catch (err: unknown) {
    showToast({ type: 'error', title: 'No se pudo descartar', message: err instanceof Error ? err.message : 'Error inesperado' });
  }
}
