import { billingStatusSignal } from '../../state/credits-state.ts';
import { canDo } from '../../state/permissions-state.ts';
import { navigateTo } from '../../state/navigation-state.ts';
import { downloadExport } from '../../state/bulk-state.ts';
import { formatMoney } from '../../format.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';

/**
 * El comercio pasó la gracia con deuda (#21): mini queda en Créditos y exportar. El POS sigue
 * vendiendo y sincronizando.
 */
export function RestrictedView() {
  const debt = billingStatusSignal.value?.debt ?? 0;
  const canPay = canDo('credits.view');
  const canExport = canDo('bulk');
  return (
    <div class="py-12">
      <Card class="max-w-lg mx-auto text-center space-y-4">
        <div class="text-3xl">⏸️</div>
        <h2 class="text-lg font-bold text-slate-900 dark:text-white">mini contax está restringido por deuda</h2>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          Deuda: <strong>{formatMoney(debt)}</strong>. El POS sigue vendiendo y sincronizando: no perdés ventas.
        </p>
        {canPay ? (
          <div class="flex flex-col sm:flex-row justify-center gap-2">
            <Button onClick={() => { navigateTo('credits'); }}>Ver créditos y cómo pagar</Button>
          </div>
        ) : (
          <p class="text-xs text-slate-500 dark:text-slate-400">Avisale al dueño del comercio para que regularice el pago.</p>
        )}
        {canExport && (
          <div class="flex flex-col sm:flex-row justify-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button variant="outline" size="sm" onClick={() => void downloadExport('products', 'csv')}>
              Exportar productos
            </Button>
            <Button variant="outline" size="sm" onClick={() => void downloadExport('customers', 'csv')}>
              Exportar clientes
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
