import { effect, signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import { activeViewSignal } from './navigation-state.ts';
import { activeBulkTabSignal } from './bulk-state.ts';
import { importStepSignal } from './import-state.ts';
import type { BusinessType } from '../../shared/business-type.ts';

export type ExampleCatalogStatus = { businessType: BusinessType | null; available: boolean };

/**
 * El catálogo de ejemplo del rubro en Operaciones masivas (#22): para quien cerró el alta antes de
 * cargar datos. Se ofrece mientras el comercio tenga rubro con ejemplo y ningún producto.
 */
export const exampleCatalogSignal = signal<ExampleCatalogStatus | null>(null);

export async function fetchExampleCatalog(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;
  try {
    exampleCatalogSignal.value = await apiFetch<ExampleCatalogStatus>(`tenants/${tenantId}/catalog/example`, { token });
  } catch {
    exampleCatalogSignal.value = null;
  }
}

/** Carga el catálogo de ejemplo; devuelve cuántos productos creó, o `null` si falló. */
export async function applyExampleCatalog(): Promise<number | null> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return null;
  try {
    const res = await apiFetch<{ productsCreated: number }>(`tenants/${tenantId}/catalog/example`, { method: 'POST', token });
    exampleCatalogSignal.value = { businessType: exampleCatalogSignal.value?.businessType ?? null, available: false };
    showToast({ type: 'success', title: 'Catálogo de ejemplo', message: `Se cargaron ${String(res.productsCreated)} productos` });
    return res.productsCreated;
  } catch (err: unknown) {
    showToast({
      type: 'error',
      title: 'Error',
      message: err instanceof Error ? err.message : 'No se pudo cargar el catálogo de ejemplo',
    });
    return null;
  }
}

if (typeof window !== 'undefined') {
  // Se consulta al entrar a Operaciones masivas → Importar / Exportar, y después de cada importación
  effect(() => {
    // Mientras se mapea un archivo no cambia nada; al terminar, quizás ya hay productos
    const mapping = importStepSignal.value === 'mapping';
    const onImportTab = activeViewSignal.value === 'bulk' && activeBulkTabSignal.value === 'io';
    if (!mapping && onImportTab && effectiveTenantIdSignal.value && tokenSignal.value) {
      void fetchExampleCatalog();
    }
  });
}
