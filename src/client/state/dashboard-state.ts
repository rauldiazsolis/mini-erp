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

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-AR').format(value);
}

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

// Reactividad automática sin hooks: cuando cambia el tenant activo, recargar sucursales y dashboard
if (typeof window !== 'undefined') {
  effect(() => {
    const tenantId = effectiveTenantIdSignal.value;
    if (tenantId && tokenSignal.value) {
      void fetchBranches();
      void fetchDashboardData();
    }
  });

  effect(() => {
    // Recargar cuando cambian los filtros (período o sucursal): leerlos acá suscribe el effect.
    const filters = { period: selectedPeriodSignal.value, branch: selectedBranchSignal.value };
    const tenantId = effectiveTenantIdSignal.value;
    if (tenantId && tokenSignal.value) {
      void fetchDashboardData(filters);
    }
  });
}
