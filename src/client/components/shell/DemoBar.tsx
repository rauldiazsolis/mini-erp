import { anonymousSignal } from '../../state/auth-state.ts';

/** El alta con el rubro de la demo (#24): sin `return_url`, nace un comercio nuevo y se entra al admin. */
export function demoAltaUrl(template: string): string {
  return `/alta?template=${encodeURIComponent(template)}`;
}

/** La franja fija del acceso anónimo de una demo (#24): qué es y "Crear mi comercio". */
export function DemoBar() {
  const state = anonymousSignal.value;
  if (state?.access !== 'demo') return null;
  return (
    <div
      role="status"
      class="bg-sky-500/15 border-b border-sky-500/30 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-sky-800 dark:text-sky-200 z-40 sticky top-0 backdrop-blur-md"
    >
      <span class="flex flex-wrap items-center gap-2">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-sky-500" />
        <strong>Demo de mini contax: lo que cambies lo ven los demás visitantes</strong>
        <span class="text-sky-700/80 dark:text-sky-300/80">· tu caja es {state.pointOfSale}</span>
      </span>
      <a
        href={demoAltaUrl(state.template)}
        class="px-2.5 py-1 bg-sky-500/20 hover:bg-sky-500/30 rounded-lg font-semibold transition-colors cursor-pointer"
      >
        Crear mi comercio
      </a>
    </div>
  );
}
