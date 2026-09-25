import { signal, computed } from '@preact/signals';

export const appTitleSignal = signal('Mini-ERP Admin');
export const counterSignal = signal(0);
export const doubleCounterSignal = computed(() => counterSignal.value * 2);

export function App() {
  return (
    <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 selection:bg-indigo-500 selection:text-white">
      <div class="max-w-md w-full bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-500/10 text-indigo-400 mb-6 border border-indigo-500/20 shadow-inner">
          <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>

        <h1 class="text-2xl font-bold tracking-tight text-white mb-2">{appTitleSignal}</h1>
        <p class="text-sm text-slate-400 mb-6">
          Preact + Signals + Tailwind CSS + TanStack Query
        </p>

        <div class="bg-slate-950/60 rounded-xl p-5 mb-6 border border-slate-800/80 space-y-3">
          <div>
            <span class="text-xs font-semibold uppercase tracking-wider text-slate-500 block mb-1">
              Contador Reactivo (Signal)
            </span>
            <span class="text-4xl font-extrabold text-indigo-400 tracking-tight">
              {counterSignal}
            </span>
          </div>

          <div class="pt-2 border-t border-slate-800/60">
            <span class="text-xs text-slate-400">
              Valor duplicado (Computed): <strong class="text-slate-200">{doubleCounterSignal}</strong>
            </span>
          </div>
        </div>

        <div class="flex gap-3 justify-center">
          <button
            type="button"
            class="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium rounded-xl text-sm transition-all duration-150 shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/30"
            onClick={() => counterSignal.value++}
          >
            Incrementar
          </button>
          <button
            type="button"
            class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-800 active:bg-slate-700 text-slate-300 font-medium rounded-xl text-sm transition-colors border border-slate-700/80"
            onClick={() => (counterSignal.value = 0)}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
