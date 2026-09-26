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
import { Modal } from '../ui/Modal.tsx';

const REASON_OPTIONS = [
  { value: 'recuento_fisico', label: 'Recuento / Inventario Físico' },
  { value: 'ingreso_mercaderia', label: 'Ingreso de Mercadería (Proveedor)' },
  { value: 'merma_rotura', label: 'Merma / Rotura / Vencimiento' },
  { value: 'ajuste_administrativo', label: 'Corrección Administrativa' },
  { value: 'devolucion', label: 'Devolución de Cliente' },
  { value: 'otro', label: 'Otro motivo' },
];

export function StockAdjustModal() {
  const isOpen = adjustModalOpenSignal.value;
  if (!isOpen) return null;

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
    <Modal
      isOpen={isOpen}
      onClose={closeAdjustModal}
      title="Ajuste de Stock Auditado"
      subtitle="Cada movimiento se asienta de forma inmutable en el Kardex"
      icon={<span>⚖️</span>}
      maxWidth="lg"
    >
      <div class="space-y-4">
        {error && (
          <div class="p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-700 dark:text-rose-300">
            <svg class="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Tarjeta del Producto */}
        <div class="p-3.5 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1 text-xs">
          <div class="font-bold text-slate-900 dark:text-white text-sm">{form.productName}</div>
          <div class="text-slate-500 dark:text-slate-400 font-mono">
            SKU: <span class="text-indigo-600 dark:text-indigo-300 font-semibold">{form.sku}</span>
          </div>
        </div>

        {/* Sucursal de Destino */}
        <div>
          <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Sucursal a impactar *</label>
          <select
            value={form.branchId}
            onChange={(e) => { updateField('branchId', (e.target as HTMLSelectElement).value); }}
            class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
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
          <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Modalidad de ajuste *</label>
          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { updateField('type', 'set'); }}
              class={`p-3 rounded-xl border text-xs font-medium text-left transition-all cursor-pointer ${
                form.type === 'set'
                  ? 'bg-indigo-50 dark:bg-indigo-600/15 border-indigo-500 text-indigo-900 dark:text-white shadow-xs ring-1 ring-indigo-500/30'
                  : 'bg-white dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div class="font-bold text-slate-900 dark:text-white mb-0.5">Fijar Total Físico</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">Reemplaza el stock con el nuevo conteo</div>
            </button>

            <button
              type="button"
              onClick={() => { updateField('type', 'delta'); }}
              class={`p-3 rounded-xl border text-xs font-medium text-left transition-all cursor-pointer ${
                form.type === 'delta'
                  ? 'bg-indigo-50 dark:bg-indigo-600/15 border-indigo-500 text-indigo-900 dark:text-white shadow-xs ring-1 ring-indigo-500/30'
                  : 'bg-white dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div class="font-bold text-slate-900 dark:text-white mb-0.5">Sumar / Restar Unidades</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">Aplica un incremento (+) o merma (-)</div>
            </button>
          </div>
        </div>

        {/* Cantidad */}
        <div>
          <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            {form.type === 'set' ? 'Cantidad física resultante *' : 'Variación de unidades (Delta: ej. 10 o -3) *'}
          </label>
          <input
            type="number"
            step="1"
            value={form.quantity}
            onInput={(e) => { updateField('quantity', parseFloat((e.target as HTMLInputElement).value) || 0); }}
            class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-indigo-600 dark:text-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
          />
        </div>

        {/* Motivo de Auditoría */}
        <div>
          <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Motivo del movimiento (Auditoría Kardex) *
          </label>
          <select
            value={form.reason}
            onChange={(e) => { updateField('reason', (e.target as HTMLSelectElement).value); }}
            class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
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
          onInput={(e) => { updateField('notes', (e.target as HTMLInputElement).value); }}
        />

        {/* Footer */}
        <div class="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closeAdjustModal} disabled={isAdjusting}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => { void submitStockAdjustment(); }} disabled={isAdjusting}>
            {isAdjusting ? 'Asentando...' : 'Confirmar Asiento en Kardex'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
