import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import { createTenantParamQuery } from './query-keys.ts';
import { branchesQuery, categoriesQuery, stockMatrixQuery } from './shared-queries.ts';
import { routeFilters, setFilters } from './route-state.ts';
import { invalidateAfter } from './invalidation.ts';
import type { StockFilters } from '../routing/admin-routes.ts';

export type BranchItem = {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type StockMatrixItem = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  tracksStock: boolean;
  totalStock: number;
  branches: Record<string, number>;
  updatedAt: string;
};

export type KardexItem = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  branchId: string;
  branchName: string;
  delta: number;
  reason: string;
  notes: string | null;
  saleId: string | null;
  deviceId: string | null;
  originBranch: string | null;
  originPointOfSale: string | null;
  createdAt: string;
};

export type AdjustStockFormData = {
  productId: string;
  productName: string;
  sku: string;
  branchId: string;
  type: 'set' | 'delta';
  quantity: number;
  reason: string;
  notes: string;
};

// Datos: en la caché de TanStack Query, compartida con el catálogo (#59)
export const stockItemsSignal = computed<StockMatrixItem[]>(() => stockMatrixQuery.data.value ?? []);
export const stockBranchesSignal = computed<BranchItem[]>(() => branchesQuery.data.value ?? []);
export const stockCategoriesSignal = computed<string[]>(() => categoriesQuery.data.value ?? []);
export const stockLoadingSignal = stockMatrixQuery.isLoading;
export const stockErrorSignal = computed<string | null>(() => stockMatrixQuery.error.value?.message ?? null);

// Filtros: en la URL (#59)
export const stockFiltersSignal = computed<StockFilters>(() => routeFilters('stock'));
export const stockSearchSignal = computed(() => stockFiltersSignal.value.q);
export const stockCategoryFilterSignal = computed(() => stockFiltersSignal.value.category);
export const stockStatusFilterSignal = computed(() => stockFiltersSignal.value.level);
export const stockBranchFilterSignal = computed(() => stockFiltersSignal.value.branch);

export function setStockFilters(patch: Partial<StockFilters>): void {
  setFilters('stock', patch);
}

// Modal de Ajuste de Stock
export const adjustModalOpenSignal = signal<boolean>(false);
export const adjustFormSignal = signal<AdjustStockFormData>({
  productId: '',
  productName: '',
  sku: '',
  branchId: '',
  type: 'set',
  quantity: 0,
  reason: 'recuento_fisico',
  notes: '',
});
export const isAdjustingSignal = signal<boolean>(false);
export const adjustErrorSignal = signal<string | null>(null);

// Drawer de Kardex
export const kardexDrawerOpenSignal = signal<boolean>(false);
export const kardexTargetProductSignal = signal<StockMatrixItem | null>(null);
export const kardexReasonFilterSignal = signal<string>('all');

// Los movimientos se piden mientras el drawer está abierto, por producto
const kardexQuery = createTenantParamQuery<KardexItem[], readonly [string]>({
  domain: 'kardex',
  params: () => {
    const target = kardexTargetProductSignal.value;
    return kardexDrawerOpenSignal.value && target !== null ? [target.productId] : null;
  },
  onError: (err) => {
    showToast({ type: 'error', title: 'Error de Kardex', message: err.message });
  },
  fn: ({ tenantId, token, params: [productId] }) =>
    apiFetch<KardexItem[]>(`tenants/${tenantId}/stock/kardex?productId=${encodeURIComponent(productId)}&limit=100`, { token }),
});
export const kardexMovementsSignal = computed<KardexItem[]>(() => kardexQuery.data.value ?? []);
export const kardexLoadingSignal = kardexQuery.isLoading;

// Stock filtrado
export function filterStock(items: StockMatrixItem[], filters: StockFilters): StockMatrixItem[] {
  const search = filters.q.trim().toLowerCase();
  return items.filter((item) => {
    if (search) {
      const matchName = item.name.toLowerCase().includes(search);
      const matchSku = item.sku.toLowerCase().includes(search);
      if (!matchName && !matchSku) return false;
    }
    if (filters.category !== 'all' && item.category !== filters.category) return false;
    if (filters.level !== 'all') {
      if (!item.tracksStock) return false;
      const qty = filters.branch !== 'all' ? item.branches[filters.branch] ?? 0 : item.totalStock;
      if (filters.level === 'out' && qty > 0) return false;
      if (filters.level === 'low' && (qty <= 0 || qty > 5)) return false;
      if (filters.level === 'normal' && qty <= 5) return false;
    }
    return true;
  });
}

export const filteredStockSignal = computed<StockMatrixItem[]>(() => filterStock(stockItemsSignal.value, stockFiltersSignal.value));

/** El botón "Actualizar". */
export async function fetchStockData(): Promise<void> {
  await Promise.all([stockMatrixQuery.refetch(), branchesQuery.refetch(), categoriesQuery.refetch()]);
}

// Abrir modal de ajuste para un producto y sucursal opcional
export function openAdjustModal(product: StockMatrixItem, preferredBranchId?: string): void {
  const branches = stockBranchesSignal.value;
  const branchId = preferredBranchId ?? branches[0]?.id ?? 'CENTRAL';
  const currentBranchQty = product.branches[branchId] ?? 0;

  adjustFormSignal.value = {
    productId: product.productId,
    productName: product.name,
    sku: product.sku,
    branchId,
    type: 'set',
    quantity: currentBranchQty,
    reason: 'recuento_fisico',
    notes: '',
  };
  adjustErrorSignal.value = null;
  adjustModalOpenSignal.value = true;
}

export function closeAdjustModal(): void {
  adjustModalOpenSignal.value = false;
  adjustErrorSignal.value = null;
}

export async function submitStockAdjustment(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  const form = adjustFormSignal.value;
  if (!form.branchId) {
    adjustErrorSignal.value = 'Debes seleccionar una sucursal';
    return;
  }
  if (!form.reason.trim()) {
    adjustErrorSignal.value = 'Debes especificar el motivo del ajuste para la auditoría Kardex';
    return;
  }
  if (isNaN(form.quantity)) {
    adjustErrorSignal.value = 'La cantidad debe ser un número válido';
    return;
  }

  try {
    isAdjustingSignal.value = true;
    adjustErrorSignal.value = null;

    const res = await apiFetch<{
      productId: string;
      branchId: string;
      previousQuantity: number;
      delta: number;
      newQuantity: number;
      movementId: string;
    }>(`tenants/${tenantId}/stock/adjust`, {
      method: 'POST',
      body: {
        productId: form.productId,
        branchId: form.branchId,
        type: form.type,
        quantity: form.quantity,
        reason: form.reason,
        notes: form.notes.trim() || undefined,
      },
      token,
    });

    // Actualizar reactivamente la celda de la sucursal y el total consolidado en la matriz local
    stockMatrixQuery.setData((previous) => (previous ?? []).map((item) => {
      if (item.productId === form.productId) {
        const nextBranches = { ...item.branches, [form.branchId]: res.newQuantity };
        const nextTotal = Object.values(nextBranches).reduce((acc, q) => acc + q, 0);
        return {
          ...item,
          branches: nextBranches,
          totalStock: nextTotal,
        };
      }
      return item;
    }));

    showToast({
      type: 'success',
      title: 'Ajuste de Stock Asentado',
      message: `${form.productName}: nuevo stock de ${String(res.newQuantity)} un. en sucursal (delta: ${res.delta > 0 ? '+' : ''}${String(res.delta)})`,
    });

    void invalidateAfter('stock-adjusted');
    closeAdjustModal();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar ajuste de stock';
    adjustErrorSignal.value = msg;
  } finally {
    isAdjustingSignal.value = false;
  }
}

// Kardex Drawer
export function openKardex(product: StockMatrixItem): void {
  kardexTargetProductSignal.value = product;
  kardexReasonFilterSignal.value = 'all';
  kardexDrawerOpenSignal.value = true;
}

export function closeKardex(): void {
  kardexDrawerOpenSignal.value = false;
  kardexTargetProductSignal.value = null;
}
