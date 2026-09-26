import {
  themeModeSignal,
  resolvedThemeSignal,
  setThemeMode,
  type ThemeMode,
} from '../../state/theme-state.ts';

export function ThemeToggle(props: { compact?: boolean }) {
  const currentMode = themeModeSignal.value;
  const resolved = resolvedThemeSignal.value;

  const modes: Array<{
    id: ThemeMode;
    label: string;
    description: string;
    icon: (isActive: boolean) => preact.JSX.Element;
  }> = [
    {
      id: 'light',
      label: 'Claro',
      description: 'Tema con fondos claros y alto contraste diurno',
      icon: (isActive) => (
        <svg
          class={`w-4 h-4 ${isActive ? 'text-amber-500 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ),
    },
    {
      id: 'system',
      label: 'Sistema',
      description: 'Hereda la preferencia del sistema operativo de forma automática',
      icon: (isActive) => (
        <svg
          class={`w-4 h-4 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      ),
    },
    {
      id: 'dark',
      label: 'Oscuro',
      description: 'Tema nocturno con fondos oscuros para menor fatiga visual',
      icon: (isActive) => (
        <svg
          class={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      ),
    },
  ];

  if (props.compact) {
    return (
      <div
        class="inline-flex items-center p-1 rounded-xl bg-slate-200/80 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700/80 shadow-inner"
        role="group"
        aria-label="Selector de tema de interfaz"
      >
        {modes.map((m) => {
          const isActive = currentMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => { setThemeMode(m.id); }}
              title={`Modo ${m.label} (${m.description})`}
              aria-pressed={isActive}
              class={`p-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center justify-center ${
                isActive
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {m.icon(isActive)}
              <span class="sr-only">{m.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  // Vista expandida (para Settings / Configuración)
  return (
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {modes.map((m) => {
        const isActive = currentMode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => { setThemeMode(m.id); }}
            class={`flex flex-col text-left p-4 rounded-2xl border transition-all cursor-pointer ${
              isActive
                ? 'bg-indigo-50/80 dark:bg-indigo-950/30 border-indigo-500/60 dark:border-indigo-500/50 shadow-md ring-1 ring-indigo-500/30'
                : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div class="flex items-center justify-between w-full mb-2">
              <div class="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                {m.icon(isActive)}
              </div>
              {isActive && (
                <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500 text-white">
                  Activo
                </span>
              )}
            </div>
            <div class="font-bold text-sm text-slate-900 dark:text-white">{m.label}</div>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              {m.description}
            </p>
            {m.id === 'system' && (
              <div class="mt-3 pt-2 border-t border-slate-200 dark:border-slate-800/80 text-[11px] text-slate-400 dark:text-slate-500">
                Resuelto actualmente: <span class="font-semibold text-slate-700 dark:text-slate-300 capitalize">{resolved}</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
