import { ioLoadingSignal, downloadExport } from '../../state/bulk-state.ts';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';

export function ExportCard() {
  const isLoading = ioLoadingSignal.value;

  return (
    <div class="space-y-6">
      {/* SECCIÓN 1: EXPORTACIÓN DE DATOS */}
      <Card class="space-y-4">
        <div>
          <h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>📤 Exportación de Datos del Sistema</span>
          </h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Descarga copias completas de tu base de datos SQLite en formato CSV estándar (RFC 4180) o JSON
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          {/* Exportar Productos */}
          <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3">
            <div>
              <div class="font-bold text-slate-900 dark:text-white text-sm">Catálogo de Productos</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Artículos, precios, SKUs, categorías e impuestos</div>
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void downloadExport('products', 'csv'); }}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void downloadExport('products', 'json'); }}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                JSON
              </Button>
            </div>
          </div>

          {/* Exportar Clientes */}
          <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3">
            <div>
              <div class="font-bold text-slate-900 dark:text-white text-sm">Clientes y Cuentas</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Saldos deudores, DNI/CUIT y límites de crédito</div>
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void downloadExport('customers', 'csv'); }}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void downloadExport('customers', 'json'); }}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                JSON
              </Button>
            </div>
          </div>

          {/* Exportar Stock */}
          <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3">
            <div>
              <div class="font-bold text-slate-900 dark:text-white text-sm">Matriz de Stock</div>
              <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Existencias físicas desglosadas por sucursal</div>
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void downloadExport('stock', 'csv'); }}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { void downloadExport('stock', 'json'); }}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                JSON
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
