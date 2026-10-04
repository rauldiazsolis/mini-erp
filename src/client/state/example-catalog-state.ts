import { computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import { inSection } from './route-state.ts';
import { createTenantQuery } from './query-keys.ts';
import { invalidateAfter } from './invalidation.ts';
import { activeBulkTabSignal } from './bulk-state.ts';
import { importStepSignal } from './import-state.ts';
import type { BusinessType } from '../../shared/business-type.ts';

export type ExampleCatalogStatus = { businessType: BusinessType | null; available: boolean };

/**
 * El catálogo de ejemplo del rubro en Operaciones masivas (#22): para quien cerró el alta antes de
 * cargar datos. Se ofrece mientras el comercio tenga rubro con ejemplo y ningún producto.
 */
const exampleQuery = createTenantQuery<ExampleCatalogStatus | null>({
  domain: 'example-catalog',
  // En Masivas → Importar / Exportar; mientras se mapea un archivo no cambia nada
  enabled: () => inSection('bulk') && activeBulkTabSignal.value === 'io' && importStepSignal.value !== 'mapping',
  // Si la consulta falla, no se ofrece nada
  fn: ({ tenantId, token }) => apiFetch<ExampleCatalogStatus>(`tenants/${tenantId}/catalog/example`, { token }).catch(() => null),
});

export const exampleCatalogSignal = computed<ExampleCatalogStatus | null>(() => exampleQuery.data.value ?? null);

export async function fetchExampleCatalog(): Promise<void> {
  await exampleQuery.refetch();
}

/** Carga el catálogo de ejemplo; devuelve cuántos productos creó, o `null` si falló. */
export async function applyExampleCatalog(): Promise<number | null> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return null;
  try {
    const res = await apiFetch<{ productsCreated: number }>(`tenants/${tenantId}/catalog/example`, { method: 'POST', token });
    exampleQuery.setData((prev) => ({ businessType: prev?.businessType ?? null, available: false }));
    void invalidateAfter('products-imported');
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
