import { anonymousSignal, leaveAnonymous } from '../../state/auth-state.ts';

/** La franja del acceso de una caja real (M10): qué caja es y "Entrar con tu cuenta". */
export function RegisterBar() {
  const state = anonymousSignal.value;
  if (state?.access !== 'register') return null;
  return (
    <div
      role="status"
      class="bg-emerald-500/15 border-b border-emerald-500/30 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-200 z-40 sticky top-0 backdrop-blur-md"
    >
      <span class="flex flex-wrap items-center gap-2">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
        <strong>
          {state.registerName} · {state.tenant.name}
        </strong>
        <span class="text-emerald-700/80 dark:text-emerald-300/80">desde el POS, solo consulta</span>
      </span>
      <button
        type="button"
        onClick={() => {
          void leaveAnonymous();
        }}
        class="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 rounded-lg font-semibold transition-colors cursor-pointer"
      >
        Entrar con tu cuenta
      </button>
    </div>
  );
}
