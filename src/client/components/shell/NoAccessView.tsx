import { navigate, currentTenantSlugSignal } from '../../state/route-state.ts';
import { Button } from '../ui/Button.tsx';

/** Un link a un comercio que no es tuyo, o que no existe (#59): se avisa, nunca se redirige en silencio. */
export function NoAccessView() {
  return (
    <div class="py-20 text-center max-w-md mx-auto space-y-4">
      <h3 class="text-lg font-bold text-slate-900 dark:text-white">No tenés acceso a este comercio o no existe</h3>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        El link apunta a <span class="font-mono">{currentTenantSlugSignal.value}</span>. Elegí uno de tus comercios arriba.
      </p>
      <Button onClick={() => { navigate('/admin'); }}>Ir a mi comercio</Button>
    </div>
  );
}
