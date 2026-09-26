import {
  kardexDrawerOpenSignal,
  kardexTargetProductSignal,
  kardexMovementsSignal,
  kardexLoadingSignal,
  kardexReasonFilterSignal,
  closeKardex,
} from '../../state/stock-state.ts';
import { formatNumber } from '../../state/dashboard-state.ts';
import { Button } from '../ui/Button.tsx';
import { Drawer } from '../ui/Drawer.tsx';

function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function KardexDrawer() {
  const isOpen = kardexDrawerOpenSignal.value;
  const product = kardexTargetProductSignal.value;
  if (!isOpen || !product) return null;

  const movements = kardexMovementsSignal.value;
  const isLoading = kardexLoadingSignal.value;
  const reasonFilter = kardexReasonFilterSignal.value;

  const filteredMovements = movements.filter((m) => {
    if (reasonFilter !== 'all' && m.reason !== reasonFilter) {
      return false;
    }
    return true;
  });

  return (
    <Drawer
      isOpen={isOpen}
      onClose={closeKardex}
      title="Historial de Auditoría Kardex"
      subtitle={`${product.name} (${product.sku})`}
      icon={<span>📋</span>}
      maxWidth="max-w-2xl"
    >
      <div class="space-y-4">
        {/* Resumen de Existencias Actuales del Producto */}
        <div class="p-4 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div class="flex items-center gap-3">
            <span class="text-slate-500 dark:text-slate-400 font-medium">Existencias actuales:</span>
            <div class="flex items-center gap-2">
              {Object.entries(product.branches).map(([bId, qty]) => (
                <span key={bId} class="px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-mono text-[11px]">
                  {bId}: <strong>{formatNumber(qty)}</strong>
                </span>
              ))}
              <span class="px-2.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 font-mono text-[11px] font-bold border border-indigo-200 dark:border-indigo-500/30">
                Total: {formatNumber(product.totalStock)} un.
              </span>
            </div>
          </div>

          {/* Filtro por Motivo */}
          <div class="flex items-center gap-1.5">
            <span class="text-slate-500 dark:text-slate-400 font-medium">Filtrar:</span>
            <select
              value={reasonFilter}
              onChange={(e) => (kardexReasonFilterSignal.value = (e.target as HTMLSelectElement).value)}
              class="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 text-xs focus:outline-none"
            >
              <option value="all">Todos ({movements.length})</option>
              <option value="sale">Venta POS</option>
              <option value="recuento_fisico">Recuento Físico</option>
              <option value="ingreso_mercaderia">Ingreso Mercadería</option>
              <option value="merma_rotura">Merma / Rotura</option>
              <option value="ajuste_administrativo">Ajuste Admin</option>
            </select>
          </div>
        </div>

        {/* Lista de Movimientos / Timeline */}
        <div class="space-y-3">
          {isLoading ? (
            <div class="py-16 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
              <div class="w-8 h-8 border-2 border-indigo-600 dark:border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <div>Consultando libro cronológico de Kardex...</div>
            </div>
          ) : filteredMovements.length === 0 ? (
            <div class="py-16 text-center text-xs text-slate-500">
              No hay movimientos de Kardex registrados para este filtro.
            </div>
          ) : (
            filteredMovements.map((m) => {
              const isPositive = m.delta > 0;
              const isNegative = m.delta < 0;

              return (
                <div
                  key={m.id}
                  class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex items-start justify-between gap-4"
                >
                  <div class="space-y-1">
                    <div class="flex items-center gap-2">
                      <span
                        class={`inline-block px-2 py-0.5 rounded-md font-mono font-bold text-xs ${
                          isPositive
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            : isNegative
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {isPositive ? `+${m.delta}` : m.delta} un.
                      </span>

                      <span class="text-xs font-semibold text-slate-900 dark:text-white">
                        {m.reason === 'sale'
                          ? 'Venta en Terminal POS'
                          : m.reason.replace(/_/g, ' ').toUpperCase()}
                      </span>

                      {m.saleId && (
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono border border-indigo-500/20">
                          Venta #{m.saleId.slice(0, 8)}
                        </span>
                      )}
                    </div>

                    <div class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                      <span>Sucursal: <strong class="text-slate-800 dark:text-slate-200">{m.branchName || m.branchId}</strong></span>
                      {m.originPointOfSale && (
                        <span>• Caja: <strong class="text-slate-800 dark:text-slate-200">{m.originPointOfSale}</strong></span>
                      )}
                    </div>

                    {m.notes && (
                      <p class="text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 mt-1 italic">
                        "{m.notes}"
                      </p>
                    )}
                  </div>

                  <div class="text-right shrink-0">
                    <div class="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                      {formatDateTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div class="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <Button variant="outline" size="sm" onClick={closeKardex}>
            Cerrar Kardex
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
