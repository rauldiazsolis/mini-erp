import { canDo } from '../../state/permissions-state.ts';
import {
  filteredStockSignal,
  stockWindow,
  stockBranchesSignal,
  stockLoadingSignal,
  openAdjustModal,
  openKardex,
} from '../../state/stock-state.ts';
import {
  TableContainer,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableEmptyState,
} from '../ui/Table.tsx';
import { formatQty } from '../../format.ts';
import { CardList, CardRow, DesktopOnly } from '../ui/CardList.tsx';
import { InfiniteSentinel } from '../ui/InfiniteSentinel.tsx';

export function StockMatrixTable() {
  // Una caja desde el POS (M10) solo consulta
  const canEdit = canDo('tenant.use');
  const stockItems = filteredStockSignal.value;
  const shown = stockWindow.visible.value;
  const branches = stockBranchesSignal.value;
  const isLoading = stockLoadingSignal.value;

  if (isLoading && stockItems.length === 0) {
    return (
      <TableContainer>
        <div class="p-12 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
          <div class="w-8 h-8 border-2 border-indigo-600 dark:border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div>Cargando matriz de existencias por sucursal...</div>
        </div>
      </TableContainer>
    );
  }

  if (stockItems.length === 0) {
    return (
      <TableContainer>
        <TableEmptyState
          icon="📦"
          message="No hay existencias para los filtros seleccionados"
          submessage="Prueba cambiando el nivel de alerta o el término de búsqueda."
        />
      </TableContainer>
    );
  }

  return (
    <TableContainer>
      {/* Tip de la matriz; en el teléfono, el ajuste está en la tarjeta (#89) */}
      <div class="hidden md:flex px-4 py-2.5 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
        <div class="flex items-center gap-1.5">
          <span class="text-indigo-600 dark:text-indigo-400 font-bold">💡 Tip Matriz Multi-Sucursal:</span>
          <span>Hacé clic en la cantidad de cualquier sucursal para ajustar el stock de esa ubicación de forma auditada.</span>
        </div>
        <div class="font-mono text-slate-400 dark:text-slate-500">
          Sucursales activas: {branches.length}
        </div>
      </div>

      {/* En el teléfono: tocar la tarjeta abre el kardex; el ajuste queda a mano */}
      <CardList label="Stock">
        {shown.map((item) => (
          <CardRow
            key={item.productId}
            onOpen={() => { openKardex(item); }}
            title={item.name}
            aside={
              !item.tracksStock ? (
                <span class="text-slate-500 text-xs">Infinito</span>
              ) : (
                <span class={item.totalStock <= 0 ? 'text-rose-600 dark:text-rose-400' : item.totalStock <= 5 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>
                  {formatQty(item.totalStock)} un.
                </span>
              )
            }
            meta={[
              item.sku,
              item.category,
              ...(item.tracksStock && branches.length > 1 ? branches.map((b) => `${b.name} ${formatQty(item.branches[b.id] ?? 0)}`) : []),
            ]
              .filter((x) => x !== '')
              .join(' · ')}
            actions={
              canEdit && item.tracksStock ? (
                <button
                  type="button"
                  class="p-2.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 rounded-lg transition-colors"
                  aria-label="Ajustar stock"
                  title="Ajustar stock"
                  onClick={() => { openAdjustModal(item); }}
                >
                  <span class="text-sm">⚖️</span>
                </button>
              ) : undefined
            }
          />
        ))}
      </CardList>
      <DesktopOnly>
        <Table>
          <Thead>
            <tr>
              <Th class="w-28">SKU</Th>
              <Th class="min-w-[200px]">Artículo / Descripción</Th>
              <Th class="w-32">Categoría</Th>

              {/* Columnas Dinámicas por Sucursal */}
              {branches.map((b) => (
                <Th key={b.id} class="text-center w-28 text-indigo-600 dark:text-indigo-300 font-mono">
                  {b.code}
                </Th>
              ))}

              <Th class="w-32 text-center">Total Consolidado</Th>
              <Th class="w-28 text-right">Acciones</Th>
            </tr>
          </Thead>
          <Tbody>
            {shown.map((item) => {
              const isOut = item.tracksStock && item.totalStock <= 0;
              const isLow = item.tracksStock && item.totalStock > 0 && item.totalStock <= 5;

              return (
                <Tr
                  key={item.productId}
                  class={`group ${
                    isOut ? 'bg-rose-50/40 dark:bg-rose-950/10' : ''
                  }`}
                >
                  {/* SKU */}
                  <Td class="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {item.sku}
                  </Td>

                  {/* Nombre */}
                  <Td>
                    <div class="font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-200 transition-colors">
                      {item.name}
                    </div>
                    {!item.tracksStock && (
                      <span class="text-[10px] text-slate-400 dark:text-slate-500">Sin control de stock</span>
                    )}
                  </Td>

                  {/* Categoría */}
                  <Td>
                    <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 text-[11px] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/50">
                      {item.category}
                    </span>
                  </Td>

                  {/* Celdas de Sucursales */}
                  {branches.map((b) => {
                    const qty = item.branches[b.id] ?? 0;
                    const cellOut = item.tracksStock && qty <= 0;
                    const cellLow = item.tracksStock && qty > 0 && qty <= 3;

                    return (
                      <Td
                        key={b.id}
                        class={`text-center font-mono ${canEdit ? 'cursor-pointer' : ''}`}
                        onClick={canEdit ? () => { openAdjustModal(item, b.id); } : undefined}
                        title={canEdit ? `Hacer clic para ajustar stock de ${item.name} en ${b.name}` : undefined}
                      >
                        {!item.tracksStock ? (
                          <span class="text-slate-400 dark:text-slate-500">∞</span>
                        ) : (
                          <span
                            class={`inline-block px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all border ${
                              cellOut
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
                                : cellLow
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-300'
                            }`}
                          >
                            {formatQty(qty)}
                          </span>
                        )}
                      </Td>
                    );
                  })}

                  {/* Total Consolidado */}
                  <Td class="text-center">
                    {!item.tracksStock ? (
                      <span class="px-2 py-0.5 text-[10px] text-slate-400 font-mono">Infinito</span>
                    ) : (
                      <span
                        class={`inline-block px-2.5 py-1 rounded-full font-mono font-bold text-xs ${
                          isOut
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/40'
                            : isLow
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/40'
                            : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40'
                        }`}
                      >
                        {formatQty(item.totalStock)} un.
                      </span>
                    )}
                  </Td>

                  {/* Acciones */}
                  <Td class="text-right">
                    {canEdit && (
  <div class="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                      {/* Ajustar Stock */}
                      <button
                        type="button"
                        onClick={() => { openAdjustModal(item); }}
                        title="Ajustar stock (inventario/merma)"
                        class="p-2.5 sm:p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 rounded-lg transition-colors cursor-pointer"
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
                        onClick={() => { openKardex(item); }}
                        title="Ver trazabilidad Kardex"
                        class="p-2.5 sm:p-1.5 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-slate-200 dark:active:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                          />
                        </svg>
                      </button>
                    </div>

  )}                </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </DesktopOnly>
      <InfiniteSentinel shown={shown.length} total={stockItems.length} hasMore={stockWindow.hasMore.value} onMore={stockWindow.showMore} />
    </TableContainer>
  );
}
