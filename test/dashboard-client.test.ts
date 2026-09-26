import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectedPeriodSignal,
  selectedBranchSignal,
  dashboardDataSignal,
  dashboardLoadingSignal,
  dashboardErrorSignal,
  formatCurrency,
  formatNumber,
  type DashboardData,
} from '../src/client/state/dashboard-state.ts';
import { hoveredIndexSignal } from '../src/client/components/dashboard/SalesChart.tsx';

describe('Dashboard Client State, Analytics & Visual Components (Etapa 3.5)', () => {
  beforeEach(() => {
    selectedPeriodSignal.value = 'week';
    selectedBranchSignal.value = '';
    dashboardDataSignal.value = null;
    dashboardLoadingSignal.value = false;
    dashboardErrorSignal.value = null;
    hoveredIndexSignal.value = null;
  });

  describe('Formateadores de Números y Moneda', () => {
    it('formatea montos a moneda de forma legible', () => {
      const formattedZero = formatCurrency(0);
      expect(formattedZero).toContain('0');

      const formattedAmount = formatCurrency(45800);
      expect(formattedAmount).toContain('45.800');
    });

    it('formatea números enteros con separador de miles', () => {
      expect(formatNumber(1250)).toBe('1.250');
      expect(formatNumber(0)).toBe('0');
    });
  });

  describe('Estado Reactivo de Filtros', () => {
    it('inicia con período "week" y permite conmutar', () => {
      expect(selectedPeriodSignal.value).toBe('week');

      selectedPeriodSignal.value = 'today';
      expect(selectedPeriodSignal.value).toBe('today');

      selectedPeriodSignal.value = 'month';
      expect(selectedPeriodSignal.value).toBe('month');
    });

    it('permite seleccionar sucursal', () => {
      expect(selectedBranchSignal.value).toBe('');

      selectedBranchSignal.value = 'Sucursal Central';
      expect(selectedBranchSignal.value).toBe('Sucursal Central');
    });
  });

  describe('Interacción con Métricas del Dashboard', () => {
    const mockDashboardData: DashboardData = {
      period: 'week',
      branchId: undefined,
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
        { productId: 'p1', name: 'Gaseosa Cola 2L', unitsSold: 40, totalRevenue: 60000 },
        { productId: 'p2', name: 'Alfajor Triple', unitsSold: 35, totalRevenue: 35000 },
        { productId: 'p3', name: 'Papas Fritas', unitsSold: 20, totalRevenue: 30000 },
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
      dashboardDataSignal.value = mockDashboardData;

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
