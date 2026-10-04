import { Drawer } from '../ui/Drawer.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { canDo } from '../../state/permissions-state.ts';
import {
  closeDiscrepancies, discrepanciesSignal, discrepancyDrawerOpenSignal, dismissDiscrepancy, dismissingIdSignal,
  dismissNoteSignal, startDismiss,
} from '../../state/discrepancy-state.ts';
import { formatDateTime } from '../../format.ts';

/** Panel de discrepancias (#2): cada fila con su caja, cliente y monto; owner y admin las descartan. */
export function DiscrepancyDrawer() {
  const canDismiss = canDo('settings.manage');
  return (
    <Drawer
      isOpen={discrepancyDrawerOpenSignal.value}
      onClose={closeDiscrepancies}
      title="Movimientos para revisar"
      subtitle="Lo que mandó una caja y mini contax no pudo aplicar o le pareció raro"
    >
      <div class="space-y-3">
        {discrepanciesSignal.value.map((d) => (
          <div key={d.id} class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2">
            <p class="text-sm text-slate-900 dark:text-slate-100">{d.message}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {d.originPos ?? 'Caja sin nombre'} · {d.originBranch ?? 'Sin sucursal'} · {formatDateTime(d.createdAt)} · cliente {d.customerId} ·{' '}
              {d.refType === 'sale' ? 'venta' : 'cobranza'} {d.refId}
            </p>
            {canDismiss && dismissingIdSignal.value !== d.id && (
              <Button variant="secondary" size="sm" onClick={() => { startDismiss(d.id); }}>Descartar</Button>
            )}
            {canDismiss && dismissingIdSignal.value === d.id && (
              <div class="flex gap-2 items-end">
                <Input
                  label="Motivo"
                  value={dismissNoteSignal.value}
                  onInput={(e) => { dismissNoteSignal.value = e.currentTarget.value; }}
                />
                <Button
                  size="sm"
                  disabled={dismissNoteSignal.value.trim() === ''}
                  onClick={() => { void dismissDiscrepancy(d.id); }}
                >
                  Confirmar
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Drawer>
  );
}
