import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';

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

// Señales principales
export const stockItemsSignal = signal<StockMatrixItem[]>([]);
export const stockBranchesSignal = signal<BranchItem[]>([]);
export const stockCategoriesSignal = signal<string[]>([]);
export const stockLoadingSignal = signal<boolean>(false);
export const stockErrorSignal = signal<string | null>(null);

// Filtros
export const stockSearchSignal = signal<string>('');
export const stockCategoryFilterSignal = signal<string>('all');
export const stockStatusFilterSignal = signal<'all' | 'out' | 'low' | 'normal'>('all');
export const stockBranchFilterSignal = signal<string>('all');

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
export const kardexMovementsSignal = signal<KardexItem[]>([]);
export const kardexLoadingSignal = signal<boolean>(false);
export const kardexReasonFilterSignal = signal<string>('all');

// Computada de Stock Filtrado
export const filteredStockSignal = computed<StockMatrixItem[]>(() => {
  const search = stockSearchSignal.value.trim().toLowerCase();
  const category = stockCategoryFilterSignal.value;
  const status = stockStatusFilterSignal.value;
  const branchFilter = stockBranchFilterSignal.value;

  return stockItemsSignal.value.filter((item) => {
    // Búsqueda
    if (search) {
      const matchName = item.name.toLowerCase().includes(search);
      const matchSku = item.sku.toLowerCase().includes(search);
      if (!matchName && !matchSku) return false;
    }

    // Categoría
    if (category !== 'all' && item.category !== category) {
      return false;
    }

    // Nivel / Estado de stock
    if (status !== 'all') {
      if (!item.tracksStock) return false;
      const qty = branchFilter !== 'all' ? item.branches[branchFilter] ?? 0 : item.totalStock;
      if (status === 'out' && qty > 0) return false;
      if (status === 'low' && (qty <= 0 || qty > 5)) return false;
      if (status === 'normal' && qty <= 5) return false;
    }

    return true;
  });
});

export async function fetchStockData(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    stockLoadingSignal.value = true;
    stockErrorSignal.value = null;

    const [matrix, branches, categories] = await Promise.all([
      apiFetch<StockMatrixItem[]>(`tenants/${tenantId}/stock`, { token }),
      apiFetch<BranchItem[]>(`tenants/${tenantId}/branches`, { token }),
      apiFetch<string[]>(`tenants/${tenantId}/categories`, { token }).catch(() => []),
    ]);

    stockItemsSignal.value = matrix;
    stockBranchesSignal.value = branches;
    stockCategoriesSignal.value = categories;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al cargar matriz de stock';
    stockErrorSignal.value = msg;
    showToast({ type: 'error', title: 'Error de stock', message: msg });
  } finally {
    stockLoadingSignal.value = false;
  }
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
    stockItemsSignal.value = stockItemsSignal.value.map((item) => {
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
    });

    showToast({
      type: 'success',
      title: 'Ajuste de Stock Asentado',
      message: `${form.productName}: nuevo stock de ${res.newQuantity} un. en sucursal (delta: ${res.delta > 0 ? '+' : ''}${res.delta})`,
    });

    closeAdjustModal();

    // Si el drawer de Kardex está abierto para este producto, refrescar movimientos
    if (kardexDrawerOpenSignal.value && kardexTargetProductSignal.value?.productId === form.productId) {
      loadKardexMovements(form.productId);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar ajuste de stock';
    adjustErrorSignal.value = msg;
  } finally {
    isAdjustingSignal.value = false;
  }
}

// Kardex Drawer
export async function openKardex(product: StockMatrixItem): Promise<void> {
  kardexTargetProductSignal.value = product;
  kardexReasonFilterSignal.value = 'all';
  kardexDrawerOpenSignal.value = true;
  await loadKardexMovements(product.productId);
}

export function closeKardex(): void {
  kardexDrawerOpenSignal.value = false;
  kardexTargetProductSignal.value = null;
  kardexMovementsSignal.value = [];
}

export async function loadKardexMovements(productId: string): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    kardexLoadingSignal.value = true;
    const movements = await apiFetch<KardexItem[]>(`tenants/${tenantId}/stock/kardex?productId=${encodeURIComponent(productId)}&limit=100`, {
      token,
    });
    kardexMovementsSignal.value = movements;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al cargar Kardex';
    showToast({ type: 'error', title: 'Error de Kardex', message: msg });
  } finally {
    kardexLoadingSignal.value = false;
  }
}
