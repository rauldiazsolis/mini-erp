import { signal } from '@preact/signals';
import {
  impersonationModalOpenSignal,
  closeImpersonationModal,
} from '../../state/navigation-state.ts';
import {
  userTenantsSignal,
  impersonateTenant,
  effectiveTenantIdSignal,
  type TenantMembershipItem,
} from '../../state/auth-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Modal.tsx';

export const impersonationSearchSignal = signal('');

export function ImpersonationModal() {
  const isOpen = impersonationModalOpenSignal.value;
  const search = impersonationSearchSignal.value.toLowerCase().trim();
  const tenants = userTenantsSignal.value.filter(
    (t) =>
      t.name.toLowerCase().includes(search) ||
      t.slug.toLowerCase().includes(search) ||
      t.tenantId.toLowerCase().includes(search),
  );

  const handleSelect = (tenant: TenantMembershipItem) => {
    try {
      impersonateTenant(tenant.tenantId);
      showToast({
        type: 'warning',
        title: 'Modo Impersonación Activado',
        message: `Ahora estás operando en nombre de "${tenant.name}" (${tenant.tenantId})`,
      });
      closeImpersonationModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al impersonar';
      showToast({ type: 'error', title: 'Error de impersonación', message: msg });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeImpersonationModal}
      title="Impersonar Comercio"
      subtitle="Accede con privilegios de soporte sobre cualquier tenant"
      maxWidth="lg"
      icon={
        <div class="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>
      }
      footer={
        <Button variant="outline" size="sm" onClick={closeImpersonationModal}>
          Cerrar
        </Button>
      }
    >
      <div class="space-y-4">
        {/* Search */}
        <div class="relative">
          <svg
            class="w-4 h-4 absolute left-3.5 top-3 text-slate-400 dark:text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nombre, slug o ID..."
            value={impersonationSearchSignal.value}
            onInput={(e) => (impersonationSearchSignal.value = (e.target as HTMLInputElement).value)}
            class="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        {/* Tenant list */}
        <div class="overflow-y-auto max-h-72 space-y-2 pr-1">
          {tenants.length === 0 ? (
            <div class="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
              No se encontraron comercios que coincidan con la búsqueda
            </div>
          ) : (
            tenants.map((t) => {
              const isCurrent = effectiveTenantIdSignal.value === t.tenantId;
              return (
                <div
                  key={t.tenantId}
                  class={`p-3 rounded-xl border transition-all flex items-center justify-between ${
                    isCurrent
                      ? 'bg-amber-500/10 border-amber-500/30'
                      : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div class="space-y-0.5">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-slate-900 dark:text-white">{t.name}</span>
                      <span
                        class={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          t.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        }`}
                      >
                        {t.status}
                      </span>
                    </div>
                    <div class="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      ID: {t.tenantId} • Slug: {t.slug}
                    </div>
                  </div>

                  <div>
                    {isCurrent ? (
                      <span class="text-xs font-semibold text-amber-600 dark:text-amber-400 px-3 py-1 bg-amber-500/20 rounded-lg">
                        Activo
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleSelect(t)}
                        class="hover:bg-amber-600 hover:text-white"
                      >
                        Impersonar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
