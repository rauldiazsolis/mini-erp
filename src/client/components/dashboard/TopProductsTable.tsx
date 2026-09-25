import {
  dashboardDataSignal,
  formatCurrency,
  formatNumber,
} from '../../state/dashboard-state.ts';
import { Card, CardHeader } from '../ui/Card.tsx';

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

              return (
                <div key={item.productId} class="space-y-1">
                  <div class="flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2.5 truncate max-w-[65%]">
                      <span
                        class={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] shrink-0 ${
                          idx === 0
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : idx === 1
                            ? 'bg-slate-300/20 text-slate-200 border border-slate-300/30'
                            : idx === 2
                            ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        #{idx + 1}
                      </span>
                      <span class="font-medium text-slate-200 truncate">{item.name}</span>
                    </div>

                    <div class="text-right shrink-0">
                      <span class="font-semibold text-white">{formatCurrency(item.totalRevenue)}</span>
                      <span class="text-[10px] text-slate-400 block font-mono">
                        {formatNumber(item.unitsSold)} un.
                      </span>
                    </div>
                  </div>

                  {/* Barra de progreso visual */}
                  <div class="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
                    <div
                      class={`h-full rounded-full transition-all duration-300 ${
                        isTop3 ? 'bg-indigo-500' : 'bg-slate-600'
                      }`}
                      style={{ width: `${ratio}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div class="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between text-[11px] text-slate-400">
        <span>Datos auditados del TPV</span>
        <span class="text-indigo-400 font-medium">Connector v4.0.0</span>
      </div>
    </Card>
  );
}
