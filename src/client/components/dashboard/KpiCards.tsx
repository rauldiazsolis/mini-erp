import {
  dashboardDataSignal,
  formatCurrency,
  formatNumber,
} from '../../state/dashboard-state.ts';
import { Card } from '../ui/Card.tsx';

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
      <Card class="relative overflow-hidden bg-gradient-to-br from-slate-900 to-indigo-950/40 border-indigo-500/20">
        <div class="flex items-center justify-between text-slate-400 mb-2">
          <span class="text-xs font-semibold uppercase tracking-wider">Facturación Total</span>
          <div class="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>

        <div class="text-2xl lg:text-3xl font-black text-white tracking-tight">
          {formatCurrency(totalSales)}
        </div>

        <div class="flex items-center gap-1.5 mt-2">
          <span
            class={`inline-flex items-center text-xs font-bold px-1.5 py-0.5 rounded-md ${
              isPositiveChange
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-rose-500/15 text-rose-400'
            }`}
          >
            {isPositiveChange ? '↑ +' : '↓ '}
            {changePercentage}%
          </span>
          <span class="text-[11px] text-slate-400">vs período anterior</span>
        </div>
      </Card>

      {/* 2. Tickets Emitidos */}
      <Card class="relative overflow-hidden bg-slate-900/80">
        <div class="flex items-center justify-between text-slate-400 mb-2">
          <span class="text-xs font-semibold uppercase tracking-wider">Tickets Emitidos</span>
          <div class="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center border border-purple-500/20">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        </div>

        <div class="text-2xl lg:text-3xl font-black text-white tracking-tight">
          {formatNumber(salesCount)}
        </div>

        <div class="text-[11px] text-slate-400 mt-2">
          Transacciones cerradas en caja
        </div>
      </Card>

      {/* 3. Ticket Promedio */}
      <Card class="relative overflow-hidden bg-slate-900/80">
        <div class="flex items-center justify-between text-slate-400 mb-2">
          <span class="text-xs font-semibold uppercase tracking-wider">Ticket Promedio</span>
          <div class="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
        </div>

        <div class="text-2xl lg:text-3xl font-black text-white tracking-tight">
          {formatCurrency(averageTicket)}
        </div>

        <div class="text-[11px] text-slate-400 mt-2">
          Gasto medio por cliente en compra
        </div>
      </Card>

      {/* 4. Deuda Cuentas Corrientes */}
      <Card class="relative overflow-hidden bg-gradient-to-br from-slate-900 to-amber-950/30 border-amber-500/20">
        <div class="flex items-center justify-between text-slate-400 mb-2">
          <span class="text-xs font-semibold text-amber-400 uppercase tracking-wider">
            Deuda en Cuenta Cte
          </span>
          <div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
        </div>

        <div class="text-2xl lg:text-3xl font-black text-amber-300 tracking-tight">
          {formatCurrency(totalReceivables)}
        </div>

        <div class="flex items-center gap-1.5 mt-2 text-[11px] text-amber-400/90 font-medium">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
          <span>{debtorCount} clientes con saldo pendiente</span>
        </div>
      </Card>
    </div>
  );
}
