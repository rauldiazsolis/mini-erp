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

export type TopProductItem = {
  productId: string;
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

export async function fetchDashboardData(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) {
    dashboardDataSignal.value = null;
    return;
  }

  try {
    dashboardLoadingSignal.value = true;
    dashboardErrorSignal.value = null;

    const period = selectedPeriodSignal.value;
    const branch = selectedBranchSignal.value;

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
      fetchBranches();
      fetchDashboardData();
    }
  });

  effect(() => {
    // Escuchar cambios de filtros (período o sucursal)
    const _p = selectedPeriodSignal.value;
    const _b = selectedBranchSignal.value;
    const tenantId = effectiveTenantIdSignal.value;
    if (tenantId && tokenSignal.value) {
      fetchDashboardData();
    }
  });
}
