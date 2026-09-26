import type { ComponentChildren } from 'preact';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';
import { ImpersonationModal } from './ImpersonationModal.tsx';
import { OnboardingModal } from './OnboardingModal.tsx';
import { ToastContainer } from '../ui/ToastContainer.tsx';
import {
  isImpersonatingSignal,
  activeTenantSignal,
  userTenantsSignal,
  stopImpersonation,
} from '../../state/auth-state.ts';
import { openOnboardingModal } from '../../state/navigation-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { Button } from '../ui/Button.tsx';

export function AppShell(props: { children: ComponentChildren }) {
  const activeTenant = activeTenantSignal.value;
  const tenants = userTenantsSignal.value;

  const handleStopImpersonating = () => {
    stopImpersonation();
    showToast({
      type: 'info',
      title: 'Impersonación finalizada',
      message: 'Has retornado a tu comercio predeterminado',
    });
  };

  return (
    <div class="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-row selection:bg-indigo-500 selection:text-white antialiased font-sans transition-colors">
      {/* Sidebar fijo / colapsable */}
      <Sidebar />

      {/* Área Principal de Contenido */}
      <div class="flex-1 flex flex-col min-w-0">
        {/* Banner de Impersonación Activa */}
        {isImpersonatingSignal.value && (
          <div class="bg-amber-500/15 border-b border-amber-500/30 px-4 sm:px-6 py-2.5 flex items-center justify-between text-xs text-amber-600 dark:text-amber-300 z-40 sticky top-0 backdrop-blur-md">
            <div class="flex items-center gap-2">
              <span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shadow-sm shadow-amber-500/50"></span>
              <span>
                <strong>Modo Impersonación Activo:</strong> Operando como el comercio{' '}
                <span class="text-slate-900 dark:text-white font-semibold underline underline-offset-2">
                  {activeTenant?.name ?? 'Comercio'}
                </span>{' '}
                ({activeTenant?.tenantId})
              </span>
            </div>
            <button
              type="button"
              onClick={handleStopImpersonating}
              class="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-200 hover:text-amber-900 dark:hover:text-white rounded-lg font-semibold transition-colors cursor-pointer text-[11px]"
            >
              Salir de Impersonación
            </button>
          </div>
        )}

        {/* Header Superior */}
        <Header />

        {/* Vista Inyectada o Empty State */}
        <main class="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {tenants.length === 0 ? (
            <div class="py-20 text-center max-w-md mx-auto space-y-4">
              <div class="w-16 h-16 mx-auto rounded-3xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center justify-center text-3xl shadow-lg shadow-indigo-500/10">
                🏪
              </div>
              <div>
                <h3 class="text-lg font-bold text-slate-900 dark:text-white">No tienes ningún comercio asociado</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Crea tu primer comercio para comenzar a gestionar tu catálogo, sincronizar cajas registradoras y ver
                  tus métricas en tiempo real.
                </p>
              </div>
              <Button onClick={openOnboardingModal}>Crear Primer Comercio 🚀</Button>
            </div>
          ) : (
            props.children
          )}
        </main>
      </div>

      {/* Modales */}
      <ImpersonationModal />
      <OnboardingModal />

      {/* Contenedor de Notificaciones Toast */}
      <ToastContainer />
    </div>
  );
}
