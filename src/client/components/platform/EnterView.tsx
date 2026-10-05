import { enterStatusSignal } from '../../state/impersonation-state.ts';
import { navigate } from '../../state/route-state.ts';
import { platformUrl } from '../../routing/admin-routes.ts';
import { Button } from '../ui/Button.tsx';
import { LinkPageFrame } from '../links/LinkPageFrame.tsx';

/** `/plataforma/entrar` y `/ayuda/<id>` (#23): mientras se abre la impersonación, o por qué no se pudo. */
export function EnterView() {
  const status = enterStatusSignal.value;
  if (status.kind === 'not-staff') {
    return (
      <LinkPageFrame title="Este link es para soporte">
        <p class="text-sm text-center text-slate-600 dark:text-slate-300">Entrá con una cuenta de soporte de mini contax.</p>
      </LinkPageFrame>
    );
  }
  if (status.kind === 'expired') {
    return (
      <LinkPageFrame title="Este pedido venció">
        <div class="space-y-4 text-center">
          <p class="text-sm text-slate-600 dark:text-slate-300">Los pedidos de ayuda duran 24 h, y uno nuevo cierra el anterior.</p>
          <Button onClick={() => { navigate(platformUrl('users')); }}>Ir a Usuarios</Button>
        </div>
      </LinkPageFrame>
    );
  }
  if (status.kind === 'error') {
    return (
      <LinkPageFrame title="No se pudo entrar">
        <div class="space-y-4 text-center">
          <p class="text-sm text-rose-600 dark:text-rose-400">{status.message}</p>
          <Button onClick={() => { navigate(platformUrl('users')); }}>Ir a Usuarios</Button>
        </div>
      </LinkPageFrame>
    );
  }
  return (
    <LinkPageFrame title="Entrando…">
      <p class="text-sm text-center text-slate-600 dark:text-slate-300">Abriendo la cuenta en esta pestaña.</p>
    </LinkPageFrame>
  );
}
