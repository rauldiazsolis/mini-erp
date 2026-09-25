import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';

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

export type StockMatrixItem = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  totalQuantity: number;
  branches: Record<string, number>;
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

// Señales principales de catálogo
export const productsSignal = signal<ProductItem[]>([]);
export const categoriesSignal = signal<string[]>([]);
export const stockMapSignal = signal<Record<string, number>>({});
export const catalogLoadingSignal = signal<boolean>(false);
export const catalogErrorSignal = signal<string | null>(null);

// Señales de filtrado y búsqueda
export const catalogSearchSignal = signal<string>('');
export const catalogCategoryFilterSignal = signal<string>('all');
export const catalogBlockedFilterSignal = signal<'all' | 'active' | 'blocked'>('all');

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

// Productos filtrados computados
export const filteredProductsSignal = computed<ProductItem[]>(() => {
  const search = catalogSearchSignal.value.trim().toLowerCase();
  const category = catalogCategoryFilterSignal.value;
  const blockedFilter = catalogBlockedFilterSignal.value;

  return productsSignal.value.filter((p) => {
    // Filtro de búsqueda
    if (search) {
      const matchName = p.name.toLowerCase().includes(search);
      const matchSku = p.sku.toLowerCase().includes(search);
      const matchBarcode = p.barcodes.some((b) => b.toLowerCase().includes(search));
      if (!matchName && !matchSku && !matchBarcode) {
        return false;
      }
    }

    // Filtro por categoría
    if (category !== 'all' && p.category !== category) {
      return false;
    }

    // Filtro por estado
    if (blockedFilter === 'active' && p.blockedReason !== null) {
      return false;
    }
    if (blockedFilter === 'blocked' && p.blockedReason === null) {
      return false;
    }

    return true;
  });
});

export async function fetchCatalog(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    catalogLoadingSignal.value = true;
    catalogErrorSignal.value = null;

    // Ejecutar en paralelo la consulta de productos, categorías y stock consolidado
    const [products, categories, stockMatrix] = await Promise.all([
      apiFetch<ProductItem[]>(`tenants/${tenantId}/products`, { token }),
      apiFetch<string[]>(`tenants/${tenantId}/categories`, { token }).catch(() => []),
      apiFetch<StockMatrixItem[]>(`tenants/${tenantId}/stock`, { token }).catch(() => []),
    ]);

    productsSignal.value = products;
    categoriesSignal.value = categories;

    const map: Record<string, number> = {};
    for (const item of stockMatrix) {
      map[item.productId] = item.totalQuantity;
    }
    stockMapSignal.value = map;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al cargar catálogo';
    catalogErrorSignal.value = msg;
    showToast({ type: 'error', title: 'Error de catálogo', message: msg });
  } finally {
    catalogLoadingSignal.value = false;
  }
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
  } else if (field === 'sku') {
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
  productsSignal.value = productsSignal.value.map((p) => (p.id === productId ? { ...p, ...updatePayload } : p));
  cancelInlineEdit();

  try {
    const updated = await apiFetch<ProductItem>(`tenants/${tenantId}/products/${productId}`, {
      method: 'PUT',
      body: updatePayload,
      token,
    });
    // Confirmar producto actualizado del backend
    productsSignal.value = productsSignal.value.map((p) => (p.id === productId ? updated : p));
    showToast({
      type: 'success',
      title: 'Actualizado',
      message: `"${updated.name}" actualizado en catálogo`,
    });
  } catch (err: unknown) {
    // Revertir ante error
    productsSignal.value = previousProducts;
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

    const isEdit = Boolean(editingProductSignal.value?.id);
    const endpoint = isEdit
      ? `tenants/${tenantId}/products/${editingProductSignal.value!.id}`
      : `tenants/${tenantId}/products`;

    const saved = await apiFetch<ProductItem>(endpoint, {
      method: isEdit ? 'PUT' : 'POST',
      body: data,
      token,
    });

    if (isEdit) {
      productsSignal.value = productsSignal.value.map((p) => (p.id === saved.id ? saved : p));
      showToast({
        type: 'success',
        title: 'Producto Modificado',
        message: `"${saved.name}" fue actualizado correctamente`,
      });
    } else {
      productsSignal.value = [saved, ...productsSignal.value];
      showToast({
        type: 'success',
        title: 'Producto Creado',
        message: `"${saved.name}" fue agregado al catálogo`,
      });
    }

    // Actualizar lista de categorías si es una nueva
    if (!categoriesSignal.value.includes(saved.category)) {
      categoriesSignal.value = [...categoriesSignal.value, saved.category].sort();
    }

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

    productsSignal.value = productsSignal.value.map((p) => (p.id === updated.id ? updated : p));
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

    productsSignal.value = productsSignal.value.filter((p) => p.id !== product.id);
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
