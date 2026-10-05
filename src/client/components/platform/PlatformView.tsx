import { platformTabSignal, type PlatformTab } from '../../state/platform-state.ts';
import { currentUserSignal } from '../../state/auth-state.ts';
import { routeSignal } from '../../state/route-state.ts';
import { platformUrl } from '../../routing/admin-routes.ts';
import { Link } from '../ui/Link.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { PaymentSheetCard } from './PaymentSheetCard.tsx';
import { PlatformSettingsCard } from './PlatformSettingsCard.tsx';
import { TenantsTab } from './TenantsTab.tsx';
import { TenantDetailView } from './TenantDetailView.tsx';
import { UsersTab } from './UsersTab.tsx';
import { StaffTab } from './StaffTab.tsx';
import { AuditTab } from './AuditTab.tsx';
import { LinkReadyModal } from '../users/LinkReadyModal.tsx';

const TABS: Array<{ id: PlatformTab; label: string; rootOnly: boolean }> = [
  { id: 'tenants', label: 'Comercios', rootOnly: false },
  { id: 'users', label: 'Usuarios', rootOnly: false },
  { id: 'payments', label: 'Cobranzas', rootOnly: false },
  { id: 'staff', label: 'Soporte', rootOnly: true },
  { id: 'audit', label: 'Registro', rootOnly: false },
  { id: 'settings', label: 'Configuración', rootOnly: true },
];

/** Plataforma (#21, #23), para root y soporte: comercios, usuarios, cobranzas, registro y, para root, el equipo y la configuración. */
export function PlatformView() {
  const route = routeSignal.value;
  if (route.kind === 'plataforma' && route.tenantSlug !== null) return <TenantDetailView />;
  const isRoot = currentUserSignal.value?.globalRole === 'root';
  const tabs = TABS.filter((t) => isRoot || !t.rootOnly);
  const tab = tabs.some((t) => t.id === platformTabSignal.value) ? platformTabSignal.value : 'tenants';
  return (
    <div class="space-y-6">
      <PageHeader title="Plataforma" subtitle="Comercios, usuarios, cobro y equipo de mini contax" />
      <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3" role="tablist">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={platformUrl(t.id)}
            role="tab"
            aria-selected={tab === t.id}
            class={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              tab === t.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {tab === 'tenants' && <TenantsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'payments' && <PaymentSheetCard />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'settings' && <PlatformSettingsCard />}
      <LinkReadyModal />
    </div>
  );
}
