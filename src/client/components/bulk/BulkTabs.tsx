import {
  activeBulkTabSignal,
  type BulkTab,
} from '../../state/bulk-state.ts';

const TABS: Array<{ id: BulkTab; label: string; icon: string }> = [
  { id: 'prices', label: 'Actualización Masiva de Precios', icon: '🏷️' },
  { id: 'interests', label: 'Devengamiento de Intereses', icon: '📈' },
  { id: 'io', label: 'Importar / Exportar Datos', icon: '💾' },
];

export function BulkTabs() {
  const activeTab = activeBulkTabSignal.value;

  return (
    <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
      {TABS.map((t) => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => (activeBulkTabSignal.value = t.id)}
            class={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              isActive
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-1 ring-indigo-400/40'
                : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-sm dark:shadow-none'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
