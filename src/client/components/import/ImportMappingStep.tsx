import { Select } from '../ui/Select.tsx';
import { importMappingSignal, setColumnField } from '../../state/import-state.ts';
import {
  CUSTOMER_FIELDS,
  PRODUCT_FIELDS,
  STOCK_UNASSIGNED,
  fieldLabel,
  isImportFieldName,
  stockField,
  type ImportField,
  type ImportPreview,
} from '../../../shared/import-fields.ts';

/** Paso 2 del asistente (#22): cada columna del archivo a un campo, con la sugerencia preseleccionada. */
export function ImportMappingStep(props: { preview: ImportPreview }) {
  const { preview } = props;
  const mapping = importMappingSignal.value;
  const options: ImportField[] =
    preview.entity === 'customers'
      ? CUSTOMER_FIELDS.map((f) => f.field)
      : [...PRODUCT_FIELDS.map((f) => f.field), ...preview.branches.map((b) => stockField(b.id))];

  return (
    <div class="space-y-3">
      {preview.missing.length > 0 && (
        <p class="text-sm text-amber-700 dark:text-amber-400">
          {`Falta asignar: ${preview.missing.map((f) => fieldLabel(f, preview.branches)).join(', ')}`}
        </p>
      )}
      {preview.needsBranch.length > 0 && (
        <p class="text-sm text-amber-700 dark:text-amber-400">Elegí a qué sucursal va cada columna de stock.</p>
      )}
      <div class="divide-y divide-slate-200 dark:divide-slate-800">
        {preview.columns.map((column) => {
          const current = mapping[String(column.index)] ?? null;
          const title = column.header === '' ? `Columna ${String(column.index + 1)}` : column.header;
          return (
            <div key={column.index} class="grid grid-cols-1 sm:grid-cols-2 gap-2 py-2 items-center">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {column.samples.filter((s) => s !== '').join(' · ')}
                </div>
              </div>
              <Select
                id={`import-column-${String(column.index)}`}
                aria-label={`Campo de ${title}`}
                value={current ?? ''}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setColumnField(column.index, value !== '' && isImportFieldName(value) ? value : null);
                }}
              >
                <option value="">No importar</option>
                {current === STOCK_UNASSIGNED && <option value={STOCK_UNASSIGNED}>{fieldLabel(STOCK_UNASSIGNED, preview.branches)}</option>}
                {options.map((field) => (
                  <option key={field} value={field}>
                    {fieldLabel(field, preview.branches)}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
