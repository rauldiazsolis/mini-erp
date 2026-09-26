import {
  activeSettingsTabSignal,
  type SettingsTab,
} from '../../state/settings-state.ts';

const TABS: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'pos', label: 'Terminales POS & API Keys', icon: '📡' },
  { id: 'branches', label: 'Gestión de Sucursales', icon: '🏢' },
  { id: 'connection', label: 'Guía de Sincronización Connector', icon: '🔌' },
  { id: 'appearance', label: 'Apariencia & Tema', icon: '🎨' },
];

export function SettingsTabs() {
  const activeTab = activeSettingsTabSignal.value;

  return (
    <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
      {TABS.map((t) => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => (activeSettingsTabSignal.value = t.id)}
            class={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              isActive
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-1 ring-indigo-400/40'
                : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
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
