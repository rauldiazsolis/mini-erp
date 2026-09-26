import { signal } from '@preact/signals';
import {
  currentUserSignal,
  activeTenantSignal,
  userTenantsSignal,
  setActiveTenant,
  effectiveTenantIdSignal,
  isRootOrSupportSignal,
  logout,
} from '../../state/auth-state.ts';
import {
  toggleMobileMenu,
  openImpersonationModal,
  openOnboardingModal,
} from '../../state/navigation-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';

export const tenantDropdownOpenSignal = signal(false);

export function toggleTenantDropdown(): void {
  tenantDropdownOpenSignal.value = !tenantDropdownOpenSignal.value;
}

export function closeTenantDropdown(): void {
  tenantDropdownOpenSignal.value = false;
}

export function Header() {
  const user = currentUserSignal.value;
  const activeTenant = activeTenantSignal.value;
  const tenants = userTenantsSignal.value;
  const isDropdownOpen = tenantDropdownOpenSignal.value;

  const handleSelectTenant = (tenantId: string) => {
    setActiveTenant(tenantId);
    closeTenantDropdown();
    showToast({
      type: 'info',
      title: 'Comercio seleccionado',
      message: `Cambiado a ${activeTenant?.name ?? tenantId}`,
    });
  };

  return (
    <header class="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between z-30 sticky top-0 transition-colors">
      {/* Izquierda: Botón Móvil & Selector de Tenant */}
      <div class="flex items-center gap-3">
        {/* Toggle Móvil */}
        <button
          type="button"
          onClick={toggleMobileMenu}
          class="lg:hidden p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Tenant Selector Dropdown */}
        <div class="relative">
          <button
            type="button"
            onClick={toggleTenantDropdown}
            class="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800/80 dark:hover:bg-slate-800 border border-slate-300/80 dark:border-slate-700/80 transition-all text-left cursor-pointer group"
          >
            <div class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse"></div>
            <div>
              <div class="text-xs font-bold text-slate-800 dark:text-white tracking-tight leading-none group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">
                {activeTenant?.name ?? 'Seleccionar Comercio'}
              </div>
              <div class="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5 leading-none">
                {activeTenant ? activeTenant.tenantId : 'Sin selección'}
              </div>
            </div>
            <svg class="w-4 h-4 text-slate-400 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Menú Desplegable */}
          {isDropdownOpen && (
            <div class="absolute left-0 mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div class="px-3 py-2 border-b border-slate-200 dark:border-slate-800 text-[10px] uppercase font-bold tracking-wider text-slate-500">
                Tus Comercios ({tenants.length})
              </div>

              <div class="max-h-60 overflow-y-auto py-1">
                {tenants.map((t) => {
                  const isCurrent = effectiveTenantIdSignal.value === t.tenantId;
                  return (
                    <button
                      key={t.tenantId}
                      type="button"
                      onClick={() => { handleSelectTenant(t.tenantId); }}
                      class={`w-full px-3 py-2 text-left flex items-center justify-between text-xs transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                        isCurrent
                          ? 'bg-indigo-50 dark:bg-indigo-600/10 text-indigo-600 dark:text-indigo-300 font-semibold'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div class="truncate pr-2">
                        <div class="truncate text-slate-900 dark:text-white font-medium">{t.name}</div>
                        <div class="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{t.tenantId}</div>
                      </div>
                      {isCurrent && (
                        <svg class="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>

              <div class="p-1.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 space-y-1">
                {isRootOrSupportSignal.value && (
                  <button
                    type="button"
                    onClick={() => {
                      closeTenantDropdown();
                      openImpersonationModal();
                    }}
                    class="w-full px-2.5 py-1.5 text-left text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    Impersonar comercio...
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    closeTenantDropdown();
                    openOnboardingModal();
                  }}
                  class="w-full px-2.5 py-1.5 text-left text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                  </svg>
                  Crear nuevo comercio...
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Derecha: Selector de Tema, Usuario y Logout */}
      <div class="flex items-center gap-3 sm:gap-4">
        {/* Toggle de Tema Compacto */}
        <ThemeToggle compact />

        {/* Info Usuario */}
        <div class="hidden sm:block text-right">
          <div class="text-xs font-semibold text-slate-800 dark:text-slate-200">{user?.name}</div>
          <div class="flex items-center justify-end gap-1 mt-0.5">
            <span
              class={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                user?.globalRole === 'root'
                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                  : user?.globalRole === 'support'
                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                  : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30'
              }`}
            >
              {user?.globalRole}
            </span>
            <span class="text-[10px] text-slate-500">{user?.email}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          title="Cerrar sesión"
          class="p-2 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
