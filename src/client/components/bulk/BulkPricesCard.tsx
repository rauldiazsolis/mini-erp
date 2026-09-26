import {
  bulkPriceActionSignal,
  bulkPriceValueSignal,
  bulkPriceCategorySignal,
  bulkPriceRoundingSignal,
  bulkPricePreviewSignal,
  bulkPriceLoadingSignal,
  previewBulkPrices,
  applyBulkPrices,
  type RoundingStrategy,
} from '../../state/bulk-state.ts';
import { categoriesSignal } from '../../state/catalog-state.ts';
import { formatCurrency } from '../../state/dashboard-state.ts';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { Select } from '../ui/Select.tsx';
import { TableContainer, Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table.tsx';

const ROUNDING_OPTIONS: Array<{ value: RoundingStrategy; label: string }> = [
  { value: 'none', label: 'Sin redondeo (Centavos exactos)' },
  { value: '10', label: 'Al múltiplo de $10 más cercano' },
  { value: '50', label: 'Al múltiplo de $50 más cercano' },
  { value: '100', label: 'Al múltiplo de $100 más cercano' },
];

export function BulkPricesCard() {
  const action = bulkPriceActionSignal.value;
  const val = bulkPriceValueSignal.value;
  const category = bulkPriceCategorySignal.value;
  const rounding = bulkPriceRoundingSignal.value;
  const preview = bulkPricePreviewSignal.value;
  const isLoading = bulkPriceLoadingSignal.value;
  const categories = categoriesSignal.value;

  return (
    <div class="space-y-6">
      {/* Panel de Configuración */}
      <Card class="space-y-4">
        <div>
          <h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>🏷️ Parámetros de Actualización Masiva</span>
          </h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Ajusta los precios de tus productos de forma porcentual o con importe fijo, con previsualización segura antes de confirmar
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          {/* Acción */}
          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Tipo de Aumento *</label>
            <div class="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => (bulkPriceActionSignal.value = 'percentage')}
                class={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  action === 'percentage'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Porcentual (%)
              </button>
              <button
                type="button"
                onClick={() => (bulkPriceActionSignal.value = 'fixed')}
                class={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  action === 'fixed'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Fijo ($ ARS)
              </button>
            </div>
          </div>

          {/* Valor */}
          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {action === 'percentage' ? 'Porcentaje de aumento (%) *' : 'Monto a sumar ($ ARS) *'}
            </label>
            <input
              type="number"
              step={action === 'percentage' ? '1' : '50'}
              value={val}
              onInput={(e) => (bulkPriceValueSignal.value = parseFloat((e.target as HTMLInputElement).value) || 0)}
              class="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Categoría */}
          <div>
            <Select
              label="Filtrar por Categoría"
              value={category}
              onChange={(e) => (bulkPriceCategorySignal.value = (e.target as HTMLSelectElement).value)}
            >
              <option value="all">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>

          {/* Redondeo */}
          <div>
            <Select
              label="Estrategia de Redondeo"
              value={rounding}
              onChange={(e) => (bulkPriceRoundingSignal.value = (e.target as HTMLSelectElement).value as RoundingStrategy)}
            >
              {ROUNDING_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Acciones */}
        <div class="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
          <div class="text-xs text-slate-500 dark:text-slate-400">
            {action === 'percentage'
              ? `Aplicará un incremento del +${String(val)}% sobre el precio base actual.`
              : `Sumará +$${String(val)} a cada artículo seleccionado.`}
          </div>
          <div class="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void previewBulkPrices(); }}
              disabled={isLoading}
            >
              {isLoading && preview?.dryRun ? 'Simulando...' : '🔍 Simular Impacto (Preview)'}
            </Button>

            {preview && preview.items.length > 0 && (
              <Button
                size="sm"
                onClick={() => { void applyBulkPrices(); }}
                disabled={isLoading}
                class="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {isLoading && !preview.dryRun ? 'Aplicando...' : 'Confirmar y Guardar en Catálogo 🚀'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Grilla de Previsualización (Preview) */}
      {preview && (
        <TableContainer>
          <div class="p-4 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-slate-900 dark:text-white">
                {preview.dryRun ? 'Previsualización de Impacto (Simulación Segura)' : 'Precios Aplicados'}
              </span>
              <span class="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-mono text-[11px] font-bold">
                {preview.affectedCount} artículos afectados
              </span>
            </div>
          </div>

          <div class="overflow-x-auto max-h-96 overflow-y-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th class="w-28">SKU</Th>
                  <Th>Producto</Th>
                  <Th class="w-32">Categoría</Th>
                  <Th class="text-right w-28">Precio Anterior</Th>
                  <Th class="text-right w-28">Nuevo Precio</Th>
                  <Th class="text-right w-24">Variación</Th>
                </Tr>
              </Thead>
              <Tbody>
                {preview.items.map((item) => (
                  <Tr key={item.id}>
                    <Td class="font-mono text-[11px] text-slate-500 dark:text-slate-400">{item.sku}</Td>
                    <Td class="font-semibold text-slate-900 dark:text-white">{item.name}</Td>
                    <Td class="text-slate-600 dark:text-slate-300">{item.category}</Td>
                    <Td class="text-right font-mono text-slate-500 dark:text-slate-400">{formatCurrency(item.oldPrice)}</Td>
                    <Td class="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(item.newPrice)}
                    </Td>
                    <Td class="text-right font-mono text-[11px] text-indigo-600 dark:text-indigo-300">
                      +{formatCurrency(item.diff)}
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
