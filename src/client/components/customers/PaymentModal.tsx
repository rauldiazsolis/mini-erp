import {
  paymentModalOpenSignal,
  paymentTargetCustomerSignal,
  paymentFormDataSignal,
  isSubmittingPaymentSignal,
  paymentErrorSignal,
  closePaymentModal,
  submitPayment,
} from '../../state/customer-state.ts';
import { formatCurrency } from '../../state/dashboard-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';

const PAYMENT_METHODS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia Bancaria' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'tarjeta', label: 'Tarjeta de Débito / Crédito' },
  { value: 'otro', label: 'Otro' },
];

export function PaymentModal() {
  const isOpen = paymentModalOpenSignal.value;
  const target = paymentTargetCustomerSignal.value;
  if (!isOpen || !target) return null;

  const form = paymentFormDataSignal.value;
  const isSubmitting = isSubmittingPaymentSignal.value;
  const error = paymentErrorSignal.value;

  const updateField = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) => {
    paymentFormDataSignal.value = {
      ...paymentFormDataSignal.value,
      [key]: val,
    };
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={closePaymentModal}
      title="Registrar Cobranza"
      subtitle="Ingreso de pago en cuenta corriente"
      icon={<span>💵</span>}
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

        {/* Tarjeta del Cliente y Saldo */}
        <div class="p-3.5 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-slate-900 dark:text-white text-sm">{target.name}</div>
            <div class="text-slate-500 dark:text-slate-400 font-mono mt-0.5">{target.document ?? 'Sin documento'}</div>
          </div>
          <div class="text-right">
            <div class="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Saldo Adeudado</div>
            <div class="text-base font-black font-mono text-rose-600 dark:text-rose-400 mt-0.5">
              {formatCurrency(target.balance)}
            </div>
          </div>
        </div>

        {/* Importe a Cobrar */}
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300">Importe a Cobrar ($ ARS) *</label>
            {target.balance > 0 && (
              <button
                type="button"
                onClick={() => updateField('amount', target.balance)}
                class="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
              >
                Cobrar saldo total
              </button>
            )}
          </div>
          <input
            type="number"
            step="100"
            min="1"
            value={form.amount || ''}
            onInput={(e) => updateField('amount', parseFloat((e.target as HTMLInputElement).value) || 0)}
            class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            autoFocus
          />
        </div>

        {/* Medio de Pago */}
        <div>
          <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Medio de Pago</label>
          <select
            value={form.method}
            onChange={(e) => updateField('method', (e.target as HTMLSelectElement).value)}
            class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* N° Comprobante / Referencia */}
        <Input
          label="Comprobante / Referencia (opcional)"
          placeholder="Ej: Transferencia #884920, Recibo 0001-0023"
          value={form.reference}
          onInput={(e) => updateField('reference', (e.target as HTMLInputElement).value)}
        />

        {/* Descripción / Concepto */}
        <Input
          label="Concepto"
          placeholder="Cobranza en cuenta corriente"
          value={form.description}
          onInput={(e) => updateField('description', (e.target as HTMLInputElement).value)}
        />

        {/* Footer */}
        <div class="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closePaymentModal} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={submitPayment}
            disabled={isSubmitting}
            class="bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            {isSubmitting ? 'Registrando...' : 'Confirmar Cobro 💵'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
