import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectedPeriodSignal,
  selectedBranchSignal,
  setDashboardFilters,
  dashboardDataSignal,
  type DashboardData,
} from '../src/client/state/dashboard-state.ts';
import { hoveredIndexSignal } from '../src/client/components/dashboard/SalesChart.tsx';
import { queryClient } from '../src/client/api/query-client.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { setHistoryForTests } from '../src/client/state/route-state.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

describe('Dashboard Client State, Analytics & Visual Components (Etapa 3.5)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    freshSession('tok');
    // Fuera del dashboard: los tests ven la caché sin pedidos de fondo
    atTenant('kiosco', 'usuarios');
    hoveredIndexSignal.value = null;
  });

  describe('Estado Reactivo de Filtros', () => {
    it('inicia con período "week" y permite conmutar', () => {
      atTenant('kiosco', 'dashboard');
      expect(selectedPeriodSignal.value).toBe('week');

      setDashboardFilters({ period: 'today' });
      expect(selectedPeriodSignal.value).toBe('today');

      setDashboardFilters({ period: 'month' });
      expect(selectedPeriodSignal.value).toBe('month');
    });

    it('permite seleccionar sucursal', () => {
      atTenant('kiosco', 'dashboard');
      expect(selectedBranchSignal.value).toBe('');

      setDashboardFilters({ branch: 'Sucursal Central' });
      expect(selectedBranchSignal.value).toBe('Sucursal Central');
    });
  });

  describe('Interacción con Métricas del Dashboard', () => {
    const mockDashboardData: DashboardData = {
      period: 'week',
      summary: {
        totalSales: 125000,
        salesCount: 45,
        averageTicket: 2777.78,
        previousTotalSales: 110000,
        changePercentage: 13.6,
        totalReceivables: 34500,
        debtorCount: 4,
        totalCustomers: 12,
      },
      timeline: [
        { date: '2026-09-19', label: 'Sáb 19/09', total: 18000, count: 6 },
        { date: '2026-09-20', label: 'Dom 20/09', total: 12000, count: 4 },
        { date: '2026-09-21', label: 'Lun 21/09', total: 22000, count: 8 },
        { date: '2026-09-22', label: 'Mar 22/09', total: 19000, count: 7 },
        { date: '2026-09-23', label: 'Mié 23/09', total: 15000, count: 5 },
        { date: '2026-09-24', label: 'Jue 24/09', total: 24000, count: 9 },
        { date: '2026-09-25', label: 'Vie 25/09', total: 15000, count: 6 },
      ],
      topProducts: [
        { key: 'product:p1', kind: 'product', productId: 'p1', name: 'Gaseosa Cola 2L', unitsSold: 40, totalRevenue: 60000 },
        { key: 'product:p2', kind: 'product', productId: 'p2', name: 'Alfajor Triple', unitsSold: 35, totalRevenue: 35000 },
        { key: 'product:p3', kind: 'product', productId: 'p3', name: 'Papas Fritas', unitsSold: 20, totalRevenue: 30000 },
      ],
      stockAlerts: {
        criticalCount: 1,
        lowStockProducts: [
          { id: 'p-out', sku: 'OUT-1', name: 'Caramelos Menta', stock: 0 },
          { id: 'p-low', sku: 'LOW-2', name: 'Chicles Frutilla', stock: 3 },
        ],
      },
    };

    it('almacena y distribuye las métricas en las señales reactivas', () => {
      queryClient.setQueryData(tenantKey('kiosco', 'dashboard', 'week', ''), mockDashboardData);
      if (dashboardDataSignal.value === null) throw new Error('sin datos del dashboard');

      expect(dashboardDataSignal.value.summary.totalSales).toBe(125000);
      expect(dashboardDataSignal.value.summary.salesCount).toBe(45);
      expect(dashboardDataSignal.value.timeline).toHaveLength(7);
      expect(dashboardDataSignal.value.topProducts[0]?.name).toBe('Gaseosa Cola 2L');
      expect(dashboardDataSignal.value.stockAlerts.criticalCount).toBe(1);
    });

    it('controla la interacción hover del gráfico de evolución de ventas', () => {
      expect(hoveredIndexSignal.value).toBeNull();

      hoveredIndexSignal.value = 3;
      expect(hoveredIndexSignal.value).toBe(3);

      hoveredIndexSignal.value = null;
      expect(hoveredIndexSignal.value).toBeNull();
    });
  });
});
