import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  productsSignal,
  categoriesSignal,
  stockMapSignal,
  catalogSearchSignal,
  catalogCategoryFilterSignal,
  catalogBlockedFilterSignal,
  filteredProductsSignal,
  inlineEditingSignal,
  startInlineEdit,
  cancelInlineEdit,
  saveInlineEdit,
  productModalOpenSignal,
  editingProductSignal,
  productFormDataSignal,
  openNewProductModal,
  openEditProductModal,
  closeProductModal,
  submitProductForm,
  blockModalOpenSignal,
  targetProductToBlockSignal,
  blockReasonSignal,
  openBlockModal,
  closeBlockModal,
  confirmToggleBlock,
  deleteProduct,
  fetchCatalog,
  type ProductItem,
} from '../src/client/state/catalog-state.ts';
import {
  tokenSignal,
  activeTenantIdSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';

const mockProductA: ProductItem = {
  id: 'prod-1',
  sku: 'COCA-500',
  barcodes: ['7791234567890'],
  name: 'Coca Cola 500ml',
  price: 1500,
  taxRate: 0.21,
  category: 'Bebidas',
  tracksStock: true,
  blockedReason: null,
  createdAt: '2026-09-25T10:00:00Z',
  updatedAt: '2026-09-25T10:00:00Z',
};

const mockProductB: ProductItem = {
  id: 'prod-2',
  sku: 'ALF-JOR',
  barcodes: ['7790001112223'],
  name: 'Alfajor Triple',
  price: 900,
  taxRate: 0.21,
  category: 'Golosinas',
  tracksStock: true,
  blockedReason: 'Falta de stock del distribuidor',
  createdAt: '2026-09-25T10:00:00Z',
  updatedAt: '2026-09-25T10:00:00Z',
};

const mockProductC: ProductItem = {
  id: 'prod-3',
  sku: 'AGUA-MIN',
  barcodes: ['7793334445556'],
  name: 'Agua Mineral 1.5L',
  price: 1100,
  taxRate: 0.21,
  category: 'Bebidas',
  tracksStock: false,
  blockedReason: null,
  createdAt: '2026-09-25T10:00:00Z',
  updatedAt: '2026-09-25T10:00:00Z',
};

describe('Módulo de Catálogo & Precios (Etapa 4.1)', () => {
  beforeEach(() => {
    productsSignal.value = [mockProductA, mockProductB, mockProductC];
    categoriesSignal.value = ['Bebidas', 'Golosinas'];
    stockMapSignal.value = { 'prod-1': 24, 'prod-2': 0 };
    catalogSearchSignal.value = '';
    catalogCategoryFilterSignal.value = 'all';
    catalogBlockedFilterSignal.value = 'all';
    inlineEditingSignal.value = null;
    productModalOpenSignal.value = false;
    editingProductSignal.value = null;
    blockModalOpenSignal.value = false;
    targetProductToBlockSignal.value = null;

    tokenSignal.value = 'mock-token';
    activeTenantIdSignal.value = 'tienda-test';
    userTenantsSignal.value = [
      { tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' },
    ];
    vi.restoreAllMocks();
  });

  describe('Filtros y Búsqueda en Memoria', () => {
    it('devuelve todos los productos cuando no hay filtros aplicados', () => {
      expect(filteredProductsSignal.value.length).toBe(3);
    });

    it('filtra por texto de búsqueda en nombre, SKU y código de barras', () => {
      catalogSearchSignal.value = 'coca';
      expect(filteredProductsSignal.value.map((p) => p.id)).toEqual(['prod-1']);

      catalogSearchSignal.value = 'ALF-JOR';
      expect(filteredProductsSignal.value.map((p) => p.id)).toEqual(['prod-2']);

      catalogSearchSignal.value = '779333';
      expect(filteredProductsSignal.value.map((p) => p.id)).toEqual(['prod-3']);
    });

    it('filtra por categoría', () => {
      catalogCategoryFilterSignal.value = 'Bebidas';
      expect(filteredProductsSignal.value.length).toBe(2);
      expect(filteredProductsSignal.value.every((p) => p.category === 'Bebidas')).toBe(true);

      catalogCategoryFilterSignal.value = 'Golosinas';
      expect(filteredProductsSignal.value.length).toBe(1);
      expect(filteredProductsSignal.value[0]?.id).toBe('prod-2');
    });

    it('filtra por estado de bloqueo (activo vs bloqueado)', () => {
      catalogBlockedFilterSignal.value = 'active';
      expect(filteredProductsSignal.value.length).toBe(2);
      expect(filteredProductsSignal.value.every((p) => p.blockedReason === null)).toBe(true);

      catalogBlockedFilterSignal.value = 'blocked';
      expect(filteredProductsSignal.value.length).toBe(1);
      expect(filteredProductsSignal.value[0]?.id).toBe('prod-2');
    });
  });

  describe('Edición Inline Tipo Hoja de Cálculo', () => {
    it('inicia y cancela edición inline', () => {
      startInlineEdit('prod-1', 'price', '1500');
      expect(inlineEditingSignal.value).toEqual({
        productId: 'prod-1',
        field: 'price',
        value: '1500',
      });

      cancelInlineEdit();
      expect(inlineEditingSignal.value).toBeNull();
    });

    it('aplica actualización optimista y persiste vía PUT al guardar precio inline', async () => {
      const originalFetch = globalThis.fetch;
      let requestedBody: unknown = null;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        requestedBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({
            ...mockProductA,
            price: 1850,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      try {
        await saveInlineEdit('prod-1', 'price', '1850');

        expect(requestedBody).toEqual({ price: 1850 });
        const updated = productsSignal.value.find((p) => p.id === 'prod-1');
        expect(updated?.price).toBe(1850);
        expect(inlineEditingSignal.value).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('rechaza precios inválidos o negativos sin alterar el producto', async () => {
      await saveInlineEdit('prod-1', 'price', '-50');
      const prod = productsSignal.value.find((p) => p.id === 'prod-1');
      expect(prod?.price).toBe(1500);
      expect(inlineEditingSignal.value).toBeNull();
    });

    it('reinvierte el cambio optimista si la API falla', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ error: 'Falla del servidor' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      try {
        await saveInlineEdit('prod-1', 'name', 'Nuevo Nombre');
        const prod = productsSignal.value.find((p) => p.id === 'prod-1');
        expect(prod?.name).toBe('Coca Cola 500ml');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Modal de Creación y Edición Completa', () => {
    it('openNewProductModal prepara el formulario vacío con valores por defecto', () => {
      openNewProductModal();
      expect(productModalOpenSignal.value).toBe(true);
      expect(editingProductSignal.value).toBeNull();
      expect(productFormDataSignal.value.tracksStock).toBe(true);
      expect(productFormDataSignal.value.taxRate).toBe(0.21);
    });

    it('openEditProductModal precarga los valores del producto seleccionado', () => {
      openEditProductModal(mockProductA);
      expect(productModalOpenSignal.value).toBe(true);
      expect(editingProductSignal.value?.id).toBe('prod-1');
      expect(productFormDataSignal.value.name).toBe('Coca Cola 500ml');
      expect(productFormDataSignal.value.price).toBe(1500);
    });

    it('crea un nuevo producto vía POST y lo agrega a la lista', async () => {
      const originalFetch = globalThis.fetch;
      openNewProductModal();
      productFormDataSignal.value = {
        sku: 'GAL-OREO',
        barcodes: ['7790009998881'],
        name: 'Galletitas Oreo 118g',
        price: 850,
        taxRate: 0.21,
        category: 'Galletitas',
        tracksStock: true,
      };

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            id: 'prod-4',
            sku: 'GAL-OREO',
            barcodes: ['7790009998881'],
            name: 'Galletitas Oreo 118g',
            price: 850,
            taxRate: 0.21,
            category: 'Galletitas',
            tracksStock: true,
            blockedReason: null,
            createdAt: '2026-09-25T11:00:00Z',
            updatedAt: '2026-09-25T11:00:00Z',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      try {
        await submitProductForm();

        expect(productModalOpenSignal.value).toBe(false);
        expect(productsSignal.value.length).toBe(4);
        expect(productsSignal.value[0]?.name).toBe('Galletitas Oreo 118g');
        expect(categoriesSignal.value).toContain('Galletitas');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Bloqueo, Desbloqueo y Eliminación', () => {
    it('openBlockModal y confirmToggleBlock alternan el estado de bloqueo', async () => {
      openBlockModal(mockProductA);
      expect(blockModalOpenSignal.value).toBe(true);
      expect(targetProductToBlockSignal.value?.id).toBe('prod-1');

      blockReasonSignal.value = 'Suspendido por inspección';

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            ...mockProductA,
            blockedReason: 'Suspendido por inspección',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      try {
        await confirmToggleBlock();
        expect(blockModalOpenSignal.value).toBe(false);
        const updated = productsSignal.value.find((p) => p.id === 'prod-1');
        expect(updated?.blockedReason).toBe('Suspendido por inspección');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('deleteProduct elimina el producto de la lista', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ success: true, softDeleted: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      try {
        await deleteProduct(mockProductB);
        expect(productsSignal.value.some((p) => p.id === 'prod-2')).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
