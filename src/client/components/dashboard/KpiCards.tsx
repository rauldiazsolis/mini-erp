import {
  dashboardDataSignal,
  formatCurrency,
  formatNumber,
} from '../../state/dashboard-state.ts';
import { StatCard } from '../ui/StatCard.tsx';

export function KpiCards() {
  const data = dashboardDataSignal.value;
  const summary = data?.summary;

  const totalSales = summary?.totalSales ?? 0;
  const salesCount = summary?.salesCount ?? 0;
  const averageTicket = summary?.averageTicket ?? 0;
  const changePercentage = summary?.changePercentage ?? 0;
  const totalReceivables = summary?.totalReceivables ?? 0;
  const debtorCount = summary?.debtorCount ?? 0;

  const isPositiveChange = changePercentage >= 0;

  return (
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Facturación */}
      <StatCard
        title="Facturación Total"
        value={formatCurrency(totalSales)}
        variant="primary"
        icon={
          <svg class="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
        subtitle={
          <div class="flex items-center gap-1.5">
            <span
              class={`inline-flex items-center text-xs font-bold px-1.5 py-0.5 rounded-md ${
                isPositiveChange
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
              }`}
            >
              {isPositiveChange ? '↑ +' : '↓ '}
              {changePercentage}%
            </span>
            <span>vs período anterior</span>
          </div>
        }
      />

      {/* 2. Tickets Emitidos */}
      <StatCard
        title="Tickets Emitidos"
        value={formatNumber(salesCount)}
        variant="default"
        icon={
          <svg class="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        }
        subtitle="Transacciones cerradas en caja"
      />

      {/* 3. Ticket Promedio */}
      <StatCard
        title="Ticket Promedio"
        value={formatCurrency(averageTicket)}
        variant="default"
        icon={
          <svg class="w-4 h-4 text-cyan-600 dark:text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        }
        subtitle="Gasto medio por cliente en compra"
      />

      {/* 4. Deuda Cuentas Corrientes */}
      <StatCard
        title="Deuda en Cuenta Cte"
        value={formatCurrency(totalReceivables)}
        variant="warning"
        icon={
          <svg class="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
        }
        subtitle={
          <div class="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
            <span>{debtorCount} clientes con saldo pendiente</span>
          </div>
        }
      />
    </div>
  );
}
