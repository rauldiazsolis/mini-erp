import { importEntitySignal, importLoadingSignal, loadImportFile } from '../../state/import-state.ts';
import type { ImportEntity } from '../../../shared/import-fields.ts';

const ENTITIES: { value: ImportEntity; label: string }[] = [
  { value: 'products', label: 'Productos y stock' },
  { value: 'customers', label: 'Clientes y saldos' },
];

/** Paso 1 del asistente (#22): qué se importa y el archivo (elegido o arrastrado). */
export function ImportFileStep() {
  const pick = (file: File | undefined): void => {
    if (file !== undefined) void loadImportFile(file);
  };

  return (
    <div class="space-y-4">
      <div
        role="radiogroup"
        aria-label="Qué importar"
        class="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl"
      >
        {ENTITIES.map((entity) => {
          const active = importEntitySignal.value === entity.value;
          return (
            <button
              key={entity.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                importEntitySignal.value = entity.value;
              }}
              class={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                active
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {entity.label}
            </button>
          );
        })}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer?.files[0]);
        }}
        class="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-6 text-center space-y-2"
      >
        <label class="inline-block cursor-pointer text-sm font-semibold text-indigo-600 dark:text-indigo-400 underline">
          {importLoadingSignal.value ? 'Leyendo…' : 'Elegí el archivo'}
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            class="sr-only"
            onChange={(e) => {
              pick(e.currentTarget.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <p class="text-xs text-slate-500 dark:text-slate-400">o arrastralo acá</p>
      </div>

      <p class="text-xs text-slate-500 dark:text-slate-400">
        Exportalo desde Excel como CSV. La primera fila tiene que tener los nombres de las columnas, en cualquier orden.
        Saldo positivo: el cliente te debe.
      </p>
    </div>
  );
}
