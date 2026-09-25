import {
  adjustModalOpenSignal,
  adjustFormSignal,
  isAdjustingSignal,
  adjustErrorSignal,
  stockBranchesSignal,
  closeAdjustModal,
  submitStockAdjustment,
} from '../../state/stock-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';

const REASON_OPTIONS = [
  { value: 'recuento_fisico', label: 'Recuento / Inventario Físico' },
  { value: 'ingreso_mercaderia', label: 'Ingreso de Mercadería (Proveedor)' },
  { value: 'merma_rotura', label: 'Merma / Rotura / Vencimiento' },
  { value: 'ajuste_administrativo', label: 'Corrección Administrativa' },
  { value: 'devolucion', label: 'Devolución de Cliente' },
  { value: 'otro', label: 'Otro motivo' },
];

export function StockAdjustModal() {
  if (!adjustModalOpenSignal.value) return null;

  const form = adjustFormSignal.value;
  const isAdjusting = isAdjustingSignal.value;
  const error = adjustErrorSignal.value;
  const branches = stockBranchesSignal.value;

  const updateField = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) => {
    adjustFormSignal.value = {
      ...adjustFormSignal.value,
      [key]: val,
    };
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div class="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div class="p-6 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center text-lg font-bold">
              ⚖️
            </div>
            <div>
              <h3 class="text-base font-bold text-white">Ajuste de Stock Auditado</h3>
              <p class="text-xs text-slate-400">Cada movimiento se asienta de forma inmutable en el Kardex</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeAdjustModal}
            disabled={isAdjusting}
            class="text-slate-400 hover:text-white transition-colors cursor-pointer p-1.5 rounded-xl hover:bg-slate-800"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div class="p-6 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-300">
              <svg class="w-4 h-4 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Tarjeta del Producto */}
          <div class="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-1 text-xs">
            <div class="font-bold text-white text-sm">{form.productName}</div>
            <div class="text-slate-400 font-mono">
              SKU: <span class="text-indigo-300">{form.sku}</span>
            </div>
          </div>

          {/* Sucursal de Destino */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">Sucursal a impactar *</label>
            <select
              value={form.branchId}
              onChange={(e) => updateField('branchId', (e.target as HTMLSelectElement).value)}
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>

          {/* Tipo de Ajuste */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">Modalidad de ajuste *</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => updateField('type', 'set')}
                class={`p-3 rounded-xl border text-xs font-medium text-left transition-all cursor-pointer ${
                  form.type === 'set'
                    ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-xs ring-1 ring-indigo-500/30'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div class="font-bold text-white mb-0.5">Fijar Total Físico</div>
                <div class="text-[11px] text-slate-400">Reemplaza el stock con el nuevo conteo</div>
              </button>

              <button
                type="button"
                onClick={() => updateField('type', 'delta')}
                class={`p-3 rounded-xl border text-xs font-medium text-left transition-all cursor-pointer ${
                  form.type === 'delta'
                    ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-xs ring-1 ring-indigo-500/30'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div class="font-bold text-white mb-0.5">Sumar / Restar Unidades</div>
                <div class="text-[11px] text-slate-400">Aplica un incremento (+) o merma (-)</div>
              </button>
            </div>
          </div>

          {/* Cantidad */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">
              {form.type === 'set' ? 'Cantidad física resultante *' : 'Variación de unidades (Delta: ej. 10 o -3) *'}
            </label>
            <input
              type="number"
              step="1"
              value={form.quantity}
              onInput={(e) => updateField('quantity', parseFloat((e.target as HTMLInputElement).value) || 0)}
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold text-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
          </div>

          {/* Motivo de Auditoría */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">
              Motivo del movimiento (Auditoría Kardex) *
            </label>
            <select
              value={form.reason}
              onChange={(e) => updateField('reason', (e.target as HTMLSelectElement).value)}
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              {REASON_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Notas Adicionales */}
          <Input
            label="Notas / Observaciones del ajuste (opcional)"
            placeholder="Ej: Conteo físico mensual de estantería 3..."
            value={form.notes}
            onInput={(e) => updateField('notes', (e.target as HTMLInputElement).value)}
          />
        </div>

        {/* Footer */}
        <div class="p-5 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closeAdjustModal} disabled={isAdjusting}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submitStockAdjustment} disabled={isAdjusting}>
            {isAdjusting ? 'Asentando...' : 'Confirmar Asiento en Kardex'}
          </Button>
        </div>
      </div>
    </div>
  );
}
