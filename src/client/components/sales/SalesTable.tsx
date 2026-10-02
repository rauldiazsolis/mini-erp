import { PAYMENT_METHODS } from '../../../shared/payment-methods.ts';
import type { DocStatus, SaleKind } from '../../../shared/sales-types.ts';
import { formatDateTime, formatMoney } from '../../format.ts';
import { countLabel, customerLabel, methodLabel, registerLabel } from '../../state/sales-labels.ts';
import { openTicket, pageSignal, salesFiltersSignal, salesListSignal, salesLoadingSignal, setPage, setSalesFilters } from '../../state/sales-state.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Pagination } from '../ui/Pagination.tsx';
import { Select } from '../ui/Select.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { CustomerPicker } from './CustomerPicker.tsx';
import { SaleBadges, amountClass } from './SaleBadges.tsx';

const METHODS = [...PAYMENT_METHODS, 'other'] as const;
const KINDS: Array<{ id: SaleKind; label: string }> = [
  { id: 'sale', label: 'Ventas' },
  { id: 'return', label: 'Devoluciones' },
  { id: 'void', label: 'Anulaciones' },
];
const STATUSES: Array<{ id: DocStatus; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'valid', label: 'Vigentes' },
  { id: 'voided', label: 'Anuladas' },
];

const orUndefined = (value: string): string | undefined => (value === '' ? undefined : value);

export function SalesTable() {
  const list = salesListSignal.value;
  const filters = salesFiltersSignal.value;
  const items = list?.items ?? [];

  return (
    <div class="space-y-4">
      <FilterToolbar>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Select label="Medio de pago" value={filters.method ?? ''} onChange={(e) => { setSalesFilters({ method: orUndefined(e.currentTarget.value) }); }}>
            <option value="">Todos</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>{methodLabel(m)}</option>
            ))}
          </Select>
          <CustomerPicker id="ventas-clientes" value={filters.customerId} onChange={(customerId) => { setSalesFilters({ customerId }); }} />
          <Select
            label="Tipo"
            value={filters.kind ?? ''}
            onChange={(e) => { setSalesFilters({ kind: KINDS.find((k) => k.id === e.currentTarget.value)?.id }); }}
          >
            <option value="">Todos</option>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </Select>
          <Select
            label="Estado"
            value={filters.status}
            onChange={(e) => { setSalesFilters({ status: STATUSES.find((s) => s.id === e.currentTarget.value)?.id ?? 'all' }); }}
          >
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </div>
        {filters.productId !== undefined && (
          <button type="button" class="text-xs text-indigo-600 dark:text-indigo-400 cursor-pointer" onClick={() => { setSalesFilters({ productId: undefined }); }}>
            Solo tickets con el producto del ranking · quitar ✕
          </button>
        )}
      </FilterToolbar>

      <TableContainer>
        <div class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
          {list === null ? 'Cargando…' : `${countLabel(list.count, 'ticket', 'tickets')} · Total neto ${formatMoney(list.netTotal)}`}
          {salesLoadingSignal.value && list !== null && <span class="ml-2 text-xs text-slate-400">Actualizando…</span>}
        </div>
        <Table>
          <Thead>
            <Tr>
              <Th>Fecha</Th>
              <Th>Ticket</Th>
              <Th>Caja</Th>
              <Th>Cliente</Th>
              <Th>Medios</Th>
              <Th class="text-right">Total</Th>
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => (
              <Tr key={item.id} class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => { void openTicket(item.id); }}>
                <Td>{formatDateTime(item.createdAt)}</Td>
                <Td>
                  <span class="font-semibold">{item.ticket === undefined ? '—' : `#${String(item.ticket.number)}`}</span>{' '}
                  <SaleBadges kind={item.kind} voided={item.voided} />
                </Td>
                <Td>{registerLabel(item.branch, item.pointOfSale)}</Td>
                <Td>{customerLabel(item.customer)}</Td>
                <Td>{item.methods.map(methodLabel).join(', ')}</Td>
                <Td class={`text-right font-semibold ${amountClass(item.total)}`}>{formatMoney(item.total)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        {list !== null && items.length === 0 && <TableEmptyState message="No hay ventas con estos filtros" />}
        {list !== null && list.count > 0 && <Pagination page={pageSignal.value} pageSize={list.pageSize} count={list.count} onPage={setPage} />}
      </TableContainer>
    </div>
  );
}
