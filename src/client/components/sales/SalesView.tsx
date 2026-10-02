import { salesErrorSignal, salesTabSignal } from '../../state/sales-state.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { SalesRangeBar } from './SalesRangeBar.tsx';
import { SalesTable } from './SalesTable.tsx';
import { SalesTabs } from './SalesTabs.tsx';
import { TicketDrawer } from './TicketDrawer.tsx';

export function SalesView() {
  const tab = salesTabSignal.value;
  const error = salesErrorSignal.value;
  return (
    <div class="space-y-6">
      <PageHeader title="Ventas & Caja" description="Ventas, cobranzas, movimientos y el resumen de cada caja, tal como los manda el POS." />
      <SalesTabs />
      <SalesRangeBar />
      {error !== null && (
        <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}
      {tab === 'sales' && <SalesTable />}
      {/* El ticket va último: se abre también desde el resumen del día (Tarea 10) */}
      <TicketDrawer />
    </div>
  );
}
