import { salesErrorSignal, salesTabSignal } from '../../state/sales-state.ts';
import { routeFilters } from '../../state/route-state.ts';
import { foldedFilterCount } from '../../routing/admin-routes.ts';
import { FoldedFilters } from '../ui/FoldedFilters.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { CashMovementsTable, MovementsFiltersBar } from './CashMovementsTable.tsx';
import { CashSummaryTable } from './CashSummaryTable.tsx';
import { DaySummaryDrawer } from './DaySummaryDrawer.tsx';
import { PaymentDrawer } from './PaymentDrawer.tsx';
import { PaymentsFiltersBar, PaymentsTable } from './PaymentsTable.tsx';
import { RangePresets, SalesRangeBar } from './SalesRangeBar.tsx';
import { SalesFiltersBar, SalesTable } from './SalesTable.tsx';
import { SalesTabs } from './SalesTabs.tsx';
import { TicketDrawer } from './TicketDrawer.tsx';

export function SalesView() {
  const tab = salesTabSignal.value;
  const error = salesErrorSignal.value;
  return (
    <div class="space-y-6">
      <PageHeader title="Ventas & Caja" description="Ventas, cobranzas, movimientos y el resumen de cada caja, tal como los manda el POS." />
      <SalesTabs />
      {/* En el teléfono: los rangos rápidos y "Filtros (n)"; el resto en un panel (#90) */}
      <FoldedFilters id="sales" active={foldedFilterCount('sales', routeFilters('sales'))} quick={<RangePresets />}>
        <div class="space-y-4">
          <SalesRangeBar />
          {tab === 'sales' && <SalesFiltersBar />}
          {tab === 'payments' && <PaymentsFiltersBar />}
          {tab === 'movements' && <MovementsFiltersBar />}
        </div>
      </FoldedFilters>
      {error !== null && (
        <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}
      {tab === 'sales' && <SalesTable />}
      {tab === 'payments' && <PaymentsTable />}
      {tab === 'movements' && <CashMovementsTable />}
      {tab === 'summary' && <CashSummaryTable />}
      <PaymentDrawer />
      <DaySummaryDrawer />
      {/* El ticket va último: se abre también desde el resumen del día */}
      <TicketDrawer />
    </div>
  );
}
