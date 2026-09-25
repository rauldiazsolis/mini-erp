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

export function BalanceAdjustModal() {
  if (!balanceAdjustModalOpenSignal.value) return null;

  const target = balanceAdjustTargetSignal.value;
  if (!target) return null;

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
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div class="p-6 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center text-lg font-bold">
              ⚖️
            </div>
            <div>
              <h3 class="text-base font-bold text-white">Ajuste de Saldo de Cuenta</h3>
              <p class="text-xs text-slate-400">Corrección auditada de saldo con asiento contable</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeBalanceAdjustModal}
            disabled={isSubmitting}
            class="text-slate-400 hover:text-white transition-colors cursor-pointer p-1.5 rounded-xl hover:bg-slate-800"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div class="p-6 space-y-4">
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

          {/* Tarjeta del Cliente */}
          <div class="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
            <div>
              <div class="font-bold text-white text-sm">{target.name}</div>
              <div class="text-slate-400 font-mono mt-0.5">{target.document ?? 'Sin documento'}</div>
            </div>
            <div class="text-right">
              <div class="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Saldo Actual</div>
              <div class="text-base font-black font-mono text-slate-100 mt-0.5">
                {formatCurrency(target.balance)}
              </div>
            </div>
          </div>

          {/* Modalidad de Ajuste */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">Tipo de Ajuste *</label>
            <div class="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => updateField('type', 'credit')}
                class={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                  form.type === 'credit'
                    ? 'bg-emerald-600/15 border-emerald-500 text-emerald-300 font-bold'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div class="text-xs">Crédito</div>
                <div class="text-[10px] text-slate-500 font-normal">Resta deuda</div>
              </button>

              <button
                type="button"
                onClick={() => updateField('type', 'debit')}
                class={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                  form.type === 'debit'
                    ? 'bg-rose-600/15 border-rose-500 text-rose-300 font-bold'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div class="text-xs">Débito</div>
                <div class="text-[10px] text-slate-500 font-normal">Suma deuda</div>
              </button>

              <button
                type="button"
                onClick={() => updateField('type', 'set')}
                class={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                  form.type === 'set'
                    ? 'bg-indigo-600/15 border-indigo-500 text-indigo-300 font-bold'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div class="text-xs">Fijar Saldo</div>
                <div class="text-[10px] text-slate-500 font-normal">Reemplaza total</div>
              </button>
            </div>
          </div>

          {/* Importe */}
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">
              {form.type === 'set' ? 'Nuevo Saldo Resultante ($ ARS) *' : 'Monto del Ajuste ($ ARS) *'}
            </label>
            <input
              type="number"
              step="100"
              min="0"
              value={form.amount || ''}
              onInput={(e) => updateField('amount', parseFloat((e.target as HTMLInputElement).value) || 0)}
              class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
              autoFocus
            />
          </div>

          {/* Motivo Obligatorio */}
          <Input
            label="Motivo del Ajuste (Auditoría Contable) *"
            placeholder="Ej: Bonificación por pronto pago, Descuento especial, Corrección saldo inicial..."
            value={form.reason}
            onInput={(e) => updateField('reason', (e.target as HTMLInputElement).value)}
          />
        </div>

        {/* Footer */}
        <div class="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closeBalanceAdjustModal} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={submitBalanceAdjustment}
            disabled={isSubmitting}
            class="bg-amber-600 hover:bg-amber-500 text-white"
          >
            {isSubmitting ? 'Aplicando...' : 'Aplicar Ajuste ⚖️'}
          </Button>
        </div>
      </div>
    </div>
  );
}
