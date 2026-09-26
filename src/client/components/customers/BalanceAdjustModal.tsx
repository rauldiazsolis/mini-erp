import {
  balanceAdjustModalOpenSignal,
  balanceAdjustTargetSignal,
  balanceAdjustFormSignal,
  isSubmittingAdjustSignal,
  balanceAdjustErrorSignal,
  closeBalanceAdjustModal,
  submitBalanceAdjustment,
} from '../../state/customer-state.ts';
import { formatCurrency } from '../../state/dashboard-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';

export function BalanceAdjustModal() {
  const isOpen = balanceAdjustModalOpenSignal.value;
  const target = balanceAdjustTargetSignal.value;
  if (!isOpen || !target) return null;

  const form = balanceAdjustFormSignal.value;
  const isSubmitting = isSubmittingAdjustSignal.value;
  const error = balanceAdjustErrorSignal.value;

  const updateField = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) => {
    balanceAdjustFormSignal.value = {
      ...balanceAdjustFormSignal.value,
      [key]: val,
    };
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeBalanceAdjustModal}
      title="Ajuste de Saldo de Cuenta"
      subtitle="Corrección auditada de saldo con asiento contable"
      icon={<span>⚖️</span>}
      maxWidth="md"
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

        {/* Tarjeta del Cliente */}
        <div class="p-3.5 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-slate-900 dark:text-white text-sm">{target.name}</div>
            <div class="text-slate-500 dark:text-slate-400 font-mono mt-0.5">{target.document ?? 'Sin documento'}</div>
          </div>
          <div class="text-right">
            <div class="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Saldo Actual</div>
            <div class="text-base font-black font-mono text-slate-900 dark:text-slate-100 mt-0.5">
              {formatCurrency(target.balance)}
            </div>
          </div>
        </div>

        {/* Modalidad de Ajuste */}
        <div>
          <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Tipo de Ajuste *</label>
          <div class="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => { updateField('type', 'credit'); }}
              class={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                form.type === 'credit'
                  ? 'bg-emerald-50 dark:bg-emerald-600/15 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold ring-1 ring-emerald-500/30'
                  : 'bg-white dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div class="text-xs">Crédito</div>
              <div class="text-[10px] text-slate-500 dark:text-slate-400 font-normal">Resta deuda</div>
            </button>

            <button
              type="button"
              onClick={() => { updateField('type', 'debit'); }}
              class={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                form.type === 'debit'
                  ? 'bg-rose-50 dark:bg-rose-600/15 border-rose-500 text-rose-700 dark:text-rose-300 font-bold ring-1 ring-rose-500/30'
                  : 'bg-white dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div class="text-xs">Débito</div>
              <div class="text-[10px] text-slate-500 dark:text-slate-400 font-normal">Suma deuda</div>
            </button>

            <button
              type="button"
              onClick={() => { updateField('type', 'set'); }}
              class={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                form.type === 'set'
                  ? 'bg-indigo-50 dark:bg-indigo-600/15 border-indigo-500 text-indigo-700 dark:text-indigo-300 font-bold ring-1 ring-indigo-500/30'
                  : 'bg-white dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <div class="text-xs">Fijar Saldo</div>
              <div class="text-[10px] text-slate-500 dark:text-slate-400 font-normal">Reemplaza total</div>
            </button>
          </div>
        </div>

        {/* Importe */}
        <div>
          <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            {form.type === 'set' ? 'Nuevo Saldo Resultante ($ ARS) *' : 'Monto del Ajuste ($ ARS) *'}
          </label>
          <input
            type="number"
            step="100"
            min="0"
            value={form.amount || ''}
            onInput={(e) => { updateField('amount', parseFloat((e.target as HTMLInputElement).value) || 0); }}
            class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-amber-600 dark:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
            autoFocus
          />
        </div>

        {/* Motivo Obligatorio */}
        <Input
          label="Motivo del Ajuste (Auditoría Contable) *"
          placeholder="Ej: Bonificación por pronto pago, Descuento especial, Corrección saldo inicial..."
          value={form.reason}
          onInput={(e) => { updateField('reason', (e.target as HTMLInputElement).value); }}
        />

        {/* Footer */}
        <div class="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closeBalanceAdjustModal} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => { void submitBalanceAdjustment(); }}
            disabled={isSubmitting}
            class="bg-amber-600 hover:bg-amber-500 text-white"
          >
            {isSubmitting ? 'Aplicando...' : 'Aplicar Ajuste ⚖️'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
