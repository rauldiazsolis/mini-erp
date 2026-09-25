import {
  filteredStockSignal,
  stockBranchesSignal,
  stockLoadingSignal,
  openAdjustModal,
  openKardex,
} from '../../state/stock-state.ts';
import { formatNumber } from '../../state/dashboard-state.ts';

export function StockMatrixTable() {
  const stockItems = filteredStockSignal.value;
  const branches = stockBranchesSignal.value;
  const isLoading = stockLoadingSignal.value;

  if (isLoading && stockItems.length === 0) {
    return (
      <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div class="p-8 text-center text-xs text-slate-400 space-y-3">
          <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div>Cargando matriz de existencias por sucursal...</div>
        </div>
      </div>
    );
  }

  if (stockItems.length === 0) {
    return (
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-sm">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-slate-800/80 text-slate-400 flex items-center justify-center text-2xl mb-3">
          📦
        </div>
        <h4 class="text-sm font-bold text-white">No hay existencias para los filtros seleccionados</h4>
        <p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
          Prueba cambiando el nivel de alerta o el término de búsqueda.
        </p>
      </div>
    );
  }

  return (
    <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col">
      {/* Tip de la matriz */}
      <div class="px-4 py-2 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
        <div class="flex items-center gap-1.5">
          <span class="text-indigo-400 font-bold">💡 Tip Matriz Multi-Sucursal:</span>
          <span>Haz clic en la cantidad de cualquier sucursal para ajustar el stock de esa ubicación de forma auditada.</span>
        </div>
        <div class="font-mono text-slate-500">
          Sucursales activas: {branches.length}
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-slate-950/80 border-b border-slate-800 text-[10px] uppercase font-bold tracking-wider text-slate-400 select-none">
              <th class="py-3 px-4 w-28">SKU</th>
              <th class="py-3 px-4 min-w-[200px]">Artículo / Descripción</th>
              <th class="py-3 px-4 w-32">Categoría</th>
              
              {/* Columnas Dinámicas por Sucursal */}
              {branches.map((b) => (
                <th key={b.id} class="py-3 px-3 text-center w-28 text-indigo-300 font-mono">
                  {b.code}
                </th>
              ))}

              <th class="py-3 px-4 w-32 text-center">Total Consolidado</th>
              <th class="py-3 px-4 w-28 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60 font-sans">
            {stockItems.map((item) => {
              const isOut = item.tracksStock && item.totalStock <= 0;
              const isLow = item.tracksStock && item.totalStock > 0 && item.totalStock <= 5;

              return (
                <tr
                  key={item.productId}
                  class={`hover:bg-slate-800/30 transition-colors group ${
                    isOut ? 'bg-rose-950/10' : ''
                  }`}
                >
                  {/* SKU */}
                  <td class="py-3 px-4 font-mono text-[11px] text-slate-400">
                    {item.sku}
                  </td>

                  {/* Nombre */}
                  <td class="py-3 px-4">
                    <div class="font-semibold text-white group-hover:text-indigo-200 transition-colors">
                      {item.name}
                    </div>
                    {!item.tracksStock && (
                      <span class="text-[10px] text-slate-500">Sin control de stock</span>
                    )}
                  </td>

                  {/* Categoría */}
                  <td class="py-3 px-4 text-slate-300">
                    <span class="px-2 py-0.5 rounded-md bg-slate-800/80 text-[11px] text-slate-300 border border-slate-700/50">
                      {item.category}
                    </span>
                  </td>

                  {/* Celdas de Sucursales */}
                  {branches.map((b) => {
                    const qty = item.branches[b.id] ?? 0;
                    const cellOut = item.tracksStock && qty <= 0;
                    const cellLow = item.tracksStock && qty > 0 && qty <= 3;

                    return (
                      <td
                        key={b.id}
                        class="py-3 px-3 text-center font-mono cursor-pointer"
                        onClick={() => openAdjustModal(item, b.id)}
                        title={`Hacer clic para ajustar stock de ${item.name} en ${b.name}`}
                      >
                        {!item.tracksStock ? (
                          <span class="text-slate-500">∞</span>
                        ) : (
                          <span
                            class={`inline-block px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all border ${
                              cellOut
                                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
                                : cellLow
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
                                : 'bg-slate-800 text-slate-200 border-slate-700 hover:border-indigo-500 hover:text-indigo-300'
                            }`}
                          >
                            {formatNumber(qty)}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {/* Total Consolidado */}
                  <td class="py-3 px-4 text-center">
                    {!item.tracksStock ? (
                      <span class="px-2 py-0.5 text-[10px] text-slate-400 font-mono">Infinito</span>
                    ) : (
                      <span
                        class={`inline-block px-2.5 py-1 rounded-full font-mono font-bold text-xs ${
                          isOut
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-xs shadow-rose-500/20'
                            : isLow
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        }`}
                      >
                        {formatNumber(item.totalStock)} un.
                      </span>
                    )}
                  </td>

                  {/* Acciones */}
                  <td class="py-3 px-4 text-right">
                    <div class="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                      {/* Ajustar Stock */}
                      <button
                        type="button"
                        onClick={() => openAdjustModal(item)}
                        title="Ajustar stock (inventario/merma)"
                        class="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
                          />
                        </svg>
                      </button>

                      {/* Ver Kardex */}
                      <button
                        type="button"
                        onClick={() => openKardex(item)}
                        title="Ver historial de auditoría Kardex"
                        class="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                          />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
