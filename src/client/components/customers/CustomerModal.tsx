import {
  customerModalOpenSignal,
  editingCustomerSignal,
  customerFormDataSignal,
  isSavingCustomerSignal,
  customerFormErrorSignal,
  closeCustomerModal,
  submitCustomerForm,
} from '../../state/customer-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';

export function CustomerModal() {
  if (!customerModalOpenSignal.value) return null;

  const isEdit = Boolean(editingCustomerSignal.value);
  const data = customerFormDataSignal.value;
  const isSaving = isSavingCustomerSignal.value;
  const error = customerFormErrorSignal.value;

  const updateField = <K extends keyof typeof data>(key: K, val: (typeof data)[K]) => {
    customerFormDataSignal.value = {
      ...customerFormDataSignal.value,
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
              {isEdit ? '✏️' : '👤'}
            </div>
            <div>
              <h3 class="text-base font-bold text-white">
                {isEdit ? 'Editar Cliente' : 'Nuevo Cliente'}
              </h3>
              <p class="text-xs text-slate-400">
                {isEdit
                  ? `Modificando datos de "${editingCustomerSignal.value?.name}"`
                  : 'Ficha comercial y límites de cuenta corriente'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeCustomerModal}
            disabled={isSaving}
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

          {/* Nombre / Denominación */}
          <Input
            label="Nombre Completo o Razón Social *"
            placeholder="Ej: Juan Pérez, Distribuidora San Juan S.A."
            value={data.name}
            onInput={(e) => updateField('name', (e.target as HTMLInputElement).value)}
            autoFocus
          />

          {/* Documento y Teléfono */}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="DNI / CUIT / Identificación"
              placeholder="20-30444555-8"
              value={data.document}
              onInput={(e) => updateField('document', (e.target as HTMLInputElement).value)}
            />

            <Input
              label="Teléfono de Contacto"
              placeholder="+54 9 11 4455-6677"
              value={data.phone}
              onInput={(e) => updateField('phone', (e.target as HTMLInputElement).value)}
            />
          </div>

          {/* Configuración de Cuenta Corriente */}
          <div class="pt-2 border-t border-slate-800 space-y-3">
            <div class="flex items-center justify-between">
              <label class="text-xs font-bold text-slate-200">Condiciones de Cuenta Corriente</label>
              <label class="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={data.unrestricted}
                  onChange={(e) => updateField('unrestricted', (e.target as HTMLInputElement).checked)}
                  class="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-700 focus:ring-indigo-500"
                />
                <span class="text-xs text-indigo-300 font-medium">Sin límite de crédito</span>
              </label>
            </div>

            {!data.unrestricted && (
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-medium text-slate-300 mb-1.5">Límite de Crédito ($ ARS)</label>
                  <input
                    type="number"
                    step="1000"
                    min="0"
                    value={data.creditLimit}
                    onInput={(e) => updateField('creditLimit', parseFloat((e.target as HTMLInputElement).value) || 0)}
                    class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label class="block text-xs font-medium text-slate-300 mb-1.5">Margen de Tolerancia ($ ARS)</label>
                  <input
                    type="number"
                    step="500"
                    min="0"
                    value={data.margin}
                    onInput={(e) => updateField('margin', parseFloat((e.target as HTMLInputElement).value) || 0)}
                    class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            {!isEdit && (
              <div>
                <label class="block text-xs font-medium text-slate-300 mb-1.5">
                  Saldo Inicial en Cuenta Corriente ($ ARS)
                </label>
                <input
                  type="number"
                  step="100"
                  value={data.initialBalance || ''}
                  placeholder="0.00 (Positivo: Deudor, Negativo: Saldo a Favor)"
                  onInput={(e) => updateField('initialBalance', parseFloat((e.target as HTMLInputElement).value) || 0)}
                  class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div class="p-5 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closeCustomerModal} disabled={isSaving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submitCustomerForm} disabled={isSaving}>
            {isSaving ? 'Guardando...' : isEdit ? 'Guardar Cambios' : 'Crear Cliente'}
          </Button>
        </div>
      </div>
    </div>
  );
}
