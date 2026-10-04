import { importOnlyIssuesSignal } from '../../state/import-state.ts';
import { formatQty } from '../../format.ts';
import type { ImportPreview, ImportRowAction } from '../../../shared/import-fields.ts';

const LABELS: Record<ImportRowAction, string> = {
  create: 'Se crea',
  update: 'Se actualiza',
  unchanged: 'Sin cambios',
  error: 'Error',
};

const TONES: Record<ImportRowAction, string> = {
  create: 'text-emerald-700 dark:text-emerald-400',
  update: 'text-indigo-700 dark:text-indigo-400',
  unchanged: 'text-slate-500 dark:text-slate-400',
  error: 'text-rose-700 dark:text-rose-400',
};

/** Vista previa o resultado de una importación (#22): totales y el detalle por fila. */
export function ImportResultTable(props: { preview: ImportPreview }) {
  const { preview } = props;
  const rows = importOnlyIssuesSignal.value
    ? preview.rows.filter((r) => r.action === 'error' || r.messages.length > 0)
    : preview.rows;
  const t = preview.totals;

  return (
    <div class="space-y-3">
      <p class="text-sm text-slate-700 dark:text-slate-300">
        {preview.dryRun ? 'Vista previa: ' : 'Listo: '}
        {`${formatQty(t.create)} nuevos · ${formatQty(t.update)} actualizados · ${formatQty(t.unchanged)} sin cambios · ${formatQty(t.error)} con errores`}
      </p>
      <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          checked={importOnlyIssuesSignal.value}
          onChange={(e) => (importOnlyIssuesSignal.value = e.currentTarget.checked)}
        />
        Solo errores y avisos
      </label>
      <div class="max-h-80 overflow-auto border border-slate-200 dark:border-slate-800 rounded-xl">
        <table class="w-full text-sm">
          <thead class="text-xs text-left text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 sticky top-0">
            <tr>
              <th class="px-3 py-2">Línea</th>
              <th class="px-3 py-2">Clave</th>
              <th class="px-3 py-2">Acción</th>
              <th class="px-3 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line} class="border-t border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                <td class="px-3 py-1.5 tabular-nums">{r.line}</td>
                <td class="px-3 py-1.5">{r.key}</td>
                <td class={`px-3 py-1.5 font-semibold ${TONES[r.action]}`}>{LABELS[r.action]}</td>
                <td class="px-3 py-1.5 text-xs">{r.messages.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
