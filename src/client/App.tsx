import {
  isAuthenticatedSignal,
  currentUserSignal,
  activeTenantSignal,
  userTenantsSignal,
  isImpersonatingSignal,
  logout,
  stopImpersonation,
  fetchProfile,
  tokenSignal,
} from './state/auth-state.ts';
import { AuthView } from './components/auth/AuthView.tsx';
import { Button } from './components/ui/Button.tsx';
import { Card } from './components/ui/Card.tsx';

// Cargar perfil al inicializar si hay un token persistido
if (typeof window !== 'undefined' && tokenSignal.value && !currentUserSignal.value) {
  fetchProfile();
}

export function App() {
  if (!isAuthenticatedSignal.value) {
    return <AuthView />;
  }

  const user = currentUserSignal.value;
  const activeTenant = activeTenantSignal.value;
  const tenants = userTenantsSignal.value;

  return (
    <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Banner de Impersonación Activa */}
      {isImpersonatingSignal.value && (
        <div class="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between text-xs text-amber-300">
          <div class="flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
            <span>
              Modo Impersonación Activo: Estás navegando como el comercio{' '}
              <strong>{activeTenant?.name ?? 'Tenant'}</strong> ({activeTenant?.tenantId})
            </span>
          </div>
          <button
            type="button"
            onClick={stopImpersonation}
            class="text-amber-200 hover:text-white font-semibold underline underline-offset-2 cursor-pointer"
          >
            Salir de Impersonación
          </button>
        </div>
      )}

      {/* Header temporal */}
      <header class="h-16 border-b border-slate-800 bg-slate-900/60 backdrop-blur px-6 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 class="text-sm font-bold text-white tracking-tight">Mini-ERP Admin</h1>
            <span class="text-xs text-slate-400">{activeTenant?.name ?? 'Sin tenant activo'}</span>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="text-right">
            <div class="text-xs font-medium text-slate-200">{user?.name}</div>
            <div class="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider">
              {user?.globalRole}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={logout}>
            Cerrar Sesión
          </Button>
        </div>
      </header>

      {/* Contenido principal temporal */}
      <main class="flex-1 p-6 max-w-5xl mx-auto w-full">
        <Card class="mt-4">
          <h2 class="text-lg font-bold text-white mb-2">¡Sesión Iniciada con Éxito!</h2>
          <p class="text-xs text-slate-400 mb-4">
            Estado de autenticación reactivo verificado con Preact Signals y TanStack Query Core.
          </p>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div class="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <span class="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
                Usuario
              </span>
              <div class="text-sm font-semibold text-white">{user?.name}</div>
              <div class="text-xs text-slate-400">{user?.email}</div>
            </div>

            <div class="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <span class="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
                Rol Global
              </span>
              <div class="text-sm font-semibold text-indigo-400 uppercase">{user?.globalRole}</div>
              <div class="text-xs text-slate-400">Permisos del sistema</div>
            </div>

            <div class="bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <span class="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-1">
                Tenants Disponibles
              </span>
              <div class="text-sm font-semibold text-white">{tenants.length} comercios</div>
              <div class="text-xs text-slate-400">
                {activeTenant ? `Activo: ${activeTenant.name}` : 'Ninguno seleccionado'}
              </div>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
