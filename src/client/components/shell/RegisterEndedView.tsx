import { registerEndedSignal } from '../../state/auth-state.ts';
import { LinkPageFrame } from '../links/LinkPageFrame.tsx';

/** El acceso de la caja de la pestaña terminó (M10): key rotada, caja desactivada o 2 h sin uso. */
export function RegisterEndedView() {
  const ended = registerEndedSignal.value;
  return (
    <LinkPageFrame title="Este acceso terminó">
      <div class="space-y-4 text-center">
        <p class="text-sm text-slate-600 dark:text-slate-300">Volvé a abrir mini desde el POS.</p>
        {ended !== null && (
          <a
            href={`/admin/${encodeURIComponent(ended.tenantSlug)}`}
            class="inline-block px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
          >
            Entrar con tu cuenta
          </a>
        )}
      </div>
    </LinkPageFrame>
  );
}
