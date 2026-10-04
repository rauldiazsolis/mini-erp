import { pageSignal, salesTabSignal, type SalesTab } from '../../state/sales-state.ts';
import { tabUrl } from '../../state/route-state.ts';
import { Link } from '../ui/Link.tsx';

export const TABS: Array<{ id: SalesTab; label: string }> = [
  { id: 'sales', label: 'Ventas' },
  { id: 'payments', label: 'Cobranzas' },
  { id: 'movements', label: 'Movimientos de caja' },
  { id: 'summary', label: 'Resumen' },
];

export function SalesTabs() {
  const active = salesTabSignal.value;
  return (
    <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3" role="tablist">
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={tabUrl('sales', t.id)}
          role="tab"
          aria-selected={active === t.id}
          onNavigate={() => { pageSignal.value = 1; }}
          class={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            active === t.id
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
