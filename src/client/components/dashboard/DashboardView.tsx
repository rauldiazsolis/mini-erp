import {
  dashboardLoadingSignal,
  dashboardErrorSignal,
  dashboardDataSignal,
  fetchDashboardData,
} from '../../state/dashboard-state.ts';
import { activeTenantSignal } from '../../state/auth-state.ts';
import { DashboardFilters } from './DashboardFilters.tsx';
import { KpiCards } from './KpiCards.tsx';
import { SalesChart } from './SalesChart.tsx';
import { TopProductsTable } from './TopProductsTable.tsx';
import { StockAlertsCard } from './StockAlertsCard.tsx';
import { Button } from '../ui/Button.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';

export function DashboardView() {
  const activeTenant = activeTenantSignal.value;
  const isLoading = dashboardLoadingSignal.value;
  const error = dashboardErrorSignal.value;
  const data = dashboardDataSignal.value;

  return (
    <div class="space-y-6">
      {/* Encabezado de la página */}
      <PageHeader
        title="Dashboard Analítico"
        badge="Métricas en Vivo"
        subtitle={
          <span>
            Métricas de ventas, transacciones y cuentas corrientes en vivo para{' '}
            <strong class="text-indigo-600 dark:text-indigo-400">{activeTenant?.name ?? 'el comercio'}</strong>.
          </span>
        }
      />

      {/* Barra de Filtros */}
      <DashboardFilters />

      {/* Error Banner si existe */}
      {error && (
        <div class="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-between">
          <div class="text-xs text-rose-300 font-medium">{error}</div>
          <Button size="sm" variant="danger" onClick={() => { void fetchDashboardData(); }}>
            Reintentar
          </Button>
        </div>
      )}

      {/* Loading Skeleton inicial */}
      {isLoading && !data && (
        <div class="py-24 text-center space-y-3">
          <div class="inline-block animate-spin w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent"></div>
          <p class="text-xs text-slate-400">Cargando métricas y analíticas consolidadas...</p>
        </div>
      )}

      {/* Tarjetas de Métricas Principales */}
      {data && (
        <>
          <KpiCards />

          {/* Fila Principal: Gráfico + Top Productos */}
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div class="lg:col-span-8">
              <SalesChart />
            </div>
            <div class="lg:col-span-4">
              <TopProductsTable />
            </div>
          </div>

          {/* Fila Secundaria: Alertas de Stock */}
          <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div class="lg:col-span-12">
              <StockAlertsCard />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
