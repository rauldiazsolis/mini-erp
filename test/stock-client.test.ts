import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  stockFiltersSignal,
  setStockFilters,
  filterStock,
  stockItemsSignal,
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
import { userTenantsSignal } from '../src/client/state/auth-state.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { locationSignal, setHistoryForTests } from '../src/client/state/route-state.ts';
import { drillToStockProduct } from '../src/client/state/dashboard-drill.ts';
import type { StockFilters } from '../src/client/routing/admin-routes.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

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
    setHistoryForTests(null);
    freshSession('mock-token');
    adjustModalOpenSignal.value = false;
    kardexDrawerOpenSignal.value = false;
    kardexTargetProductSignal.value = null;

    userTenantsSignal.value = [
      { tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' },
    ];
    queryClient.setQueryData(tenantKey('tienda-test', 'stock'), [mockStockProductA, mockStockProductB, mockStockProductC, mockStockProductD]);
    queryClient.setQueryData(tenantKey('tienda-test', 'branches'), mockBranches);
    queryClient.setQueryData(tenantKey('tienda-test', 'categories'), ['Bebidas', 'Golosinas', 'Servicios']);
    // En una pantalla que no pide stock ni sucursales: los tests ven la caché sin pedidos de fondo
    atTenant('tienda-test', 'clientes');
    vi.restoreAllMocks();
  });

  describe('Filtros y Búsqueda de Stock', () => {
    const all = [mockStockProductA, mockStockProductB, mockStockProductC, mockStockProductD];
    const none: StockFilters = { q: '', category: 'all', level: 'all', branch: 'all' };
    const ids = (patch: Partial<StockFilters>): string[] => filterStock(all, { ...none, ...patch }).map((s) => s.productId);

    it('muestra todos los artículos por defecto', () => {
      expect(filteredStockSignal.value.length).toBe(4);
    });

    it('filtra por búsqueda en nombre o SKU', () => {
      expect(ids({ q: 'coca' })).toEqual(['prod-1']);
      expect(ids({ q: 'ALF-JOR' })).toEqual(['prod-2']);
    });

    it('filtra por categoría', () => {
      expect(ids({ category: 'Bebidas' })).toEqual(['prod-1', 'prod-3']);
    });

    it('filtra por nivel de existencias (agotado, stock bajo, normal)', () => {
      expect(ids({ level: 'out' })).toContain('prod-3');
      expect(ids({ level: 'low' })).toEqual(['prod-2']);
      expect(ids({ level: 'normal' })).toEqual(['prod-1']);
    });

    it('filtra por existencia específica en una sucursal seleccionada', () => {
      // En branch-2, prod-2 (0) y prod-3 (0) están agotados
      const out = ids({ branch: 'branch-2', level: 'out' });
      expect(out).toContain('prod-2');
      expect(out).toContain('prod-3');
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
        openKardex(mockStockProductA);

        expect(kardexDrawerOpenSignal.value).toBe(true);
        expect(kardexTargetProductSignal.value?.productId).toBe('prod-1');
        await vi.waitFor(() => { expect(kardexMovementsSignal.value.length).toBe(2); });
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

  describe('Stock con URL y caché (#59)', () => {
    const json = (body: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

    it('los filtros salen de la URL', () => {
      atTenant('tienda-test', 'stock?nivel=sin-stock&sucursal=b1');
      expect(stockFiltersSignal.value).toEqual({ q: '', category: 'all', level: 'out', branch: 'b1' });
      setStockFilters({ q: 'coca' });
      expect(locationSignal.value.search).toBe('?q=coca&nivel=sin-stock&sucursal=b1');
    });

    it('el kardex se pide al abrirlo, por producto, y cerrado no se ve', async () => {
      const urls: string[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
        urls.push(input instanceof Request ? input.url : input.toString());
        return json([]);
      });
      try {
        openKardex(mockStockProductB);
        await vi.waitFor(() => { expect(urls).toContain('/api/tenants/tienda-test/stock/kardex?productId=prod-2&limit=100'); });
        closeKardex();
        expect(kardexMovementsSignal.value).toEqual([]);
      } finally {
        globalThis.fetch = original;
      }
    });

    it('un ajuste deja viejos stock, catálogo y dashboard', async () => {
      queryClient.setQueryData(tenantKey('tienda-test', 'products'), []);
      queryClient.setQueryData(tenantKey('tienda-test', 'dashboard', 'week', ''), {});
      openAdjustModal(mockStockProductA, 'branch-1');
      const original = globalThis.fetch;
      globalThis.fetch = vi.fn(() => json({ productId: 'prod-1', branchId: 'branch-1', previousQuantity: 20, delta: 1, newQuantity: 21, movementId: 'm' }));
      try {
        await submitStockAdjustment();
        for (const domain of ['stock', 'products'] as const) {
          expect(queryClient.getQueryState(tenantKey('tienda-test', domain))?.isInvalidated, domain).toBe(true);
        }
        expect(queryClient.getQueryState(tenantKey('tienda-test', 'dashboard', 'week', ''))?.isInvalidated).toBe(true);
      } finally {
        globalThis.fetch = original;
      }
    });

    it('el drill del dashboard abre Stock filtrado por el producto', () => {
      atTenant('tienda-test', 'dashboard');
      drillToStockProduct('Coca');
      expect(`${locationSignal.value.pathname}${locationSignal.value.search}`).toBe('/admin/tienda-test/stock?q=Coca');
    });
  });
});
