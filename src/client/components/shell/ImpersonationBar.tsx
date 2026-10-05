import { activeTenantSignal, impersonationSignal, type ImpersonationState } from '../../state/auth-state.ts';
import { exitImpersonation } from '../../state/impersonation-state.ts';
import { ROLE_LABEL } from '../../state/permissions-state.ts';
import type { TenantRole } from '../../../shared/permissions.ts';

/** "Estás viendo como Juan (owner de Kiosco X)": el comercio es el de la URL, con el rol del usuario ahí. */
export function impersonationBarText(state: ImpersonationState, tenant: { name: string; role: TenantRole } | null): string {
  const base = `Estás viendo como ${state.user.name}`;
  return tenant === null ? base : `${base} (${ROLE_LABEL[tenant.role].toLowerCase()} de ${tenant.name})`;
}

/** La franja fija de una pestaña que impersona (#23): como quién, quién está adentro y "Salir". */
export function ImpersonationBar() {
  const state = impersonationSignal.value;
  if (state === null) return null;
  return (
    <div
      role="status"
      class="bg-amber-500/15 border-b border-amber-500/30 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-800 dark:text-amber-200 z-40 sticky top-0 backdrop-blur-md"
    >
      <span class="flex flex-wrap items-center gap-2">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
        <strong>{impersonationBarText(state, activeTenantSignal.value)}</strong>
        <span class="text-amber-700/80 dark:text-amber-300/80">· {state.impersonator.name}</span>
      </span>
      <button
        type="button"
        onClick={() => void exitImpersonation()}
        class="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 rounded-lg font-semibold transition-colors cursor-pointer"
      >
        Salir
      </button>
    </div>
  );
}
