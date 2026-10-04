import type { HTMLAttributes } from 'preact';
import {
  dashboardDataSignal,
} from '../../state/dashboard-state.ts';
import { drillToSales } from '../../state/dashboard-drill.ts';
import { Card, CardHeader } from '../ui/Card.tsx';
import { formatMoneyRounded, formatQty } from '../../format.ts';

export function TopProductsTable() {
  const data = dashboardDataSignal.value;
  const products = data?.topProducts ?? [];

  const maxUnits = products.length > 0 ? Math.max(...products.map((p) => p.unitsSold), 1) : 1;

  return (
    <Card class="h-full flex flex-col justify-between">
      <div>
        <CardHeader
          title="Ranking de Más Vendidos"
          description="Top productos con mayor volumen y facturación en el período"
        />

        {products.length === 0 ? (
          <div class="py-12 text-center text-xs text-slate-500">
            No hay ventas registradas en este período
          </div>
        ) : (
          <div class="space-y-3.5">
            {products.map((item, idx) => {
              const ratio = Math.min(100, Math.round((item.unitsSold / maxUnits) * 100));
              const isTop3 = idx < 3;
              // Drill-down (#20): un producto del catálogo lleva a sus tickets; una línea libre no tiene id
              const productId = item.kind === 'product' ? item.productId : undefined;
              const drill: HTMLAttributes<HTMLDivElement> =
                productId === undefined
                  ? {}
                  : {
                      role: 'button',
                      tabIndex: 0,
                      title: 'Ver sus tickets',
                      onClick: () => { drillToSales({ productId }); },
                      onKeyDown: (e: KeyboardEvent) => {
                        if (e.key === 'Enter') drillToSales({ productId });
                      },
                    };

              return (
                <div
                  key={item.key}
                  class={`space-y-1${productId === undefined ? '' : ' cursor-pointer rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                  {...drill}
                >
                  <div class="flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2.5 truncate max-w-[65%]">
                      <span
                        class={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] shrink-0 ${
                          idx === 0
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                            : idx === 1
                            ? 'bg-slate-200 dark:bg-slate-300/20 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-300/30'
                            : idx === 2
                            ? 'bg-orange-500/15 text-orange-600 dark:text-orange-300 border border-orange-500/30'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        #{idx + 1}
                      </span>
                      <span class="font-medium text-slate-800 dark:text-slate-200 truncate">{item.name}</span>
                      {item.kind === 'freeform' && (
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0">
                          sin código
                        </span>
                      )}
                    </div>

                    <div class="text-right shrink-0">
                      <span class="font-semibold text-slate-900 dark:text-white">{formatMoneyRounded(item.totalRevenue)}</span>
                      <span class="text-[10px] text-slate-500 dark:text-slate-400 block font-mono">
                        {formatQty(item.unitsSold)} un.
                      </span>
                    </div>
                  </div>

                  {/* Barra de progreso visual */}
                  <div class="h-1.5 w-full bg-slate-100 dark:bg-slate-950 rounded-full overflow-hidden">
                    <div
                      class={`h-full rounded-full transition-all duration-300 ${
                        isTop3 ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                      style={{ width: `${String(ratio)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </Card>
  );
}
