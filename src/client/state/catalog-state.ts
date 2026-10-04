import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import { createTenantQuery } from './query-keys.ts';
import { categoriesQuery, stockMatrixQuery } from './shared-queries.ts';
import { inSection, routeFilters, setFilters } from './route-state.ts';
import { invalidateAfter } from './invalidation.ts';
import type { CatalogFilters } from '../routing/admin-routes.ts';

export type ProductItem = {
  id: string;
  sku: string;
  barcodes: string[];
  name: string;
  price: number;
  taxRate: number;
  category: string;
  tracksStock: boolean;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductFormData = {
  id?: string;
  sku: string;
  barcodes: string[];
  name: string;
  price: number;
  taxRate: number;
  category: string;
  tracksStock: boolean;
  blockedReason?: string | null;
};

// Datos del catálogo: en la caché de TanStack Query (#59)
const productsQuery = createTenantQuery<ProductItem[]>({
  domain: 'products',
  enabled: () => inSection('catalog'),
  onError: (err) => {
    showToast({ type: 'error', title: 'Error de catálogo', message: err.message });
  },
  fn: ({ tenantId, token }) => apiFetch<ProductItem[]>(`tenants/${tenantId}/products`, { token }),
});

export const productsSignal = computed<ProductItem[]>(() => productsQuery.data.value ?? []);
export const categoriesSignal = computed<string[]>(() => categoriesQuery.data.value ?? []);
export const stockMapSignal = computed<Record<string, number>>(() =>
  Object.fromEntries((stockMatrixQuery.data.value ?? []).map((item) => [item.productId, item.totalStock])),
);
export const catalogLoadingSignal = productsQuery.isLoading;
export const catalogErrorSignal = computed<string | null>(() => productsQuery.error.value?.message ?? null);

// Filtros: en la URL (#59)
export const catalogFiltersSignal = computed<CatalogFilters>(() => routeFilters('catalog'));
export const catalogSearchSignal = computed(() => catalogFiltersSignal.value.q);
export const catalogCategoryFilterSignal = computed(() => catalogFiltersSignal.value.category);
export const catalogBlockedFilterSignal = computed(() => catalogFiltersSignal.value.blocked);

export function setCatalogFilters(patch: Partial<CatalogFilters>): void {
  setFilters('catalog', patch);
}

function setProducts(update: (list: ProductItem[]) => ProductItem[]): void {
  productsQuery.setData((previous) => update(previous ?? []));
}

// Señales de edición inline tipo Excel/Sheets
export const inlineEditingSignal = signal<{
  productId: string;
  field: 'name' | 'price' | 'category' | 'sku';
  value: string;
} | null>(null);

// Señales del modal de alta/edición
export const productModalOpenSignal = signal<boolean>(false);
export const editingProductSignal = signal<ProductItem | null>(null);
export const productFormDataSignal = signal<ProductFormData>({
  sku: '',
  barcodes: [],
  name: '',
  price: 0,
  taxRate: 0.21,
  category: 'General',
  tracksStock: true,
});
export const isSavingProductSignal = signal<boolean>(false);
export const productFormErrorSignal = signal<string | null>(null);

// Señales de modal de bloqueo
export const blockModalOpenSignal = signal<boolean>(false);
export const targetProductToBlockSignal = signal<ProductItem | null>(null);
export const blockReasonSignal = signal<string>('');

// Productos filtrados
export function filterProducts(products: ProductItem[], filters: CatalogFilters): ProductItem[] {
  const search = filters.q.trim().toLowerCase();
  return products.filter((p) => {
    if (search) {
      const matchName = p.name.toLowerCase().includes(search);
      const matchSku = p.sku.toLowerCase().includes(search);
      const matchBarcode = p.barcodes.some((b) => b.toLowerCase().includes(search));
      if (!matchName && !matchSku && !matchBarcode) return false;
    }
    if (filters.category !== 'all' && p.category !== filters.category) return false;
    if (filters.blocked === 'active' && p.blockedReason !== null) return false;
    if (filters.blocked === 'blocked' && p.blockedReason === null) return false;
    return true;
  });
}

export const filteredProductsSignal = computed<ProductItem[]>(() => filterProducts(productsSignal.value, catalogFiltersSignal.value));

/** El botón "Actualizar". */
export async function fetchCatalog(): Promise<void> {
  await Promise.all([productsQuery.refetch(), categoriesQuery.refetch(), stockMatrixQuery.refetch()]);
}

// Edición Inline tipo hoja de cálculo
export function startInlineEdit(productId: string, field: 'name' | 'price' | 'category' | 'sku', initialValue: string): void {
  inlineEditingSignal.value = {
    productId,
    field,
    value: initialValue,
  };
}

export function cancelInlineEdit(): void {
  inlineEditingSignal.value = null;
}

export async function saveInlineEdit(productId: string, field: 'name' | 'price' | 'category' | 'sku', rawValue: string): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  const currentProduct = productsSignal.value.find((p) => p.id === productId);
  if (!currentProduct) return;

  let updatePayload: Partial<ProductFormData> = {};
  if (field === 'price') {
    const num = parseFloat(rawValue.replace(',', '.'));
    if (isNaN(num) || num < 0) {
      showToast({ type: 'error', title: 'Valor inválido', message: 'El precio debe ser un número mayor o igual a 0' });
      cancelInlineEdit();
      return;
    }
    if (currentProduct.price === num) {
      cancelInlineEdit();
      return;
    }
    updatePayload = { price: num };
  } else if (field === 'name') {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      showToast({ type: 'error', title: 'Valor inválido', message: 'El nombre no puede estar vacío' });
      cancelInlineEdit();
      return;
    }
    if (currentProduct.name === trimmed) {
      cancelInlineEdit();
      return;
    }
    updatePayload = { name: trimmed };
  } else if (field === 'category') {
    const trimmed = rawValue.trim() || 'General';
    if (currentProduct.category === trimmed) {
      cancelInlineEdit();
      return;
    }
    updatePayload = { category: trimmed };
  } else {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      showToast({ type: 'error', title: 'Valor inválido', message: 'El SKU no puede estar vacío' });
      cancelInlineEdit();
      return;
    }
    if (currentProduct.sku === trimmed) {
      cancelInlineEdit();
      return;
    }
    updatePayload = { sku: trimmed };
  }

  // Actualización optimista inmediata en la grilla
  const previousProducts = [...productsSignal.value];
  setProducts((list) => list.map((p) => (p.id === productId ? { ...p, ...updatePayload } : p)));
  cancelInlineEdit();

  try {
    const updated = await apiFetch<ProductItem>(`tenants/${tenantId}/products/${productId}`, {
      method: 'PUT',
      body: updatePayload,
      token,
    });
    // Confirmar producto actualizado del backend
    setProducts((list) => list.map((p) => (p.id === productId ? updated : p)));
    showToast({
      type: 'success',
      title: 'Actualizado',
      message: `"${updated.name}" actualizado en catálogo`,
    });
    void invalidateAfter('product-saved');
  } catch (err: unknown) {
    // Revertir ante error
    setProducts(() => previousProducts);
    const msg = err instanceof Error ? err.message : 'Error al guardar cambio';
    showToast({ type: 'error', title: 'Error al actualizar', message: msg });
  }
}

// Modal de Creación / Edición Completa
export function openNewProductModal(): void {
  editingProductSignal.value = null;
  productFormDataSignal.value = {
    sku: `SKU-${Date.now().toString().slice(-6)}`,
    barcodes: [],
    name: '',
    price: 0,
    taxRate: 0.21,
    category: categoriesSignal.value[0] ?? 'General',
    tracksStock: true,
  };
  productFormErrorSignal.value = null;
  productModalOpenSignal.value = true;
}

export function openEditProductModal(product: ProductItem): void {
  editingProductSignal.value = product;
  productFormDataSignal.value = {
    id: product.id,
    sku: product.sku,
    barcodes: [...product.barcodes],
    name: product.name,
    price: product.price,
    taxRate: product.taxRate,
    category: product.category,
    tracksStock: product.tracksStock,
    blockedReason: product.blockedReason,
  };
  productFormErrorSignal.value = null;
  productModalOpenSignal.value = true;
}

export function closeProductModal(): void {
  productModalOpenSignal.value = false;
  editingProductSignal.value = null;
  productFormErrorSignal.value = null;
}

export async function submitProductForm(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  const data = productFormDataSignal.value;
  if (!data.name.trim()) {
    productFormErrorSignal.value = 'El nombre del producto es obligatorio';
    return;
  }
  if (!data.sku.trim()) {
    productFormErrorSignal.value = 'El código SKU es obligatorio';
    return;
  }
  if (data.price < 0 || isNaN(data.price)) {
    productFormErrorSignal.value = 'El precio debe ser un número mayor o igual a 0';
    return;
  }

  try {
    isSavingProductSignal.value = true;
    productFormErrorSignal.value = null;

    const currentEditing = editingProductSignal.value;
    const isEdit = Boolean(currentEditing?.id);
    const endpoint = isEdit && currentEditing
      ? `tenants/${tenantId}/products/${currentEditing.id}`
      : `tenants/${tenantId}/products`;

    const saved = await apiFetch<ProductItem>(endpoint, {
      method: isEdit ? 'PUT' : 'POST',
      body: data,
      token,
    });

    if (isEdit) {
      setProducts((list) => list.map((p) => (p.id === saved.id ? saved : p)));
      showToast({
        type: 'success',
        title: 'Producto Modificado',
        message: `"${saved.name}" fue actualizado correctamente`,
      });
    } else {
      setProducts((list) => [saved, ...list]);
      showToast({
        type: 'success',
        title: 'Producto Creado',
        message: `"${saved.name}" fue agregado al catálogo`,
      });
    }

    // Una categoría nueva se ve enseguida, antes de que llegue la lista del servidor
    categoriesQuery.setData((previous) => {
      const list = previous ?? [];
      return list.includes(saved.category) ? list : [...list, saved.category].sort();
    });
    void invalidateAfter('product-saved');

    closeProductModal();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al guardar producto';
    productFormErrorSignal.value = msg;
  } finally {
    isSavingProductSignal.value = false;
  }
}

// Bloqueo y Desbloqueo
export function openBlockModal(product: ProductItem): void {
  targetProductToBlockSignal.value = product;
  blockReasonSignal.value = product.blockedReason ?? 'Descontinuado temporalmente';
  blockModalOpenSignal.value = true;
}

export function closeBlockModal(): void {
  blockModalOpenSignal.value = false;
  targetProductToBlockSignal.value = null;
  blockReasonSignal.value = '';
}

export async function confirmToggleBlock(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  const target = targetProductToBlockSignal.value;
  if (!tenantId || !token || !target) return;

  const isCurrentlyBlocked = Boolean(target.blockedReason);
  const nextBlockedReason = isCurrentlyBlocked ? null : (blockReasonSignal.value.trim() || 'Bloqueado por administración');

  try {
    const updated = await apiFetch<ProductItem>(`tenants/${tenantId}/products/${target.id}`, {
      method: 'PUT',
      body: { blockedReason: nextBlockedReason },
      token,
    });

    setProducts((list) => list.map((p) => (p.id === updated.id ? updated : p)));
    void invalidateAfter('product-saved');
    showToast({
      type: isCurrentlyBlocked ? 'success' : 'warning',
      title: isCurrentlyBlocked ? 'Producto Desbloqueado' : 'Producto Bloqueado',
      message: `"${target.name}" ahora está ${isCurrentlyBlocked ? 'disponible para venta' : 'bloqueado'}`,
    });
    closeBlockModal();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al cambiar estado del producto';
    showToast({ type: 'error', title: 'Error', message: msg });
  }
}

// Eliminación (baja)
export async function deleteProduct(product: ProductItem): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  const confirmed = typeof window !== 'undefined' ? window.confirm(`¿Estás seguro de eliminar el producto "${product.name}"?`) : true;
  if (!confirmed) return;

  try {
    await apiFetch(`tenants/${tenantId}/products/${product.id}`, {
      method: 'DELETE',
      body: { hard: false, reason: 'Eliminado desde panel admin' },
      token,
    });

    setProducts((list) => list.filter((p) => p.id !== product.id));
    void invalidateAfter('product-saved');
    showToast({
      type: 'info',
      title: 'Producto Eliminado',
      message: `"${product.name}" fue dado de baja del catálogo`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar producto';
    showToast({ type: 'error', title: 'Error', message: msg });
  }
}
