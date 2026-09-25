import type { ComponentChildren } from 'preact';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';
import { ImpersonationModal } from './ImpersonationModal.tsx';
import { ToastContainer } from '../ui/ToastContainer.tsx';
import {
  isImpersonatingSignal,
  activeTenantSignal,
  stopImpersonation,
} from '../../state/auth-state.ts';
import { showToast } from '../../state/toast-state.ts';

export function AppShell(props: { children: ComponentChildren }) {
  const activeTenant = activeTenantSignal.value;

  const handleStopImpersonating = () => {
    stopImpersonation();
    showToast({
      type: 'info',
      title: 'Impersonación finalizada',
      message: 'Has retornado a tu comercio predeterminado',
    });
  };

  return (
    <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-row selection:bg-indigo-500 selection:text-white antialiased font-sans">
      {/* Sidebar fijo / colapsable */}
      <Sidebar />

      {/* Área Principal de Contenido */}
      <div class="flex-1 flex flex-col min-w-0">
        {/* Banner de Impersonación Activa */}
        {isImpersonatingSignal.value && (
          <div class="bg-amber-500/15 border-b border-amber-500/30 px-4 sm:px-6 py-2.5 flex items-center justify-between text-xs text-amber-300 z-40 sticky top-0 backdrop-blur-md">
            <div class="flex items-center gap-2">
              <span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shadow-sm shadow-amber-400/50"></span>
              <span>
                <strong>Modo Impersonación Activo:</strong> Operando como el comercio{' '}
                <span class="text-white font-semibold underline underline-offset-2">
                  {activeTenant?.name ?? 'Comercio'}
                </span>{' '}
                ({activeTenant?.tenantId})
              </span>
            </div>
            <button
              type="button"
              onClick={handleStopImpersonating}
              class="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 hover:text-white rounded-lg font-semibold transition-colors cursor-pointer text-[11px]"
            >
              Salir de Impersonación
            </button>
          </div>
        )}

        {/* Header Superior */}
        <Header />

        {/* Vista Inyectada */}
        <main class="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">{props.children}</main>
      </div>

      {/* Modal de Impersonación */}
      <ImpersonationModal />

      {/* Contenedor de Notificaciones Toast */}
      <ToastContainer />
    </div>
  );
}
