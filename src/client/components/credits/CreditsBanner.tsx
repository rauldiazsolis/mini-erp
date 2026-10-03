import { billingStatusSignal } from '../../state/credits-state.ts';
import { isImpersonatingSignal } from '../../state/auth-state.ts';
import { canDo } from '../../state/permissions-state.ts';
import { navigateTo } from '../../state/navigation-state.ts';
import { formatDay, formatMoney } from '../../format.ts';

const TONE = {
  warning: 'bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-200',
  danger: 'bg-rose-500/15 border-rose-500/30 text-rose-800 dark:text-rose-200',
};

/** La franja de créditos (#21): saldo para pocos días, deuda o, impersonando, comercio restringido. */
export function CreditsBanner() {
  const status = billingStatusSignal.value;
  if (status === null || status.state === 'ok') return null;
  const canSee = canDo('credits.view');
  const impersonating = isImpersonatingSignal.value;

  let tone: keyof typeof TONE = 'danger';
  let text: string;
  if (status.state === 'low') {
    if (!canSee) return null;
    tone = 'warning';
    text = 'Te quedan créditos para pocos días.';
  } else if (status.state === 'restricted') {
    // Sin impersonar, la pantalla restringida ya lo dice
    if (!impersonating) return null;
    text = `Comercio restringido por deuda (${formatMoney(status.debt)}).`;
  } else if (canSee) {
    const deadline = status.deadline === null ? '' : ` antes del ${formatDay(status.deadline)}`;
    text = `Sin créditos: debés ${formatMoney(status.debt)}. Pagá${deadline} para que mini siga funcionando.`;
  } else {
    text = 'mini contax tiene una deuda pendiente: avisale al dueño del comercio.';
  }

  return (
    <div class={`border-b px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${TONE[tone]}`} role="status">
      <span>{text}</span>
      {canSee && (
        <button
          type="button"
          onClick={() => { navigateTo('credits'); }}
          class="px-2.5 py-1 rounded-lg font-semibold bg-white/40 dark:bg-black/20 hover:bg-white/60 dark:hover:bg-black/30 cursor-pointer"
        >
          {status.state === 'low' ? 'Ver créditos' : 'Cómo pagar'}
        </button>
      )}
    </div>
  );
}
