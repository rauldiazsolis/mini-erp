import { anonymousSignal } from '../../state/auth-state.ts';
import { contactSentSignal, openContact } from '../../state/funnel-public-state.ts';
import { ContactModal } from '../funnel/ContactModal.tsx';

/**
 * El alta con el rubro de la demo (#24): sin `return_url`, nace un comercio nuevo y se entra al admin.
 * Lleva el id de la demo, así el comercio queda ligado a su visitante (#25).
 */
export function demoAltaUrl(template: string, demoSessionId?: string): string {
  const base = `/alta?template=${encodeURIComponent(template)}`;
  return demoSessionId === undefined ? base : `${base}&demo=${encodeURIComponent(demoSessionId)}`;
}

const ACTION_CLASS = 'px-2.5 py-1 bg-sky-500/20 hover:bg-sky-500/30 rounded-lg font-semibold transition-colors cursor-pointer';

/** La franja fija del acceso anónimo de una demo (#24): qué es, el contacto (#25) y "Crear mi comercio". */
export function DemoBar() {
  const state = anonymousSignal.value;
  if (state?.access !== 'demo') return null;
  return (
    <div
      role="status"
      class="bg-sky-500/15 border-b border-sky-500/30 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-sky-800 dark:text-sky-200 z-40 sticky top-0 backdrop-blur-md"
    >
      <span class="flex flex-wrap items-center gap-2">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-sky-500" />
        <strong>Demo de mini contax: lo que cambies lo ven los demás visitantes</strong>
        <span class="text-sky-700/80 dark:text-sky-300/80">· tu caja es {state.pointOfSale}</span>
      </span>
      <span class="flex flex-wrap items-center gap-2">
        {contactSentSignal.value ? (
          <span>Listo, te escribimos por WhatsApp</span>
        ) : (
          <button
            type="button"
            class={ACTION_CLASS}
            onClick={() => {
              openContact('demo', state.demoSessionId);
            }}
          >
            ¿Querés que te ayudemos a empezar?
          </button>
        )}
        <a href={demoAltaUrl(state.template, state.demoSessionId)} class={ACTION_CLASS}>
          Crear mi comercio
        </a>
      </span>
      <ContactModal />
    </div>
  );
}
