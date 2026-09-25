import { customerStatsSignal } from '../../state/customer-state.ts';
import { formatCurrency, formatNumber } from '../../state/dashboard-state.ts';

export function CustomerStatsBar() {
  const stats = customerStatsSignal.value;
  const debtorPercentage = stats.totalCustomers > 0 ? Math.round((stats.totalDebtors / stats.totalCustomers) * 100) : 0;

  return (
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Total Clientes */}
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex items-center justify-between">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Clientes</div>
          <div class="text-2xl font-black text-white mt-1 font-mono">{formatNumber(stats.totalCustomers)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">En cartera registrada</div>
        </div>
        <div class="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-lg border border-indigo-500/20">
          👥
        </div>
      </div>

      {/* Clientes con Deuda */}
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex items-center justify-between">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Clientes Deudores</div>
          <div class="text-2xl font-black text-amber-400 mt-1 font-mono">{formatNumber(stats.totalDebtors)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">{debtorPercentage}% de la cartera activa</div>
        </div>
        <div class="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center text-lg border border-amber-500/20">
          ⚠️
        </div>
      </div>

      {/* Saldo Deudor Total Consolidado */}
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex items-center justify-between">
        <div>
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Deuda Total en Cta. Cte.</div>
          <div class="text-2xl font-black text-rose-400 mt-1 font-mono">{formatCurrency(stats.totalDebtAmount)}</div>
          <div class="text-[11px] text-slate-500 mt-0.5">Saldo pendiente de cobro</div>
        </div>
        <div class="w-10 h-10 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center text-lg border border-rose-500/20">
          💳
        </div>
      </div>
    </div>
  );
}
