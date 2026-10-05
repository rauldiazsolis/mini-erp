import type { ComponentChildren } from 'preact';
import { Sidebar } from './Sidebar.tsx';
import { Header } from './Header.tsx';
import { openMerchantOnboarding } from '../../state/merchant-onboarding-state.ts';
import { PageToasts } from '../ui/ToastContainer.tsx';
import { userTenantsSignal } from '../../state/auth-state.ts';
import { activeSectionSignal } from '../../state/route-state.ts';
import { Button } from '../ui/Button.tsx';
import { CreditsBanner } from '../credits/CreditsBanner.tsx';
import { SuspendedNotice } from './SuspendedNotice.tsx';
import { suspendedNoticeSignal } from '../../state/suspension-state.ts';

export function AppShell(props: { children: ComponentChildren }) {
  const tenants = userTenantsSignal.value;

  return (
    <div class="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-row selection:bg-indigo-500 selection:text-white antialiased font-sans transition-colors">
      {/* Sidebar fijo / colapsable */}
      <Sidebar />

      {/* Área Principal de Contenido */}
      <div class="flex-1 flex flex-col min-w-0">
        {/* Franja de créditos (#21) */}
        <CreditsBanner />

        {/* Header Superior */}
        <Header />

        {/* Vista Inyectada o Empty State (Plataforma no depende de tener un comercio) */}
        <main class="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {tenants.length === 0 && activeSectionSignal.value !== 'platform' ? (
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
              <Button
                onClick={() => {
                  openMerchantOnboarding();
                }}
              >
                Crear mi comercio
              </Button>
            </div>
          ) : suspendedNoticeSignal.value ? (
            <SuspendedNotice />
          ) : (
            props.children
          )}
        </main>
      </div>

      {/* Contenedor de Notificaciones Toast */}
      <PageToasts />
    </div>
  );
}
