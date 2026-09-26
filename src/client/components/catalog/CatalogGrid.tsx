import {
  filteredProductsSignal,
  catalogLoadingSignal,
  stockMapSignal,
  inlineEditingSignal,
  startInlineEdit,
  cancelInlineEdit,
  saveInlineEdit,
  openEditProductModal,
  openBlockModal,
  deleteProduct,
} from '../../state/catalog-state.ts';
import { formatCurrency, formatNumber } from '../../state/dashboard-state.ts';
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

export function CatalogGrid() {
  const products = filteredProductsSignal.value;
  const isLoading = catalogLoadingSignal.value;
  const stockMap = stockMapSignal.value;
  const inlineEdit = inlineEditingSignal.value;

  const handleKeyDown = (
    e: KeyboardEvent,
    productId: string,
    field: 'name' | 'price' | 'category' | 'sku',
    val: string,
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveInlineEdit(productId, field, val);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit();
    }
  };

  if (isLoading && products.length === 0) {
    return (
      <TableContainer>
        <div class="p-12 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
          <div class="w-8 h-8 border-2 border-indigo-600 dark:border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div>Cargando productos del catálogo...</div>
        </div>
      </TableContainer>
    );
  }

  if (products.length === 0) {
    return (
      <TableContainer>
        <TableEmptyState
          icon="📦"
          message="No se encontraron productos"
          submessage="Prueba cambiando el término de búsqueda o selecciona otra categoría en la barra de herramientas."
        />
      </TableContainer>
    );
  }

  return (
    <TableContainer>
      {/* Hint de edición inline tipo Excel */}
      <div class="px-4 py-2.5 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
        <div class="flex items-center gap-1.5">
          <span class="text-indigo-600 dark:text-indigo-400 font-bold">💡 Tip Hoja de Cálculo:</span>
          <span>Haz doble clic en cualquier celda de Nombre, Categoría o Precio para editar al instante (Enter para guardar, Esc para cancelar).</span>
        </div>
        <div class="font-mono text-slate-400 dark:text-slate-500">
          Total filas: {products.length}
        </div>
      </div>

      <Table>
        <Thead>
          <tr>
            <Th class="w-28">SKU</Th>
            <Th class="min-w-[200px]">Nombre / Artículo</Th>
            <Th class="w-36">Categoría</Th>
            <Th class="w-32 text-right">Precio Venta</Th>
            <Th class="w-20 text-center">IVA</Th>
            <Th class="w-28 text-center">Stock</Th>
            <Th class="w-24 text-center">Estado</Th>
            <Th class="w-28 text-right">Acciones</Th>
          </tr>
        </Thead>
        <Tbody>
          {products.map((p) => {
            const stock = stockMap[p.id];
            const isBlocked = Boolean(p.blockedReason);

            const isEditingName = inlineEdit?.productId === p.id && inlineEdit?.field === 'name';
            const isEditingPrice = inlineEdit?.productId === p.id && inlineEdit?.field === 'price';
            const isEditingCategory = inlineEdit?.productId === p.id && inlineEdit?.field === 'category';
            const isEditingSku = inlineEdit?.productId === p.id && inlineEdit?.field === 'sku';

            return (
              <Tr
                key={p.id}
                class={`group ${
                  isBlocked ? 'bg-rose-50/40 dark:bg-rose-950/10' : ''
                }`}
              >
                {/* SKU */}
                <Td
                  class="font-mono text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer"
                  onDblClick={() => startInlineEdit(p.id, 'sku', p.sku)}
                  title="Doble clic para editar SKU"
                >
                  {isEditingSku ? (
                    <input
                      type="text"
                      autoFocus
                      value={inlineEdit.value}
                      onInput={(e) => {
                        inlineEditingSignal.value = {
                          ...inlineEdit,
                          value: (e.target as HTMLInputElement).value,
                        };
                      }}
                      onBlur={() => saveInlineEdit(p.id, 'sku', inlineEdit.value)}
                      onKeyDown={(e) => handleKeyDown(e, p.id, 'sku', inlineEdit.value)}
                      class="w-full px-2 py-0.5 bg-white dark:bg-slate-950 border border-indigo-500 rounded font-mono text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                  ) : (
                    <span class="group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">{p.sku}</span>
                  )}
                </Td>

                {/* Nombre */}
                <Td
                  class="font-semibold text-slate-900 dark:text-white cursor-pointer"
                  onDblClick={() => startInlineEdit(p.id, 'name', p.name)}
                  title="Doble clic para editar nombre"
                >
                  {isEditingName ? (
                    <input
                      type="text"
                      autoFocus
                      value={inlineEdit.value}
                      onInput={(e) => {
                        inlineEditingSignal.value = {
                          ...inlineEdit,
                          value: (e.target as HTMLInputElement).value,
                        };
                      }}
                      onBlur={() => saveInlineEdit(p.id, 'name', inlineEdit.value)}
                      onKeyDown={(e) => handleKeyDown(e, p.id, 'name', inlineEdit.value)}
                      class="w-full px-2 py-0.5 bg-white dark:bg-slate-950 border border-indigo-500 rounded text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                  ) : (
                    <div class="flex items-center gap-2">
                      <span class="group-hover:text-indigo-600 dark:group-hover:text-indigo-200 transition-colors">{p.name}</span>
                      {p.barcodes.length > 0 && (
                        <span class="text-[10px] text-slate-400 dark:text-slate-500 font-mono hidden sm:inline" title="Códigos de barra">
                          🏷️ {p.barcodes[0]}
                        </span>
                      )}
                    </div>
                  )}
                </Td>

                {/* Categoría */}
                <Td
                  class="text-slate-600 dark:text-slate-300 cursor-pointer"
                  onDblClick={() => startInlineEdit(p.id, 'category', p.category)}
                  title="Doble clic para editar categoría"
                >
                  {isEditingCategory ? (
                    <input
                      type="text"
                      autoFocus
                      value={inlineEdit.value}
                      onInput={(e) => {
                        inlineEditingSignal.value = {
                          ...inlineEdit,
                          value: (e.target as HTMLInputElement).value,
                        };
                      }}
                      onBlur={() => saveInlineEdit(p.id, 'category', inlineEdit.value)}
                      onKeyDown={(e) => handleKeyDown(e, p.id, 'category', inlineEdit.value)}
                      class="w-full px-2 py-0.5 bg-white dark:bg-slate-950 border border-indigo-500 rounded text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                  ) : (
                    <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800/80 text-[11px] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/50 group-hover:border-slate-300 dark:group-hover:border-slate-600 transition-colors">
                      {p.category}
                    </span>
                  )}
                </Td>

                {/* Precio Venta */}
                <Td
                  class="text-right font-mono font-bold text-slate-900 dark:text-white cursor-pointer"
                  onDblClick={() => startInlineEdit(p.id, 'price', p.price.toString())}
                  title="Doble clic para editar precio"
                >
                  {isEditingPrice ? (
                    <input
                      type="text"
                      autoFocus
                      value={inlineEdit.value}
                      onInput={(e) => {
                        inlineEditingSignal.value = {
                          ...inlineEdit,
                          value: (e.target as HTMLInputElement).value,
                        };
                      }}
                      onBlur={() => saveInlineEdit(p.id, 'price', inlineEdit.value)}
                      onKeyDown={(e) => handleKeyDown(e, p.id, 'price', inlineEdit.value)}
                      class="w-24 px-2 py-0.5 bg-white dark:bg-slate-950 border border-indigo-500 rounded font-mono text-xs text-right text-emerald-600 dark:text-emerald-400 focus:outline-none"
                    />
                  ) : (
                    <span class="text-emerald-600 dark:text-emerald-400 group-hover:underline decoration-emerald-500/50 underline-offset-2">
                      {formatCurrency(p.price)}
                    </span>
                  )}
                </Td>

                {/* IVA */}
                <Td class="text-center font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {Math.round(p.taxRate * 100)}%
                </Td>

                {/* Stock */}
                <Td class="text-center">
                  {!p.tracksStock ? (
                    <span class="text-[10px] text-slate-400 dark:text-slate-500 font-mono">Infinito</span>
                  ) : stock === undefined ? (
                    <span class="text-[10px] text-slate-400 dark:text-slate-500 font-mono">--</span>
                  ) : (
                    <span
                      class={`inline-block px-2 py-0.5 rounded-full font-mono font-bold text-[10px] ${
                        stock <= 0
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                          : stock <= 5
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                          : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {formatNumber(stock)} un.
                    </span>
                  )}
                </Td>

                {/* Estado */}
                <Td class="text-center">
                  {isBlocked ? (
                    <span
                      class="inline-block px-2 py-0.5 rounded-full font-medium text-[10px] bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                      title={p.blockedReason ?? 'Bloqueado'}
                    >
                      Bloqueado
                    </span>
                  ) : (
                    <span class="inline-block px-2 py-0.5 rounded-full font-medium text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      Activo
                    </span>
                  )}
                </Td>

                {/* Acciones */}
                <Td class="text-right">
                  <div class="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => openEditProductModal(p)}
                      title="Editar detalles completos"
                      class="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={() => openBlockModal(p)}
                      title={isBlocked ? 'Desbloquear para venta' : 'Bloquear producto'}
                      class={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                        isBlocked
                          ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                          : 'text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {isBlocked ? (
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
                          />
                        ) : (
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                          />
                        )}
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteProduct(p)}
                      title="Eliminar producto"
                      class="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </TableContainer>
  );
}
