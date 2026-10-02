import { discrepanciesSignal, openDiscrepancies } from '../../state/discrepancy-state.ts';

/** Franja de Clientes (#2): aparece solo con discrepancias abiertas. */
export function DiscrepancyBanner() {
  const count = discrepanciesSignal.value.length;
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={openDiscrepancies}
      class="w-full text-left px-4 py-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-sm font-medium hover:bg-amber-500/15 transition-colors"
    >
      {count === 1 ? '1 movimiento para revisar' : `${String(count)} movimientos para revisar`} →
    </button>
  );
}
