import { platformTabSignal, type PlatformTab } from '../../state/platform-state.ts';
import { currentUserSignal } from '../../state/auth-state.ts';
import { buildUrl } from '../../routing/admin-routes.ts';
import { Link } from '../ui/Link.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { PaymentSheetCard } from './PaymentSheetCard.tsx';
import { PlatformSettingsCard } from './PlatformSettingsCard.tsx';

const TABS: Array<{ id: PlatformTab; label: string; rootOnly: boolean }> = [
  { id: 'payments', label: 'Cobranzas', rootOnly: false },
  { id: 'settings', label: 'Configuración', rootOnly: true },
];

/** Plataforma (#21), para root y soporte: cobranzas de todos los comercios y, para root, la configuración. */
export function PlatformView() {
  const isRoot = currentUserSignal.value?.globalRole === 'root';
  const tabs = TABS.filter((t) => isRoot || !t.rootOnly);
  const tab = tabs.some((t) => t.id === platformTabSignal.value) ? platformTabSignal.value : 'payments';
  return (
    <div class="space-y-6">
      <PageHeader title="Plataforma" subtitle="Cobranzas de todos los comercios y configuración del cobro" />
      <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3" role="tablist">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={buildUrl({ kind: 'plataforma', tab: t.id })}
            role="tab"
            aria-selected={tab === t.id}
            class={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              tab === t.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {tab === 'payments' && <PaymentSheetCard />}
      {tab === 'settings' && <PlatformSettingsCard />}
    </div>
  );
}
