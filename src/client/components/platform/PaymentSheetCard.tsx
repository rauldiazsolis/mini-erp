import {
  sheetTextSignal,
  sheetRowsSignal,
  sheetAppliedSignal,
  sheetBusySignal,
  platformPaymentsSignal,
  previewSheet,
  applySheet,
  loadSheetFile,
  sheetSummary,
} from '../../state/platform-state.ts';
import { formatDateTime, formatDay, formatMoney } from '../../format.ts';
import { Card, CardHeader } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import type { SheetResultRow } from '../../../shared/credits-types.ts';

function rowStatus(row: SheetResultRow, applied: boolean) {
  if (row.status === 'ok') {
    return <span class="text-emerald-600 dark:text-emerald-400 font-semibold">{applied ? 'Registrado' : 'Se registra'}</span>;
  }
  if (row.status === 'duplicate') return <span class="text-slate-500 dark:text-slate-400">Ya registrado</span>;
  return <span class="text-rose-600 dark:text-rose-400 font-semibold">{row.message ?? 'Error'}</span>;
}

function setText(text: string): void {
  sheetTextSignal.value = text;
  sheetRowsSignal.value = null;
  sheetAppliedSignal.value = false;
}

function SheetRows() {
  const rows = sheetRowsSignal.value;
  if (rows === null) return null;
  const applied = sheetAppliedSignal.value;
  return (
    <div class="space-y-3">
      <p class="text-sm font-semibold text-slate-700 dark:text-slate-300">{sheetSummary(rows, applied)}</p>
      <div class="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
        <Table>
          <Thead>
            <Tr>
              <Th>Línea</Th>
              <Th>Comercio</Th>
              <Th>Fecha</Th>
              <Th class="text-right">Importe</Th>
              <Th>Info</Th>
              <Th>Estado</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.line}>
                <Td>{r.line}</Td>
                <Td>{r.tenantName ?? r.tenantId ?? ''}</Td>
                <Td>{r.day === undefined ? '' : formatDay(r.day)}</Td>
                <Td class="text-right">{r.amount === undefined ? '' : formatMoney(r.amount)}</Td>
                <Td>{r.info ?? ''}</Td>
                <Td>{rowStatus(r, applied)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}

function PaymentsList() {
  const items = platformPaymentsSignal.value;
  return (
    <TableContainer>
      <div class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
        Pagos registrados
      </div>
      {items.length === 0 ? (
        <TableEmptyState message="Todavía no hay pagos registrados" />
      ) : (
        <div class="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Fecha</Th>
                <Th>Comercio</Th>
                <Th>Titular</Th>
                <Th class="text-right">Importe</Th>
                <Th>Info</Th>
                <Th>Registró</Th>
                <Th>Cargado</Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((p) => (
                <Tr key={p.id}>
                  <Td>{formatDay(p.day)}</Td>
                  <Td>{p.tenantName ?? p.tenantId ?? '—'}</Td>
                  <Td>{p.holderName}</Td>
                  <Td class="text-right font-semibold">{formatMoney(p.amount)}</Td>
                  <Td>{p.info ?? ''}</Td>
                  <Td>{p.createdByName ?? ''}</Td>
                  <Td>
                    {formatDateTime(p.createdAt)} · {p.fromSheet ? 'planilla' : 'a mano'}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </TableContainer>
  );
}

/** Planilla de cobranzas (#21): se pega o se sube un CSV, se previsualiza y se registra. */
export function PaymentSheetCard() {
  const rows = sheetRowsSignal.value;
  const applied = sheetAppliedSignal.value;
  const busy = sheetBusySignal.value;
  const canApply = rows !== null && !applied && rows.some((r) => r.status === 'ok');
  return (
    <div class="space-y-6">
      <Card class="space-y-4">
        <CardHeader
          title="Planilla de cobranzas"
          description="La primera línea es el encabezado fecha;comercio;importe;info y después, una fila por pago. La fecha va como DD/MM/AAAA o AAAA-MM-DD y el comercio, por su identificador. Volver a subir la misma planilla no registra dos veces."
        />
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Archivo CSV"
          class="block text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-xl file:border-0 file:bg-indigo-50 file:text-indigo-700 dark:file:bg-slate-800 dark:file:text-indigo-300 file:font-semibold file:cursor-pointer"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file !== undefined) void loadSheetFile(file);
          }}
        />
        <textarea
          aria-label="Planilla"
          rows={6}
          value={sheetTextSignal.value}
          placeholder={'fecha;comercio;importe;info\n05/10/2026;kiosco-centro;15000;transferencia 123\n2026-10-06;almacen-sur;8000;'}
          onInput={(e) => { setText(e.currentTarget.value); }}
          class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div class="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy} disabled={sheetTextSignal.value.trim() === ''} onClick={() => void previewSheet()}>
            Vista previa
          </Button>
          <Button loading={busy} disabled={!canApply} onClick={() => void applySheet()}>
            Registrar
          </Button>
        </div>
        <SheetRows />
      </Card>
      <PaymentsList />
    </div>
  );
}
