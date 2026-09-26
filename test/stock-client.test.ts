import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  stockItemsSignal,
  stockBranchesSignal,
  stockCategoriesSignal,
  stockSearchSignal,
  stockCategoryFilterSignal,
  stockStatusFilterSignal,
  stockBranchFilterSignal,
  filteredStockSignal,
  adjustModalOpenSignal,
  adjustFormSignal,
  openAdjustModal,
  closeAdjustModal,
  submitStockAdjustment,
  kardexDrawerOpenSignal,
  kardexTargetProductSignal,
  kardexMovementsSignal,
  openKardex,
  closeKardex,
  type StockMatrixItem,
  type BranchItem,
} from '../src/client/state/stock-state.ts';
import {
  tokenSignal,
  activeTenantIdSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';

const mockBranches: BranchItem[] = [
  { id: 'branch-1', code: 'CENTRAL', name: 'Casa Central', createdAt: '2026-09-25T10:00:00Z', updatedAt: '2026-09-25T10:00:00Z' },
  { id: 'branch-2', code: 'SUC01', name: 'Sucursal Norte', createdAt: '2026-09-25T10:00:00Z', updatedAt: '2026-09-25T10:00:00Z' },
];

const mockStockProductA: StockMatrixItem = {
  productId: 'prod-1',
  sku: 'COCA-500',
  name: 'Coca Cola 500ml',
  category: 'Bebidas',
  tracksStock: true,
  totalStock: 35,
  branches: { 'branch-1': 20, 'branch-2': 15 },
  updatedAt: '2026-09-25T10:00:00Z',
};

const mockStockProductB: StockMatrixItem = {
  productId: 'prod-2',
  sku: 'ALF-JOR',
  name: 'Alfajor Triple',
  category: 'Golosinas',
  tracksStock: true,
  totalStock: 3,
  branches: { 'branch-1': 3, 'branch-2': 0 },
  updatedAt: '2026-09-25T10:00:00Z',
};

const mockStockProductC: StockMatrixItem = {
  productId: 'prod-3',
  sku: 'AGUA-MIN',
  name: 'Agua Mineral 1.5L',
  category: 'Bebidas',
  tracksStock: true,
  totalStock: 0,
  branches: { 'branch-1': 0, 'branch-2': 0 },
  updatedAt: '2026-09-25T10:00:00Z',
};

const mockStockProductD: StockMatrixItem = {
  productId: 'prod-4',
  sku: 'SERV-ENV',
  name: 'Servicio de Envío',
  category: 'Servicios',
  tracksStock: false,
  totalStock: 0,
  branches: {},
  updatedAt: '2026-09-25T10:00:00Z',
};

describe('Módulo de Stock Multi-Sucursal y Kardex (Etapa 4.2)', () => {
  beforeEach(() => {
    stockItemsSignal.value = [mockStockProductA, mockStockProductB, mockStockProductC, mockStockProductD];
    stockBranchesSignal.value = mockBranches;
    stockCategoriesSignal.value = ['Bebidas', 'Golosinas', 'Servicios'];
    stockSearchSignal.value = '';
    stockCategoryFilterSignal.value = 'all';
    stockStatusFilterSignal.value = 'all';
    stockBranchFilterSignal.value = 'all';

    adjustModalOpenSignal.value = false;
    kardexDrawerOpenSignal.value = false;
    kardexTargetProductSignal.value = null;
    kardexMovementsSignal.value = [];

    tokenSignal.value = 'mock-token';
    activeTenantIdSignal.value = 'tienda-test';
    userTenantsSignal.value = [
      { tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' },
    ];
    vi.restoreAllMocks();
  });

  describe('Filtros y Búsqueda de Stock', () => {
    it('muestra todos los artículos por defecto', () => {
      expect(filteredStockSignal.value.length).toBe(4);
    });

    it('filtra por búsqueda en nombre o SKU', () => {
      stockSearchSignal.value = 'coca';
      expect(filteredStockSignal.value.map((s) => s.productId)).toEqual(['prod-1']);

      stockSearchSignal.value = 'ALF-JOR';
      expect(filteredStockSignal.value.map((s) => s.productId)).toEqual(['prod-2']);
    });

    it('filtra por categoría', () => {
      stockCategoryFilterSignal.value = 'Bebidas';
      expect(filteredStockSignal.value.length).toBe(2);
      expect(filteredStockSignal.value.every((s) => s.category === 'Bebidas')).toBe(true);
    });

    it('filtra por nivel de existencias (agotado, stock bajo, normal)', () => {
      stockStatusFilterSignal.value = 'out';
      expect(filteredStockSignal.value.map((s) => s.productId)).toContain('prod-3');

      stockStatusFilterSignal.value = 'low';
      expect(filteredStockSignal.value.map((s) => s.productId)).toEqual(['prod-2']);

      stockStatusFilterSignal.value = 'normal';
      expect(filteredStockSignal.value.map((s) => s.productId)).toEqual(['prod-1']);
    });

    it('filtra por existencia específica en una sucursal seleccionada', () => {
      stockBranchFilterSignal.value = 'branch-2';
      stockStatusFilterSignal.value = 'out';
      // En branch-2, prod-2 (0) y prod-3 (0) están agotados
      const ids = filteredStockSignal.value.map((s) => s.productId);
      expect(ids).toContain('prod-2');
      expect(ids).toContain('prod-3');
    });
  });

  describe('Ajuste de Stock Auditado (Kardex)', () => {
    it('openAdjustModal inicializa el formulario con la sucursal y existencia actual', () => {
      openAdjustModal(mockStockProductA, 'branch-2');
      expect(adjustModalOpenSignal.value).toBe(true);
      expect(adjustFormSignal.value.productId).toBe('prod-1');
      expect(adjustFormSignal.value.branchId).toBe('branch-2');
      expect(adjustFormSignal.value.quantity).toBe(15);
      expect(adjustFormSignal.value.type).toBe('set');

      closeAdjustModal();
      expect(adjustModalOpenSignal.value).toBe(false);
    });

    it('ejecuta ajuste de stock exitosamente y actualiza la matriz en memoria', async () => {
      openAdjustModal(mockStockProductA, 'branch-1');
      adjustFormSignal.value = {
        productId: 'prod-1',
        productName: 'Coca Cola 500ml',
        sku: 'COCA-500',
        branchId: 'branch-1',
        type: 'set',
        quantity: 25,
        reason: 'recuento_fisico',
        notes: 'Inventario físico fin de mes',
      };

      const originalFetch = globalThis.fetch;
      let sentBody: unknown = null;

      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        sentBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        return Promise.resolve(new Response(
          JSON.stringify({
            productId: 'prod-1',
            branchId: 'branch-1',
            previousQuantity: 20,
            delta: 5,
            newQuantity: 25,
            movementId: 'mov-123',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      });

      try {
        await submitStockAdjustment();

        expect(adjustModalOpenSignal.value).toBe(false);
        expect(sentBody).toEqual({
          productId: 'prod-1',
          branchId: 'branch-1',
          type: 'set',
          quantity: 25,
          reason: 'recuento_fisico',
          notes: 'Inventario físico fin de mes',
        });

        // Verificar que la matriz en memoria se actualizó reactivamente
        const updated = stockItemsSignal.value.find((s) => s.productId === 'prod-1');
        expect(updated?.branches['branch-1']).toBe(25);
        expect(updated?.totalStock).toBe(40); // 25 + 15
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('rechaza ajuste si el motivo o la sucursal no están especificados', async () => {
      openAdjustModal(mockStockProductA);
      adjustFormSignal.value = {
        ...adjustFormSignal.value,
        branchId: '',
      };

      await submitStockAdjustment();
      expect(adjustModalOpenSignal.value).toBe(true);
    });
  });

  describe('Historial de Auditoría Kardex', () => {
    it('openKardex consulta los movimientos del producto y los almacena en kardexMovementsSignal', async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/kardex')) {
          return Promise.resolve(new Response(
            JSON.stringify([
              {
                id: 'mov-1',
                productId: 'prod-1',
                productName: 'Coca Cola 500ml',
                sku: 'COCA-500',
                branchId: 'branch-1',
                branchName: 'Casa Central',
                delta: -2,
                reason: 'sale',
                notes: null,
                saleId: 'sale-999',
                deviceId: 'pos-terminal-1',
                originBranch: 'CENTRAL',
                originPointOfSale: 'Caja 1',
                createdAt: '2026-09-25T12:00:00Z',
              },
              {
                id: 'mov-2',
                productId: 'prod-1',
                productName: 'Coca Cola 500ml',
                sku: 'COCA-500',
                branchId: 'branch-1',
                branchName: 'Casa Central',
                delta: 10,
                reason: 'ingreso_mercaderia',
                notes: 'Factura Distribuidor #4451',
                saleId: null,
                deviceId: null,
                originBranch: null,
                originPointOfSale: null,
                createdAt: '2026-09-25T09:00:00Z',
              },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }));
      });

      try {
        await openKardex(mockStockProductA);

        expect(kardexDrawerOpenSignal.value).toBe(true);
        expect(kardexTargetProductSignal.value?.productId).toBe('prod-1');
        expect(kardexMovementsSignal.value.length).toBe(2);
        expect(kardexMovementsSignal.value[0]?.reason).toBe('sale');
        expect(kardexMovementsSignal.value[0]?.delta).toBe(-2);

        closeKardex();
        expect(kardexDrawerOpenSignal.value).toBe(false);
        expect(kardexTargetProductSignal.value).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
