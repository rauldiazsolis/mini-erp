import {
  selectedPeriodSignal,
  selectedBranchSignal,
  branchesListSignal,
  dashboardLoadingSignal,
  fetchDashboardData,
  type DashboardPeriod,
} from '../../state/dashboard-state.ts';
import { Button } from '../ui/Button.tsx';

const periods: { id: DashboardPeriod; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Últimos 7 días' },
  { id: 'month', label: 'Últimos 30 días' },
];

export function DashboardFilters() {
  const currentPeriod = selectedPeriodSignal.value;
  const currentBranch = selectedBranchSignal.value;
  const branches = branchesListSignal.value;
  const isLoading = dashboardLoadingSignal.value;

  return (
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 backdrop-blur shadow-sm dark:shadow-none transition-colors">
      {/* Selector de Período (Pills) */}
      <div class="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800">
        {periods.map((p) => {
          const isActive = currentPeriod === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => (selectedPeriodSignal.value = p.id)}
              class={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-800/60'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Selector de Sucursal y Botón de Refresco */}
      <div class="flex items-center gap-3">
        {branches.length > 0 && (
          <div class="relative min-w-44">
            <select
              value={currentBranch}
              onChange={(e) => (selectedBranchSignal.value = (e.target as HTMLSelectElement).value)}
              class="w-full appearance-none px-3.5 py-1.5 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-8 cursor-pointer"
            >
              <option value="">Todas las sucursales</option>
              {branches.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
            <div class="pointer-events-none absolute right-3 top-2 text-slate-400">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          loading={isLoading}
          onClick={() => fetchDashboardData()}
          title="Refrescar métricas"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          <span class="hidden sm:inline">Actualizar</span>
        </Button>
      </div>
    </div>
  );
}
