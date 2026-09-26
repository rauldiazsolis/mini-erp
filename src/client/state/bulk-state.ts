import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';

export type BulkTab = 'prices' | 'interests' | 'io';
export type RoundingStrategy = 'none' | '10' | '50' | '100';

export type BulkPricePreviewItem = {
  id: string;
  sku: string;
  name: string;
  category: string;
  oldPrice: number;
  newPrice: number;
  diff: number;
};

export type BulkPriceResult = {
  dryRun: boolean;
  affectedCount: number;
  items: BulkPricePreviewItem[];
};

export type BulkInterestPreviewItem = {
  customerId: string;
  customerName: string;
  currentBalance: number;
  interestAmount: number;
  newBalance: number;
};

export type BulkInterestResult = {
  dryRun: boolean;
  affectedCount: number;
  totalInterestAmount: number;
  items: BulkInterestPreviewItem[];
};

export type ImportResult = {
  dryRun: boolean;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: Array<{ row: number; error: string; data?: unknown }>;
};

// Pestaña activa
export const activeBulkTabSignal = signal<BulkTab>('prices');

// Precios Masivos
export const bulkPriceActionSignal = signal<'percentage' | 'fixed'>('percentage');
export const bulkPriceValueSignal = signal<number>(15);
export const bulkPriceCategorySignal = signal<string>('all');
export const bulkPriceRoundingSignal = signal<RoundingStrategy>('10');
export const bulkPricePreviewSignal = signal<BulkPriceResult | null>(null);
export const bulkPriceLoadingSignal = signal<boolean>(false);

// Intereses Masivos
export const bulkInterestPercentSignal = signal<number>(5);
export const bulkInterestDescriptionSignal = signal<string>('Interés mensual por financiación');
export const bulkInterestMinBalanceSignal = signal<number>(1000);
export const bulkInterestPreviewSignal = signal<BulkInterestResult | null>(null);
export const bulkInterestLoadingSignal = signal<boolean>(false);

// Import / Export
export const ioSelectedEntitySignal = signal<'products' | 'customers' | 'stock'>('products');
export const ioFormatSignal = signal<'csv' | 'json'>('csv');
export const ioUpdateExistingSignal = signal<boolean>(true);
export const ioCsvContentSignal = signal<string>('');
export const ioImportPreviewSignal = signal<ImportResult | null>(null);
export const ioLoadingSignal = signal<boolean>(false);

// --- PRECIOS MASIVOS ---

export async function previewBulkPrices(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    bulkPriceLoadingSignal.value = true;
    const res = await apiFetch<BulkPriceResult>(`tenants/${tenantId}/bulk/prices`, {
      method: 'POST',
      body: {
        action: bulkPriceActionSignal.value,
        value: bulkPriceValueSignal.value,
        category: bulkPriceCategorySignal.value === 'all' ? undefined : bulkPriceCategorySignal.value,
        rounding: bulkPriceRoundingSignal.value,
        dryRun: true,
      },
      token,
    });
    bulkPricePreviewSignal.value = res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al simular aumento de precios';
    showToast({ type: 'error', title: 'Error de simulación', message: msg });
  } finally {
    bulkPriceLoadingSignal.value = false;
  }
}

export async function applyBulkPrices(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    bulkPriceLoadingSignal.value = true;
    const res = await apiFetch<BulkPriceResult>(`tenants/${tenantId}/bulk/prices`, {
      method: 'POST',
      body: {
        action: bulkPriceActionSignal.value,
        value: bulkPriceValueSignal.value,
        category: bulkPriceCategorySignal.value === 'all' ? undefined : bulkPriceCategorySignal.value,
        rounding: bulkPriceRoundingSignal.value,
        dryRun: false,
      },
      token,
    });
    bulkPricePreviewSignal.value = res;
    showToast({
      type: 'success',
      title: 'Precios Actualizados',
      message: `Se actualizaron ${String(res.affectedCount)} productos en catálogo`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al aplicar aumento de precios';
    showToast({ type: 'error', title: 'Error', message: msg });
  } finally {
    bulkPriceLoadingSignal.value = false;
  }
}

// --- INTERESES DEUDORES ---

export async function previewBulkInterests(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    bulkInterestLoadingSignal.value = true;
    const res = await apiFetch<BulkInterestResult>(`tenants/${tenantId}/bulk/interests`, {
      method: 'POST',
      body: {
        interestRatePercent: bulkInterestPercentSignal.value,
        description: bulkInterestDescriptionSignal.value.trim() || 'Interés mensual en cuenta corriente',
        minimumBalance: bulkInterestMinBalanceSignal.value,
        dryRun: true,
      },
      token,
    });
    bulkInterestPreviewSignal.value = res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al simular cálculo de intereses';
    showToast({ type: 'error', title: 'Error de simulación', message: msg });
  } finally {
    bulkInterestLoadingSignal.value = false;
  }
}

export async function applyBulkInterests(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    bulkInterestLoadingSignal.value = true;
    const res = await apiFetch<BulkInterestResult>(`tenants/${tenantId}/bulk/interests`, {
      method: 'POST',
      body: {
        interestRatePercent: bulkInterestPercentSignal.value,
        description: bulkInterestDescriptionSignal.value.trim() || 'Interés mensual en cuenta corriente',
        minimumBalance: bulkInterestMinBalanceSignal.value,
        dryRun: false,
      },
      token,
    });
    bulkInterestPreviewSignal.value = res;
    showToast({
      type: 'success',
      title: 'Intereses Devengados',
      message: `Asentados $${String(res.totalInterestAmount)} en ${String(res.affectedCount)} cuentas deudoras`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al devengar intereses';
    showToast({ type: 'error', title: 'Error', message: msg });
  } finally {
    bulkInterestLoadingSignal.value = false;
  }
}

// --- IMPORTACIÓN / EXPORTACIÓN ---

export async function downloadExport(entity: 'products' | 'customers' | 'stock', format: 'csv' | 'json'): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    ioLoadingSignal.value = true;
    const res = await fetch(`/api/tenants/${tenantId}/export/${entity}?format=${format}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${String(res.status)}: ${res.statusText}`);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entity}-${tenantId}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    showToast({
      type: 'success',
      title: 'Exportación Descargada',
      message: `Archivo ${entity}.${format} generado con éxito`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al descargar exportación';
    showToast({ type: 'error', title: 'Error de exportación', message: msg });
  } finally {
    ioLoadingSignal.value = false;
  }
}

export async function previewImport(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  const content = ioCsvContentSignal.value.trim();
  const entity = ioSelectedEntitySignal.value;
  if (!tenantId || !token || !content) return;

  if (entity === 'stock') {
    showToast({ type: 'info', title: 'Aviso', message: 'La importación directa está disponible para productos y clientes' });
    return;
  }

  try {
    ioLoadingSignal.value = true;
    const res = await apiFetch<ImportResult>(`tenants/${tenantId}/import/${entity}`, {
      method: 'POST',
      body: {
        csv: content,
        updateExisting: ioUpdateExistingSignal.value,
        dryRun: true,
      },
      token,
    });
    ioImportPreviewSignal.value = res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al simular importación';
    showToast({ type: 'error', title: 'Error en importación', message: msg });
  } finally {
    ioLoadingSignal.value = false;
  }
}

export async function applyImport(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  const content = ioCsvContentSignal.value.trim();
  const entity = ioSelectedEntitySignal.value;
  if (!tenantId || !token || !content) return;

  try {
    ioLoadingSignal.value = true;
    const res = await apiFetch<ImportResult>(`tenants/${tenantId}/import/${entity}`, {
      method: 'POST',
      body: {
        csv: content,
        updateExisting: ioUpdateExistingSignal.value,
        dryRun: false,
      },
      token,
    });
    ioImportPreviewSignal.value = res;
    showToast({
      type: 'success',
      title: 'Importación Completada',
      message: `Importados: ${String(res.importedCount)}, Actualizados: ${String(res.updatedCount)}, Omitidos: ${String(res.skippedCount)}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al aplicar importación';
    showToast({ type: 'error', title: 'Error', message: msg });
  } finally {
    ioLoadingSignal.value = false;
  }
}
