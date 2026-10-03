import { PAYMENT_METHODS } from '../../../shared/payment-methods.ts';
import type { DocStatus } from '../../../shared/sales-types.ts';
import { formatDateTime, formatMoney } from '../../format.ts';
import { countLabel, customerLabel, methodLabel, registerLabel } from '../../state/sales-labels.ts';
import { openPayment, pageSignal, paymentsFiltersSignal, paymentsListSignal, setPage, setPaymentsFilters } from '../../state/sales-state.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Pagination } from '../ui/Pagination.tsx';
import { Select } from '../ui/Select.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { CustomerPicker } from './CustomerPicker.tsx';
import { SaleBadges, amountClass } from './SaleBadges.tsx';

// La cobranza nunca es a cuenta corriente (contrato): sin `account`
const METHODS = [...PAYMENT_METHODS.filter((m) => m !== 'account'), 'other'];
const STATUSES: Array<{ id: DocStatus; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'valid', label: 'Vigentes' },
  { id: 'voided', label: 'Anuladas' },
];

export function PaymentsTable() {
  const list = paymentsListSignal.value;
  const filters = paymentsFiltersSignal.value;
  const items = list?.items ?? [];
  return (
    <div class="space-y-4">
      <FilterToolbar>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select label="Medio de pago" value={filters.method ?? ''} onChange={(e) => { const v = e.currentTarget.value; setPaymentsFilters({ method: v === '' ? undefined : v }); }}>
            <option value="">Todos</option>
            {METHODS.map((m) => (<option key={m} value={m}>{methodLabel(m)}</option>))}
          </Select>
          <CustomerPicker id="cobranzas-clientes" value={filters.customerId} onChange={(customerId) => { setPaymentsFilters({ customerId }); }} />
          <Select label="Estado" value={filters.status} onChange={(e) => { setPaymentsFilters({ status: STATUSES.find((s) => s.id === e.currentTarget.value)?.id ?? 'all' }); }}>
            {STATUSES.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
          </Select>
        </div>
      </FilterToolbar>
      <TableContainer>
        <div class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
          {list === null ? 'Cargando…' : `${countLabel(list.count, 'cobranza', 'cobranzas')} · Total neto ${formatMoney(list.netTotal)}`}
        </div>
        <Table>
          <Thead>
            <Tr><Th>Fecha</Th><Th>Recibo</Th><Th>Caja</Th><Th>Cliente</Th><Th>Medios</Th><Th class="text-right">Total</Th></Tr>
          </Thead>
          <Tbody>
            {items.map((p) => (
              <Tr key={p.id} class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => { openPayment(p.id); }}>
                <Td>{formatDateTime(p.createdAt)}</Td>
                <Td>
                  <span class="font-semibold">{p.receipt === undefined ? '—' : `#${String(p.receipt.number)}`}</span>{' '}
                  <SaleBadges voided={p.voided} isVoid={p.voidsPaymentId !== undefined} />
                </Td>
                <Td>{registerLabel(p.branch, p.pointOfSale)}</Td>
                <Td>{customerLabel(p.customer)}</Td>
                <Td>{[...new Set(p.payments.map((x) => methodLabel(x.method)))].join(', ')}</Td>
                <Td class={`text-right font-semibold ${amountClass(p.total)}`}>{formatMoney(p.total)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        {list !== null && items.length === 0 && <TableEmptyState message="No hay cobranzas con estos filtros" />}
        {list !== null && list.count > 0 && <Pagination page={pageSignal.value} pageSize={list.pageSize} count={list.count} onPage={setPage} />}
      </TableContainer>
    </div>
  );
}
