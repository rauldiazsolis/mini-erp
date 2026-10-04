import { signal, effect } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';

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

export type BranchItem = {
  id: string;
  name: string;
  code: string;
};

// Signals
export const selectedPeriodSignal = signal<DashboardPeriod>('week');
export const selectedBranchSignal = signal<string>('');
export const dashboardDataSignal = signal<DashboardData | null>(null);
export const dashboardLoadingSignal = signal<boolean>(false);
export const dashboardErrorSignal = signal<string | null>(null);
export const branchesListSignal = signal<BranchItem[]>([]);

export async function fetchBranches(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;

  try {
    const list = await apiFetch<BranchItem[]>(`tenants/${tenantId}/branches`, { token });
    branchesListSignal.value = list;
  } catch {
    // Si falla el listado de sucursales, no bloquear la vista
    branchesListSignal.value = [];
  }
}

export async function fetchDashboardData(
  filters: { period: DashboardPeriod; branch: string } = {
    period: selectedPeriodSignal.value,
    branch: selectedBranchSignal.value,
  },
): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) {
    dashboardDataSignal.value = null;
    return;
  }

  try {
    dashboardLoadingSignal.value = true;
    dashboardErrorSignal.value = null;

    const { period, branch } = filters;

    let query = `period=${period}`;
    if (branch) {
      query += `&branchId=${encodeURIComponent(branch)}`;
    }

    const data = await apiFetch<DashboardData>(`tenants/${tenantId}/dashboard/summary?${query}`, {
      token,
    });

    dashboardDataSignal.value = data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al cargar analíticas';
    dashboardErrorSignal.value = msg;
  } finally {
    dashboardLoadingSignal.value = false;
  }
}

/**
 * Reactividad sin hooks (#7): un effect por cosa que se carga. Las sucursales dependen solo del
 * tenant y del token; el resumen, de eso y de los filtros. Así un filtro recarga solo el resumen, una
 * vez, y al entrar no se pide dos veces.
 */
export function registerDashboardEffects(): () => void {
  const disposeBranches = effect(() => {
    if (effectiveTenantIdSignal.value && tokenSignal.value) {
      void fetchBranches();
    }
  });

  const disposeSummary = effect(() => {
    const filters = { period: selectedPeriodSignal.value, branch: selectedBranchSignal.value };
    if (effectiveTenantIdSignal.value && tokenSignal.value) {
      void fetchDashboardData(filters);
    }
  });

  return () => {
    disposeBranches();
    disposeSummary();
  };
}

if (typeof window !== 'undefined') {
  registerDashboardEffects();
}
