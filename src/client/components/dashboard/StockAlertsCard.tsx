import { dashboardDataSignal, formatNumber } from '../../state/dashboard-state.ts';
import { navigateTo } from '../../state/navigation-state.ts';
import { Card, CardHeader } from '../ui/Card.tsx';

export function StockAlertsCard() {
  const data = dashboardDataSignal.value;
  const stockAlerts = data?.stockAlerts;
  const criticalCount = stockAlerts?.criticalCount ?? 0;
  const lowProducts = stockAlerts?.lowStockProducts ?? [];

  return (
    <Card class="h-full flex flex-col justify-between">
      <div>
        <div class="flex items-center justify-between mb-4">
          <CardHeader
            title="Alertas de Inventario"
            description="Productos con existencias críticas o agotadas"
          />
          {criticalCount > 0 ? (
            <span class="text-xs bg-rose-500/15 text-rose-400 border border-rose-500/30 px-2.5 py-1 rounded-full font-bold animate-pulse">
              {criticalCount} sin stock
            </span>
          ) : (
            <span class="text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full font-semibold">
              Stock normal
            </span>
          )}
        </div>

        {lowProducts.length === 0 ? (
          <div class="py-10 text-center space-y-2">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div class="text-xs font-semibold text-slate-300">
              No hay productos con existencias bajas
            </div>
            <p class="text-[11px] text-slate-500">
              Todos los productos registrados superan el umbral de reposición.
            </p>
          </div>
        ) : (
          <div class="space-y-2">
            {lowProducts.map((p) => {
              const isOut = p.stock <= 0;
              return (
                <div
                  key={p.id}
                  class="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div class="truncate max-w-[70%]">
                    <span class="font-medium text-slate-200 block truncate">{p.name}</span>
                    <span class="text-[10px] text-slate-500 font-mono">SKU: {p.sku}</span>
                  </div>

                  <div class="text-right shrink-0">
                    <span
                      class={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        isOut
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {isOut ? 'Agotado' : `${formatNumber(p.stock)} un.`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div class="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between">
        <span class="text-[11px] text-slate-500">Control multi-sucursal</span>
        <button
          type="button"
          onClick={() => navigateTo('stock')}
          class="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer underline-offset-2 hover:underline"
        >
          Ir a Kardex de Stock →
        </button>
      </div>
    </Card>
  );
}
