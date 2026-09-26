import {
  stockSearchSignal,
  stockCategoryFilterSignal,
  stockStatusFilterSignal,
  stockBranchFilterSignal,
  stockBranchesSignal,
  stockCategoriesSignal,
  filteredStockSignal,
  stockItemsSignal,
  stockLoadingSignal,
  fetchStockData,
} from '../../state/stock-state.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';

export function StockToolbar() {
  const search = stockSearchSignal.value;
  const category = stockCategoryFilterSignal.value;
  const status = stockStatusFilterSignal.value;
  const branchFilter = stockBranchFilterSignal.value;
  const branches = stockBranchesSignal.value;
  const categories = stockCategoriesSignal.value;
  const filteredCount = filteredStockSignal.value.length;
  const totalCount = stockItemsSignal.value.length;
  const isLoading = stockLoadingSignal.value;

  return (
    <FilterToolbar>
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Izquierda: Buscador */}
        <div class="relative flex-1 max-w-md">
          <svg
            class="w-4 h-4 absolute left-3.5 top-3 text-slate-400 dark:text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Buscar por artículo o SKU..."
            value={search}
            onInput={(e) => (stockSearchSignal.value = (e.target as HTMLInputElement).value)}
            class="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => (stockSearchSignal.value = '')}
              class="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Derecha: Botón de Refresco */}
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchStockData}
            disabled={isLoading}
            title="Recargar existencias"
            class="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-colors cursor-pointer disabled:opacity-50 border border-slate-200 dark:border-slate-700/80"
          >
            <svg
              class={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-500 dark:text-indigo-400' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Filtros secundarios: Categoría, Estado y Sucursal */}
      <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-400">
        <div class="flex flex-wrap items-center gap-3">
          {/* Selector de Categoría */}
          <div class="flex items-center gap-1.5">
            <span class="text-slate-500 dark:text-slate-400 font-medium">Categoría:</span>
            <select
              value={category}
              onChange={(e) => (stockCategoryFilterSignal.value = (e.target as HTMLSelectElement).value)}
              class="px-2.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="all">Todas ({totalCount})</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de Sucursal */}
          {branches.length > 1 && (
            <div class="flex items-center gap-1.5">
              <span class="text-slate-500 dark:text-slate-400 font-medium">Sucursal:</span>
              <select
                value={branchFilter}
                onChange={(e) => (stockBranchFilterSignal.value = (e.target as HTMLSelectElement).value)}
                class="px-2.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="all">Todas las sucursales</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Filtro de Alerta de Existencias */}
          <div class="flex items-center gap-1.5">
            <span class="text-slate-500 dark:text-slate-400 font-medium">Nivel:</span>
            <div class="inline-flex rounded-lg p-0.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => (stockStatusFilterSignal.value = 'all')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  status === 'all'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => (stockStatusFilterSignal.value = 'out')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  status === 'out'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Agotados (0)
              </button>
              <button
                type="button"
                onClick={() => (stockStatusFilterSignal.value = 'low')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  status === 'low'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Stock Bajo (≤ 5)
              </button>
              <button
                type="button"
                onClick={() => (stockStatusFilterSignal.value = 'normal')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  status === 'normal'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Normal (&gt; 5)
              </button>
            </div>
          </div>
        </div>

        {/* Contador */}
        <div class="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
          Mostrando <strong class="text-slate-800 dark:text-slate-200">{filteredCount}</strong> de {totalCount} artículos
        </div>
      </div>
    </FilterToolbar>
  );
}
