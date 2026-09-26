import {
  catalogSearchSignal,
  catalogCategoryFilterSignal,
  catalogBlockedFilterSignal,
  categoriesSignal,
  filteredProductsSignal,
  productsSignal,
  catalogLoadingSignal,
  fetchCatalog,
  openNewProductModal,
} from '../../state/catalog-state.ts';
import { Button } from '../ui/Button.tsx';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';

export function CatalogToolbar() {
  const search = catalogSearchSignal.value;
  const selectedCategory = catalogCategoryFilterSignal.value;
  const selectedBlocked = catalogBlockedFilterSignal.value;
  const categories = categoriesSignal.value;
  const filteredCount = filteredProductsSignal.value.length;
  const totalCount = productsSignal.value.length;
  const isLoading = catalogLoadingSignal.value;

  return (
    <FilterToolbar>
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Izquierda: Búsqueda rápida */}
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
            placeholder="Buscar por nombre, SKU o código de barra..."
            value={search}
            onInput={(e) => (catalogSearchSignal.value = (e.target as HTMLInputElement).value)}
            class="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => (catalogSearchSignal.value = '')}
              class="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Derecha: Botón Nuevo Producto y Refresco */}
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void fetchCatalog(); }}
            disabled={isLoading}
            title="Recargar catálogo"
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

          <Button size="sm" onClick={openNewProductModal} class="shadow-md shadow-indigo-600/20">
            <svg class="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Nuevo Producto
          </Button>
        </div>
      </div>

      {/* Barra de Filtros secundarios: Categoría, Estado y Conteo */}
      <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-400">
        <div class="flex flex-wrap items-center gap-2.5">
          {/* Selector de Categorías */}
          <div class="flex items-center gap-1.5">
            <span class="text-slate-500 dark:text-slate-400 font-medium">Categoría:</span>
            <select
              value={selectedCategory}
              onChange={(e) => (catalogCategoryFilterSignal.value = (e.target as HTMLSelectElement).value)}
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

          {/* Selector de Estado */}
          <div class="flex items-center gap-1.5">
            <span class="text-slate-500 dark:text-slate-400 font-medium">Estado:</span>
            <div class="inline-flex rounded-lg p-0.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => (catalogBlockedFilterSignal.value = 'all')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  selectedBlocked === 'all'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => (catalogBlockedFilterSignal.value = 'active')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  selectedBlocked === 'active'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Activos
              </button>
              <button
                type="button"
                onClick={() => (catalogBlockedFilterSignal.value = 'blocked')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  selectedBlocked === 'blocked'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Bloqueados
              </button>
            </div>
          </div>
        </div>

        {/* Contador */}
        <div class="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
          Mostrando <strong class="text-slate-800 dark:text-slate-200">{filteredCount}</strong> de {totalCount} productos
        </div>
      </div>
    </FilterToolbar>
  );
}
