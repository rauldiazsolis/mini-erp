import { impersonationEndedSignal, resumeOwnSession } from '../../state/auth-state.ts';
import { Button } from '../ui/Button.tsx';
import { LinkPageFrame } from '../links/LinkPageFrame.tsx';

/** La impersonación de la pestaña terminó (#23): venció, salió o se cerró la sesión de soporte. */
export function ImpersonationEndedView() {
  const ended = impersonationEndedSignal.value;
  return (
    <LinkPageFrame title={`La sesión como ${ended?.userName ?? 'el usuario'} terminó`}>
      <div class="space-y-4 text-center">
        <p class="text-sm text-slate-600 dark:text-slate-300">Venció por falta de uso, se salió en otra pestaña o se cerró la sesión de soporte.</p>
        <Button onClick={() => void resumeOwnSession()}>Ir a la plataforma</Button>
      </div>
    </LinkPageFrame>
  );
}
