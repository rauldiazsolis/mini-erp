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
import { Modal } from '../ui/Modal.tsx';

export function CustomerModal() {
  const isOpen = customerModalOpenSignal.value;
  if (!isOpen) return null;

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
    <Modal
      isOpen={isOpen}
      onClose={closeCustomerModal}
      title={isEdit ? 'Editar Cliente' : 'Nuevo Cliente'}
      subtitle={
        isEdit
          ? `Modificando datos de "${editingCustomerSignal.value?.name ?? ''}"`
          : 'Ficha comercial y límites de cuenta corriente'
      }
      icon={<span>{isEdit ? '✏️' : '👤'}</span>}
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

        {/* Nombre / Denominación */}
        <Input
          label="Nombre Completo o Razón Social *"
          placeholder="Ej: Juan Pérez, Distribuidora San Juan S.A."
          value={data.name}
          onInput={(e) => { updateField('name', (e.target as HTMLInputElement).value); }}
          autoFocus
        />

        {/* Documento y Teléfono */}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="DNI / CUIT / Identificación"
            placeholder="20-30444555-8"
            value={data.document}
            onInput={(e) => { updateField('document', (e.target as HTMLInputElement).value); }}
          />

          <Input
            label="Teléfono de Contacto"
            placeholder="+54 9 11 4455-6677"
            value={data.phone}
            onInput={(e) => { updateField('phone', (e.target as HTMLInputElement).value); }}
          />
        </div>

        {/* Configuración de Cuenta Corriente */}
        <div class="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div class="flex items-center justify-between">
            <label class="text-xs font-bold text-slate-800 dark:text-slate-200">Condiciones de Cuenta Corriente</label>
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={data.unrestricted}
                onChange={(e) => { updateField('unrestricted', (e.target as HTMLInputElement).checked); }}
                class="w-4 h-4 rounded text-indigo-600 bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 focus:ring-indigo-500"
              />
              <span class="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Sin límite de crédito</span>
            </label>
          </div>

          {!data.unrestricted && (
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Límite de Crédito ($ ARS)</label>
                <input
                  type="number"
                  step="1000"
                  min="0"
                  value={data.creditLimit}
                  onInput={(e) => { updateField('creditLimit', parseFloat((e.target as HTMLInputElement).value) || 0); }}
                  class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Margen de Tolerancia ($ ARS)</label>
                <input
                  type="number"
                  step="500"
                  min="0"
                  value={data.margin}
                  onInput={(e) => { updateField('margin', parseFloat((e.target as HTMLInputElement).value) || 0); }}
                  class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}

          {!isEdit && (
            <div>
              <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Saldo Inicial en Cuenta Corriente ($ ARS)
              </label>
              <input
                type="number"
                step="100"
                value={data.initialBalance || ''}
                placeholder="0.00 (Positivo: Deudor, Negativo: Saldo a Favor)"
                onInput={(e) => { updateField('initialBalance', parseFloat((e.target as HTMLInputElement).value) || 0); }}
                class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div class="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closeCustomerModal} disabled={isSaving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => { void submitCustomerForm(); }} disabled={isSaving}>
            {isSaving ? 'Guardando...' : isEdit ? 'Guardar Cambios' : 'Crear Cliente'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
