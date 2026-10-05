import { portalStatusSignal } from '../../state/portal-state.ts';
import { LinkPageFrame } from '../links/LinkPageFrame.tsx';

/** `/portal#t=…` (#24, M10): mientras se abre mini, o por qué no se pudo. */
export function PortalView() {
  const status = portalStatusSignal.value;
  if (status.kind === 'expired') {
    return (
      <LinkPageFrame title="Este link venció">
        <p class="text-sm text-center text-slate-600 dark:text-slate-300">Volvé a abrir mini desde el POS.</p>
      </LinkPageFrame>
    );
  }
  if (status.kind === 'error') {
    return (
      <LinkPageFrame title="No se pudo abrir mini">
        <p class="text-sm text-center text-rose-600 dark:text-rose-400">{status.message}</p>
      </LinkPageFrame>
    );
  }
  return (
    <LinkPageFrame title="Abriendo mini…">
      <p class="text-sm text-center text-slate-600 dark:text-slate-300">Un momento: mini contax se abre en esta pestaña.</p>
    </LinkPageFrame>
  );
}
