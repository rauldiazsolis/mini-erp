import { computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { createTenantParamQuery } from './query-keys.ts';
import { branchesQuery } from './shared-queries.ts';
import { inSection, routeFilters, setFilters } from './route-state.ts';
import type { DashboardFilters } from '../routing/admin-routes.ts';
import type { BranchItem } from './stock-state.ts';

export type DashboardPeriod = 'today' | 'week' | 'month';

export type DashboardSummaryMetrics = {
  totalSales: number;
  salesCount: number;
  averageTicket: number;
  previousTotalSales: number;
  changePercentage: number;
  totalReceivables: number;
  debtorCount: number;
  totalCustomers: number;
};

export type TimelinePoint = {
  date: string;
  label: string;
  total: number;
  count: number;
};

/** Igual que en el servidor (#15): productos del catálogo o líneas manuales (`freeform`) agrupadas. */
export type TopProductItem = {
  key: string;
  kind: 'product' | 'freeform';
  productId?: string;
  name: string;
  unitsSold: number;
  totalRevenue: number;
};

export type LowStockItem = {
  id: string;
  sku: string;
  name: string;
  stock: number;
};

export type DashboardData = {
  period: DashboardPeriod;
  branchId?: string;
  summary: DashboardSummaryMetrics;
  timeline: TimelinePoint[];
  topProducts: TopProductItem[];
  stockAlerts: {
    criticalCount: number;
    lowStockProducts: LowStockItem[];
  };
};

// Filtros: en la URL (#59)
export const dashboardFiltersSignal = computed<DashboardFilters>(() => routeFilters('dashboard'));
export const selectedPeriodSignal = computed<DashboardPeriod>(() => dashboardFiltersSignal.value.period);
export const selectedBranchSignal = computed<string>(() => dashboardFiltersSignal.value.branch);

export function setDashboardFilters(patch: Partial<DashboardFilters>): void {
  setFilters('dashboard', patch);
}

// Datos: en la caché de TanStack Query, uno por período y sucursal. Al entrar se pide de nuevo, y
// una mutación de otra pantalla (cobranza, importación, ajuste) lo deja viejo (#59)
const summaryQuery = createTenantParamQuery<DashboardData, readonly [DashboardPeriod, string]>({
  domain: 'dashboard',
  params: () => [selectedPeriodSignal.value, selectedBranchSignal.value],
  enabled: () => inSection('dashboard'),
  fn: ({ tenantId, token, params: [period, branch] }) => {
    const query = branch ? `period=${period}&branchId=${encodeURIComponent(branch)}` : `period=${period}`;
    return apiFetch<DashboardData>(`tenants/${tenantId}/dashboard/summary?${query}`, { token });
  },
});

export const dashboardDataSignal = computed<DashboardData | null>(() => summaryQuery.data.value ?? null);
export const dashboardLoadingSignal = summaryQuery.isLoading;
export const dashboardErrorSignal = computed<string | null>(() => summaryQuery.error.value?.message ?? null);
/** Si falla el listado de sucursales, el filtro queda vacío sin bloquear la vista. */
export const branchesListSignal = computed<BranchItem[]>(() => branchesQuery.data.value ?? []);

/** Los botones "Actualizar" y "Reintentar". */
export async function fetchDashboardData(): Promise<void> {
  await summaryQuery.refetch();
}
