import { tabUrl } from '../../state/route-state.ts';
import { Card } from '../ui/Card.tsx';
import { Link } from '../ui/Link.tsx';

/** Lo que ve un usuario de un comercio suspendido en lugar de la sección (#23). */
export function SuspendedNotice() {
  return (
    <div class="py-16 max-w-md mx-auto">
      <Card class="space-y-3 text-center border-rose-300 dark:border-rose-500/30">
        <h2 class="text-lg font-bold text-slate-900 dark:text-white">Este comercio está suspendido</h2>
        <p class="text-sm text-slate-600 dark:text-slate-300">
          Escribile a soporte para reactivarlo. Tus cajas siguen vendiendo y sincronizando.
        </p>
        <Link href={tabUrl('credits', 'charges')} class="inline-block text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          Ver uso y pagos
        </Link>
      </Card>
    </div>
  );
}
