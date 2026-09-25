import {
  ioSelectedEntitySignal,
  ioUpdateExistingSignal,
  ioCsvContentSignal,
  ioImportPreviewSignal,
  ioLoadingSignal,
  downloadExport,
  previewImport,
  applyImport,
} from '../../state/bulk-state.ts';
import { Button } from '../ui/Button.tsx';

export function ImportExportCard() {
  const selectedEntity = ioSelectedEntitySignal.value;
  const updateExisting = ioUpdateExistingSignal.value;
  const csvContent = ioCsvContentSignal.value;
  const preview = ioImportPreviewSignal.value;
  const isLoading = ioLoadingSignal.value;

  const handleFileUpload = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        ioCsvContentSignal.value = text;
      }
    };
    reader.readAsText(file);
  };

  return (
    <div class="space-y-6">
      {/* SECCIÓN 1: EXPORTACIÓN DE DATOS */}
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <span>📤 Exportación de Datos del Sistema</span>
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">
            Descarga copias completas de tu base de datos SQLite en formato CSV estándar (RFC 4180) o JSON
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          {/* Exportar Productos */}
          <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between space-y-3">
            <div>
              <div class="font-bold text-white text-sm">Catálogo de Productos</div>
              <div class="text-xs text-slate-400 mt-0.5">Artículos, precios, SKUs, categorías e impuestos</div>
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadExport('products', 'csv')}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadExport('products', 'json')}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                JSON
              </Button>
            </div>
          </div>

          {/* Exportar Clientes */}
          <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between space-y-3">
            <div>
              <div class="font-bold text-white text-sm">Clientes y Cuentas</div>
              <div class="text-xs text-slate-400 mt-0.5">Saldos deudores, DNI/CUIT y límites de crédito</div>
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadExport('customers', 'csv')}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadExport('customers', 'json')}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                JSON
              </Button>
            </div>
          </div>

          {/* Exportar Stock */}
          <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between space-y-3">
            <div>
              <div class="font-bold text-white text-sm">Matriz de Stock</div>
              <div class="text-xs text-slate-400 mt-0.5">Existencias físicas desglosadas por sucursal</div>
            </div>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadExport('stock', 'csv')}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadExport('stock', 'json')}
                disabled={isLoading}
                class="flex-1 text-[11px]"
              >
                JSON
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* SECCIÓN 2: IMPORTACIÓN MASIVA */}
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <span>📥 Importación Masiva con Simulación (Dry-Run)</span>
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">
            Carga catálogos de proveedores o listas de clientes desde archivos CSV sin riesgo de corromper la base de datos
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {/* Entidad */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">Entidad a Importar *</label>
            <div class="grid grid-cols-2 gap-2 p-1 bg-slate-950 border border-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => (ioSelectedEntitySignal.value = 'products')}
                class={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  selectedEntity === 'products' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Productos
              </button>
              <button
                type="button"
                onClick={() => (ioSelectedEntitySignal.value = 'customers')}
                class={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  selectedEntity === 'customers' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Clientes
              </button>
            </div>
          </div>

          {/* Opciones */}
          <div class="flex items-center pt-6">
            <label class="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(e) => (ioUpdateExistingSignal.value = (e.target as HTMLInputElement).checked)}
                class="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-700 focus:ring-indigo-500"
              />
              <span class="text-xs text-slate-300 font-medium">
                Actualizar registros existentes si coincide el SKU / DNI
              </span>
            </label>
          </div>
        </div>

        {/* Input de Archivo y Contenido CSV */}
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="block text-xs font-medium text-slate-300">
              Pega el contenido CSV o selecciona un archivo
            </label>
            <label class="text-xs text-indigo-400 hover:text-indigo-300 underline cursor-pointer">
              Cargar archivo .csv
              <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} class="hidden" />
            </label>
          </div>
          <textarea
            rows={5}
            placeholder={
              selectedEntity === 'products'
                ? 'sku,name,price,category,taxRate\nPROD-01,Gaseosa Cola,1500,Bebidas,0.21'
                : 'name,document,phone,creditLimit\nJuan Pérez,20304445558,1144556677,50000'
            }
            value={csvContent}
            onInput={(e) => (ioCsvContentSignal.value = (e.target as HTMLTextAreaElement).value)}
            class="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          ></textarea>
        </div>

        {/* Acciones */}
        <div class="pt-2 flex items-center justify-end gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={previewImport}
            disabled={isLoading || !csvContent.trim()}
          >
            {isLoading && preview?.dryRun ? 'Simulando...' : '🔍 Simular Importación (Preview)'}
          </Button>

          {preview && preview.errors.length === 0 && (preview.importedCount > 0 || preview.updatedCount > 0) && (
            <Button
              size="sm"
              onClick={applyImport}
              disabled={isLoading || !csvContent.trim()}
              class="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {isLoading && !preview.dryRun ? 'Importando...' : 'Confirmar Importación Real 🚀'}
            </Button>
          )}
        </div>

        {/* Reporte de Simulación o Errores */}
        {preview && (
          <div class="p-4 rounded-xl border bg-slate-950/60 border-slate-800 space-y-3 animate-in fade-in duration-150">
            <div class="flex items-center gap-4 text-xs">
              <span class="font-bold text-white">
                {preview.dryRun ? 'Resultado de la Simulación:' : 'Importación Finalizada:'}
              </span>
              <span class="text-emerald-400 font-mono">Nuevos: {preview.importedCount}</span>
              <span class="text-indigo-400 font-mono">Actualizados: {preview.updatedCount}</span>
              <span class="text-slate-400 font-mono">Omitidos: {preview.skippedCount}</span>
              {preview.errors.length > 0 && (
                <span class="text-rose-400 font-bold font-mono">Errores: {preview.errors.length}</span>
              )}
            </div>

            {preview.errors.length > 0 && (
              <div class="space-y-1.5 max-h-40 overflow-y-auto pt-2 border-t border-slate-800/80">
                <div class="text-[11px] font-bold text-rose-400">Filas con errores detectados:</div>
                {preview.errors.map((err, idx) => (
                  <div key={idx} class="text-xs text-rose-300 font-mono bg-rose-500/10 px-2.5 py-1 rounded-md">
                    Fila {err.row}: {err.error}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
