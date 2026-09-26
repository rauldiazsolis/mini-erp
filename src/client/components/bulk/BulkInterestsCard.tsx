import {
  bulkInterestPercentSignal,
  bulkInterestDescriptionSignal,
  bulkInterestMinBalanceSignal,
  bulkInterestPreviewSignal,
  bulkInterestLoadingSignal,
  previewBulkInterests,
  applyBulkInterests,
} from '../../state/bulk-state.ts';
import { formatCurrency } from '../../state/dashboard-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Card } from '../ui/Card.tsx';
import { TableContainer, Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table.tsx';

export function BulkInterestsCard() {
  const percent = bulkInterestPercentSignal.value;
  const description = bulkInterestDescriptionSignal.value;
  const minBalance = bulkInterestMinBalanceSignal.value;
  const preview = bulkInterestPreviewSignal.value;
  const isLoading = bulkInterestLoadingSignal.value;

  return (
    <div class="space-y-6">
      {/* Panel de Configuración de Intereses */}
      <Card class="space-y-4">
        <div>
          <h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>📈 Devengamiento Masivo de Intereses</span>
          </h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Calcula y asienta automáticamente intereses por mora o financiación sobre cuentas corrientes deudoras
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          {/* Tasa % */}
          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Tasa de Interés (%) *</label>
            <input
              type="number"
              step="0.5"
              min="0.1"
              value={percent}
              onInput={(e) => (bulkInterestPercentSignal.value = parseFloat((e.target as HTMLInputElement).value) || 0)}
              class="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-amber-600 dark:text-amber-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Saldo Deudor Mínimo */}
          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Saldo Mínimo a Financiar ($ ARS)</label>
            <input
              type="number"
              step="500"
              min="0"
              value={minBalance}
              onInput={(e) => (bulkInterestMinBalanceSignal.value = parseFloat((e.target as HTMLInputElement).value) || 0)}
              class="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Concepto / Descripción */}
          <Input
            label="Concepto del Asiento Contable *"
            placeholder="Interés mensual por mora"
            value={description}
            onInput={(e) => (bulkInterestDescriptionSignal.value = (e.target as HTMLInputElement).value)}
          />
        </div>

        {/* Acciones */}
        <div class="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
          <div class="text-xs text-slate-500 dark:text-slate-400">
            Aplica un {percent}% a clientes cuyo saldo supere ${minBalance}. Se asentará en sus extractos.
          </div>
          <div class="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={previewBulkInterests}
              disabled={isLoading}
            >
              {isLoading && preview?.dryRun ? 'Calculando...' : '🔍 Simular Devengamiento'}
            </Button>

            {preview && preview.items.length > 0 && (
              <Button
                size="sm"
                onClick={applyBulkInterests}
                disabled={isLoading}
                class="bg-amber-600 hover:bg-amber-500 text-white"
              >
                {isLoading && !preview.dryRun ? 'Asentando...' : 'Confirmar Asiento Contable 📈'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Grilla de Previsualización */}
      {preview && (
        <TableContainer>
          <div class="p-4 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-slate-900 dark:text-white">
                {preview.dryRun ? 'Simulación de Devengamiento Contable' : 'Intereses Asentados'}
              </span>
              <span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-mono text-[11px] font-bold">
                {preview.affectedCount} cuentas • Total: {formatCurrency(preview.totalInterestAmount)}
              </span>
            </div>
          </div>

          <div class="overflow-x-auto max-h-96 overflow-y-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Cliente Deudor</Th>
                  <Th class="text-right w-36">Saldo Actual</Th>
                  <Th class="text-right w-36">Interés Calculado</Th>
                  <Th class="text-right w-36">Nuevo Saldo Deudor</Th>
                </Tr>
              </Thead>
              <Tbody>
                {preview.items.map((item) => (
                  <Tr key={item.customerId}>
                    <Td class="font-semibold text-slate-900 dark:text-white">{item.customerName}</Td>
                    <Td class="text-right font-mono text-slate-500 dark:text-slate-400">
                      {formatCurrency(item.currentBalance)}
                    </Td>
                    <Td class="text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                      +{formatCurrency(item.interestAmount)}
                    </Td>
                    <Td class="text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                      {formatCurrency(item.newBalance)}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        </TableContainer>
      )}
    </div>
  );
}
