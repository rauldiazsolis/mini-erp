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
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <span>🏷️ Parámetros de Actualización Masiva</span>
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">
            Ajusta los precios de tus productos de forma porcentual o con importe fijo, con previsualización segura antes de confirmar
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          {/* Acción */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">Tipo de Aumento *</label>
            <div class="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => (bulkPriceActionSignal.value = 'percentage')}
                class={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  action === 'percentage' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Porcentual (%)
              </button>
              <button
                type="button"
                onClick={() => (bulkPriceActionSignal.value = 'fixed')}
                class={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  action === 'fixed' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Fijo ($ ARS)
              </button>
            </div>
          </div>

          {/* Valor */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">
              {action === 'percentage' ? 'Porcentaje de aumento (%) *' : 'Monto a sumar ($ ARS) *'}
            </label>
            <input
              type="number"
              step={action === 'percentage' ? '1' : '50'}
              value={val}
              onInput={(e) => (bulkPriceValueSignal.value = parseFloat((e.target as HTMLInputElement).value) || 0)}
              class="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono font-bold text-emerald-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Categoría */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">Filtrar por Categoría</label>
            <select
              value={category}
              onChange={(e) => (bulkPriceCategorySignal.value = (e.target as HTMLSelectElement).value)}
              class="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="all">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Redondeo */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">Estrategia de Redondeo</label>
            <select
              value={rounding}
              onChange={(e) => (bulkPriceRoundingSignal.value = (e.target as HTMLSelectElement).value as RoundingStrategy)}
              class="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              {ROUNDING_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Acciones */}
        <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between">
          <div class="text-xs text-slate-400">
            {action === 'percentage'
              ? `Aplicará un incremento del +${val}% sobre el precio base actual.`
              : `Sumará +$${val} a cada artículo seleccionado.`}
          </div>
          <div class="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={previewBulkPrices}
              disabled={isLoading}
            >
              {isLoading && preview?.dryRun ? 'Simulando...' : '🔍 Simular Impacto (Preview)'}
            </Button>

            {preview && preview.items.length > 0 && (
              <Button
                size="sm"
                onClick={applyBulkPrices}
                disabled={isLoading}
                class="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                {isLoading && !preview.dryRun ? 'Aplicando...' : 'Confirmar y Guardar en Catálogo 🚀'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Grilla de Previsualización (Preview) */}
      {preview && (
        <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col animate-in fade-in duration-150">
          <div class="p-4 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-white">
                {preview.dryRun ? 'Previsualización de Impacto (Simulación Segura)' : 'Precios Aplicados'}
              </span>
              <span class="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono text-[11px] font-bold">
                {preview.affectedCount} artículos afectados
              </span>
            </div>
          </div>

          <div class="overflow-x-auto max-h-96 overflow-y-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead class="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-bold tracking-wider text-slate-400 select-none">
                <tr>
                  <th class="py-2.5 px-4 w-28">SKU</th>
                  <th class="py-2.5 px-4">Producto</th>
                  <th class="py-2.5 px-4 w-32">Categoría</th>
                  <th class="py-2.5 px-4 text-right w-28">Precio Anterior</th>
                  <th class="py-2.5 px-4 text-right w-28">Nuevo Precio</th>
                  <th class="py-2.5 px-4 text-right w-24">Variación</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60 font-sans">
                {preview.items.map((item) => (
                  <tr key={item.id} class="hover:bg-slate-800/30 transition-colors">
                    <td class="py-2.5 px-4 font-mono text-[11px] text-slate-400">{item.sku}</td>
                    <td class="py-2.5 px-4 font-semibold text-white">{item.name}</td>
                    <td class="py-2.5 px-4 text-slate-300">{item.category}</td>
                    <td class="py-2.5 px-4 text-right font-mono text-slate-400">{formatCurrency(item.oldPrice)}</td>
                    <td class="py-2.5 px-4 text-right font-mono font-bold text-emerald-400">
                      {formatCurrency(item.newPrice)}
                    </td>
                    <td class="py-2.5 px-4 text-right font-mono text-[11px] text-indigo-300">
                      +{formatCurrency(item.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
