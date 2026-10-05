import { demoEndedSignal } from '../../state/auth-state.ts';
import { LinkPageFrame } from '../links/LinkPageFrame.tsx';
import { demoAltaUrl } from './DemoBar.tsx';

/** La demo de la pestaña terminó (#24): su caja se revocó (reinicio de la demo o un día sin uso). */
export function DemoEndedView() {
  const ended = demoEndedSignal.value;
  return (
    <LinkPageFrame title="Esta demo terminó">
      <div class="space-y-4 text-center">
        <p class="text-sm text-slate-600 dark:text-slate-300">Abrí una nueva desde el POS.</p>
        <a
          href={demoAltaUrl(ended?.template ?? 'kiosco')}
          class="inline-block px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
        >
          Crear mi comercio
        </a>
      </div>
    </LinkPageFrame>
  );
}
