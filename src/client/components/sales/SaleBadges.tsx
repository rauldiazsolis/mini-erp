import type { SaleKind } from '../../../shared/sales-types.ts';

const tone = {
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20',
};

function Badge(props: { tone: keyof typeof tone; label: string }) {
  return <span class={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone[props.tone]}`}>{props.label}</span>;
}

/** Marcas de un ticket o de una cobranza: anulada, anulación y devolución. */
export function SaleBadges(props: { kind?: SaleKind | undefined; voided: boolean; isVoid?: boolean | undefined }) {
  return (
    <span class="inline-flex flex-wrap gap-1">
      {props.voided && <Badge tone="rose" label="Anulada" />}
      {(props.kind === 'void' || props.isVoid === true) && <Badge tone="amber" label="Anulación" />}
      {props.kind === 'return' && <Badge tone="sky" label="Devolución" />}
    </span>
  );
}

/** Los importes negativos van en rojo. */
export function amountClass(amount: number): string {
  return amount < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white';
}
