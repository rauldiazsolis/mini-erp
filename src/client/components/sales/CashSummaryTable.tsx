import { formatDay, formatMoney } from '../../format.ts';
import { registerLabel } from '../../state/sales-labels.ts';
import { cashSummarySignal, openDaySummary } from '../../state/sales-state.ts';
import { CardList, CardRow, DesktopOnly } from '../ui/CardList.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { amountClass } from './SaleBadges.tsx';

/** Una fila por día y caja; el click abre el resumen del día, para comparar con el /RESUMEN del POS. */
export function CashSummaryTable() {
  const data = cashSummarySignal.value;
  const rows = data?.rows ?? [];
  return (
    <TableContainer>
      <CardList label="Resumen por día y caja">
        {rows.map((r) => (
          <CardRow
            key={`${r.day}|${r.branch ?? ''}|${r.pointOfSale ?? ''}`}
            onOpen={() => { openDaySummary(r); }}
            title={`${formatDay(r.day)} · ${registerLabel(r.branch, r.pointOfSale)}`}
            aside={<span class={amountClass(r.totalSold)}>{formatMoney(r.totalSold)}</span>}
            meta={`${String(r.ticketCount)} tickets · ${String(r.voidedCount)} anuladas · Cobranzas ${formatMoney(r.collectionsTotal)} · Efectivo neto ${formatMoney(r.cashNet)}`}
          />
        ))}
        {data !== null && rows.length > 0 && (
          <CardRow
            class="bg-slate-50 dark:bg-slate-950/40"
            title="Total"
            aside={formatMoney(data.totals.totalSold)}
            meta={`${String(data.totals.ticketCount)} tickets · ${String(data.totals.voidedCount)} anuladas · Efectivo neto ${formatMoney(data.totals.cashNet)}`}
          />
        )}
      </CardList>
      <DesktopOnly>
        <Table>
          <Thead>
            <Tr>
              <Th>Día</Th><Th>Caja</Th><Th class="text-right">Vendido</Th><Th class="text-right">Tickets</Th>
              <Th class="text-right">Anuladas</Th><Th class="text-right">Cobranzas</Th><Th class="text-right">Efectivo neto</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={`${r.day}|${r.branch ?? ''}|${r.pointOfSale ?? ''}`} class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => { openDaySummary(r); }}>
                <Td>{formatDay(r.day)}</Td>
                <Td>{registerLabel(r.branch, r.pointOfSale)}</Td>
                <Td class={`text-right font-semibold ${amountClass(r.totalSold)}`}>{formatMoney(r.totalSold)}</Td>
                <Td class="text-right">{r.ticketCount}</Td>
                <Td class="text-right">{r.voidedCount}</Td>
                <Td class={`text-right ${amountClass(r.collectionsTotal)}`}>{formatMoney(r.collectionsTotal)}</Td>
                <Td class={`text-right ${amountClass(r.cashNet)}`}>{formatMoney(r.cashNet)}</Td>
              </Tr>
            ))}
          </Tbody>
          {data !== null && rows.length > 0 && (
            <tfoot class="font-bold border-t-2 border-slate-200 dark:border-slate-700">
              <tr>
                <td class="px-4 py-3" colSpan={2}>Total</td>
                <td class="px-4 py-3 text-right">{formatMoney(data.totals.totalSold)}</td>
                <td class="px-4 py-3 text-right">{data.totals.ticketCount}</td>
                <td class="px-4 py-3 text-right">{data.totals.voidedCount}</td>
                <td class="px-4 py-3 text-right">{formatMoney(data.totals.collectionsTotal)}</td>
                <td class="px-4 py-3 text-right">{formatMoney(data.totals.cashNet)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </DesktopOnly>
      {data !== null && rows.length === 0 && <TableEmptyState message="No hay movimientos en este rango" />}
    </TableContainer>
  );
}
