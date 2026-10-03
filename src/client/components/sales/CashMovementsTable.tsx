import type { CashMovementItem } from '../../../shared/sales-types.ts';
import { formatDateTime, formatMoney } from '../../format.ts';
import { countLabel, registerLabel } from '../../state/sales-labels.ts';
import { movementsFiltersSignal, movementsListSignal, pageSignal, setMovementsFilters, setPage } from '../../state/sales-state.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Pagination } from '../ui/Pagination.tsx';
import { Select } from '../ui/Select.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { amountClass } from './SaleBadges.tsx';

function signed(m: CashMovementItem): number {
  return m.direction === 'out' ? -m.amount : m.amount;
}

function concept(m: CashMovementItem): string {
  return m.count === undefined
    ? m.concept
    : `${m.concept} (esperado ${formatMoney(m.count.expected)}, contado ${formatMoney(m.count.counted)})`;
}

export function CashMovementsTable() {
  const list = movementsListSignal.value;
  const filters = movementsFiltersSignal.value;
  const items = list?.items ?? [];
  return (
    <div class="space-y-4">
      <FilterToolbar>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Tipo" value={filters.direction ?? ''} onChange={(e) => { const v = e.currentTarget.value; setMovementsFilters({ direction: v === 'in' || v === 'out' ? v : undefined }); }}>
            <option value="">Ingresos y egresos</option>
            <option value="in">Ingresos</option>
            <option value="out">Egresos</option>
          </Select>
          <Select label="Origen" value={filters.source ?? ''} onChange={(e) => { const v = e.currentTarget.value; setMovementsFilters({ source: v === 'manual' || v === 'count-adjustment' ? v : undefined }); }}>
            <option value="">Todos</option>
            <option value="manual">Manuales</option>
            <option value="count-adjustment">Ajustes por arqueo</option>
          </Select>
        </div>
      </FilterToolbar>
      <TableContainer>
        <div class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
          {list === null ? 'Cargando…' : `${countLabel(list.count, 'movimiento', 'movimientos')} · Neto ${formatMoney(list.netTotal)}`}
        </div>
        <Table>
          <Thead>
            <Tr><Th>Fecha</Th><Th>Caja</Th><Th>Tipo</Th><Th>Concepto</Th><Th>Descripción</Th><Th class="text-right">Importe</Th></Tr>
          </Thead>
          <Tbody>
            {items.map((m) => (
              <Tr key={m.id}>
                <Td>{formatDateTime(m.createdAt)}</Td>
                <Td>{registerLabel(m.branch, m.pointOfSale)}</Td>
                <Td>{m.direction === 'in' ? 'Ingreso' : m.direction === 'out' ? 'Egreso' : '—'}</Td>
                <Td>{concept(m)}</Td>
                <Td>{m.description ?? '—'}</Td>
                <Td class={`text-right font-semibold ${amountClass(signed(m))}`}>{formatMoney(signed(m))}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        {list !== null && items.length === 0 && <TableEmptyState message="No hay movimientos de caja con estos filtros" />}
        {list !== null && list.count > 0 && <Pagination page={pageSignal.value} pageSize={list.pageSize} count={list.count} onPage={setPage} />}
      </TableContainer>
    </div>
  );
}
