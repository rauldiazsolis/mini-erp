import {
  productModalOpenSignal,
  editingProductSignal,
  productFormDataSignal,
  isSavingProductSignal,
  productFormErrorSignal,
  categoriesSignal,
  closeProductModal,
  submitProductForm,
} from '../../state/catalog-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';

export function ProductModal() {
  const isOpen = productModalOpenSignal.value;
  const isEdit = Boolean(editingProductSignal.value);
  const data = productFormDataSignal.value;
  const isSaving = isSavingProductSignal.value;
  const error = productFormErrorSignal.value;
  const categories = categoriesSignal.value;

  const updateField = <K extends keyof typeof data>(key: K, val: (typeof data)[K]) => {
    productFormDataSignal.value = {
      ...productFormDataSignal.value,
      [key]: val,
    };
  };

  const handleBarcodesChange = (val: string) => {
    const list = val
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
    updateField('barcodes', list);
  };

  const generateRandomSku = () => {
    const randomSku = `ART-${Math.floor(100000 + Math.random() * 900000)}`;
    updateField('sku', randomSku);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeProductModal}
      title={isEdit ? 'Editar Producto' : 'Nuevo Producto en Catálogo'}
      subtitle={
        isEdit
          ? `Modificando "${editingProductSignal.value?.name}"`
          : 'Completa los datos comerciales y de stock del artículo'
      }
      icon={<span>{isEdit ? '✏️' : '✨'}</span>}
      maxWidth="xl"
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

        {/* Nombre */}
        <Input
          label="Nombre del Producto / Denominación Comercial *"
          placeholder="Ej: Coca Cola 500ml, Tornillo Autoperforante..."
          value={data.name}
          onInput={(e) => updateField('name', (e.target as HTMLInputElement).value)}
          autoFocus
        />

        {/* SKU y Barcodes */}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="block text-xs font-medium text-slate-700 dark:text-slate-300">Código SKU *</label>
              {!isEdit && (
                <button
                  type="button"
                  onClick={generateRandomSku}
                  class="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  Generar automático
                </button>
              )}
            </div>
            <input
              type="text"
              value={data.sku}
              onInput={(e) => updateField('sku', (e.target as HTMLInputElement).value)}
              placeholder="SKU-1002"
              class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Códigos de Barra (separados por coma)
            </label>
            <input
              type="text"
              value={data.barcodes.join(', ')}
              onInput={(e) => handleBarcodesChange((e.target as HTMLInputElement).value)}
              placeholder="7791234567890, 7799876543210"
              class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Categoría y Precio */}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Categoría *</label>
            <input
              list="category-options"
              type="text"
              value={data.category}
              onInput={(e) => updateField('category', (e.target as HTMLInputElement).value)}
              placeholder="Selecciona o escribe..."
              class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <datalist id="category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Precio de Venta ($ ARS) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={data.price || ''}
              onInput={(e) => updateField('price', parseFloat((e.target as HTMLInputElement).value) || 0)}
              placeholder="0.00"
              class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Alícuota IVA y Control de Stock */}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center pt-2">
          <div>
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Alícuota IVA</label>
            <select
              value={data.taxRate.toString()}
              onChange={(e) => updateField('taxRate', parseFloat((e.target as HTMLSelectElement).value))}
              class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="0.21">21.0% (Tasa Estándar)</option>
              <option value="0.105">10.5% (Tasa Reducida)</option>
              <option value="0">0.0% (Exento)</option>
            </select>
          </div>

          <div class="pt-2">
            <label class="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={data.tracksStock}
                onChange={(e) => updateField('tracksStock', (e.target as HTMLInputElement).checked)}
                class="w-4 h-4 rounded text-indigo-600 bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-700 focus:ring-indigo-500"
              />
              <span class="text-xs text-slate-700 dark:text-slate-300 font-medium">Controlar stock por sucursal</span>
            </label>
            <p class="text-[10px] text-slate-500 dark:text-slate-400 mt-1 pl-6">
              Si está desactivado, el POS no limitará las ventas por existencia.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div class="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closeProductModal} disabled={isSaving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submitProductForm} disabled={isSaving}>
            {isSaving ? 'Guardando...' : isEdit ? 'Guardar Cambios' : 'Crear Producto'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
