import { customerStatsSignal } from '../../state/customer-state.ts';
import { StatCard } from '../ui/StatCard.tsx';
import { formatMoney, formatQty } from '../../format.ts';

export function CustomerStatsBar() {
  const stats = customerStatsSignal.value;
  const debtorPercentage = stats.totalCustomers > 0 ? Math.round((stats.totalDebtors / stats.totalCustomers) * 100) : 0;

  return (
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Total Clientes */}
      <StatCard
        title="Total Clientes"
        value={formatQty(stats.totalCustomers)}
        subtitle="En cartera registrada"
        icon={<span>👥</span>}
        variant="primary"
      />

      {/* Clientes con Deuda */}
      <StatCard
        title="Clientes Deudores"
        value={formatQty(stats.totalDebtors)}
        subtitle={`${String(debtorPercentage)}% de la cartera activa`}
        icon={<span>⚠️</span>}
        variant="warning"
      />

      {/* Saldo Deudor Total Consolidado */}
      <StatCard
        title="Deuda Total en Cta. Cte."
        value={formatMoney(stats.totalDebtAmount)}
        subtitle="Saldo pendiente de cobro"
        icon={<span>💳</span>}
        variant="danger"
      />
    </div>
  );
}
