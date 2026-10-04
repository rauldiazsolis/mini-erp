import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { ImportFileStep } from './ImportFileStep.tsx';
import { ImportMappingStep } from './ImportMappingStep.tsx';
import { ImportResultTable } from './ImportResultTable.tsx';
import {
  importStepSignal,
  importPreviewSignal,
  importErrorSignal,
  importLoadingSignal,
  importEntitySignal,
  importFileNameSignal,
  confirmImport,
  resetImport,
} from '../../state/import-state.ts';
import { navigateTo } from '../../state/navigation-state.ts';

export type ImportWizardProps = {
  /** En el alta: "Seguir" en el resultado, en lugar de "Ver clientes". */
  onDone?: (() => void) | undefined;
};

/** Asistente de importación (#22): archivo → mapeo con vista previa → resultado. */
export function ImportWizard(props: ImportWizardProps) {
  const step = importStepSignal.value;
  const preview = importPreviewSignal.value;
  const blocked = preview === null || preview.missing.length > 0 || preview.needsBranch.length > 0;
  const toImport = preview === null ? 0 : preview.totals.create + preview.totals.update;
  const errors = preview?.totals.error ?? 0;

  return (
    <Card class="space-y-5">
      <div>
        <h3 class="text-base font-bold text-slate-900 dark:text-white">Importar desde un archivo</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {importFileNameSignal.value ?? 'Productos y stock, o clientes y saldos, desde un CSV de cualquier sistema o planilla.'}
        </p>
      </div>

      {importErrorSignal.value !== null && (
        <p role="alert" class="text-sm text-rose-600 dark:text-rose-400">
          {importErrorSignal.value}
        </p>
      )}

      {step === 'file' && <ImportFileStep />}

      {step === 'mapping' && preview !== null && (
        <>
          <ImportMappingStep preview={preview} />
          <ImportResultTable preview={preview} />
          <div class="flex flex-wrap items-center justify-end gap-3">
            <Button variant="ghost" onClick={resetImport}>
              Elegir otro archivo
            </Button>
            <Button
              loading={importLoadingSignal.value}
              disabled={blocked || toImport === 0}
              onClick={() => {
                void confirmImport();
              }}
            >
              {`Importar ${String(toImport)}${errors > 0 ? ` · se omiten ${String(errors)} con errores` : ''}`}
            </Button>
          </div>
        </>
      )}

      {step === 'done' && preview !== null && (
        <>
          <ImportResultTable preview={preview} />
          <div class="flex flex-wrap justify-end gap-3">
            <Button variant="outline" onClick={resetImport}>
              Importar otro archivo
            </Button>
            {props.onDone === undefined && importEntitySignal.value === 'customers' && (
              <Button
                variant="outline"
                onClick={() => {
                  navigateTo('customers');
                }}
              >
                Ver clientes
              </Button>
            )}
            {props.onDone !== undefined && <Button onClick={props.onDone}>Seguir</Button>}
          </div>
        </>
      )}
    </Card>
  );
}
