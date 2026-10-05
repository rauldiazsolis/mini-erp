import { navigate, currentTenantSlugSignal } from '../../state/route-state.ts';
import { isRootOrSupportSignal } from '../../state/auth-state.ts';
import { platformTenantUrl } from '../../routing/admin-routes.ts';
import { Button } from '../ui/Button.tsx';

/** Un link a un comercio que no es tuyo, o que no existe (#59): se avisa, nunca se redirige en silencio. */
export function NoAccessView() {
  const slug = currentTenantSlugSignal.value;
  return (
    <div class="py-20 text-center max-w-md mx-auto space-y-4">
      <h3 class="text-lg font-bold text-slate-900 dark:text-white">No tenés acceso a este comercio o no existe</h3>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        El link apunta a <span class="font-mono">{slug}</span>. Elegí uno de tus comercios arriba.
      </p>
      <div class="flex flex-wrap justify-center gap-2">
        <Button onClick={() => { navigate('/admin'); }}>Ir a mi comercio</Button>
        {/* Root y soporte no son miembros (#16): lo ven en la plataforma */}
        {isRootOrSupportSignal.value && slug !== null && (
          <Button variant="outline" onClick={() => { navigate(platformTenantUrl(slug)); }}>
            Ver este comercio en la plataforma
          </Button>
        )}
      </div>
    </div>
  );
}
