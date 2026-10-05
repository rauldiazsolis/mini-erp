import { platformSectionSignal } from '../../state/platform-state.ts';
import { routeSignal } from '../../state/route-state.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { PaymentSheetCard } from './PaymentSheetCard.tsx';
import { PlatformSettingsCard } from './PlatformSettingsCard.tsx';
import { TenantsTab } from './TenantsTab.tsx';
import { TenantDetailView } from './TenantDetailView.tsx';
import { UsersTab } from './UsersTab.tsx';
import { StaffTab } from './StaffTab.tsx';
import { AuditTab } from './AuditTab.tsx';
import { HelpRequestsTab } from './HelpRequestsTab.tsx';
import { DemosTab } from './DemosTab.tsx';
import { FunnelTab } from './FunnelTab.tsx';
import { VisitorsTab } from './VisitorsTab.tsx';
import { VisitorDetailView } from './VisitorDetailView.tsx';
import { LinkReadyModal } from '../users/LinkReadyModal.tsx';
import { platformNavItems } from './platform-sections.tsx';
import { isPlatformSectionAllowed } from '../../state/permissions-state.ts';

/**
 * Plataforma (#21, #23), para root y soporte: una pantalla por sección, elegida en el menú lateral
 * (#81). Una sección que no es para soporte la saca `registerPermissionEffects`; mientras, no se dibuja.
 */
export function PlatformView() {
  const route = routeSignal.value;
  if (route.kind === 'plataforma' && route.tenantSlug !== null) return <TenantDetailView />;
  if (route.kind === 'plataforma' && route.section === 'visitors' && route.params['id'] !== undefined) return <VisitorDetailView />;
  const section = platformSectionSignal.value;
  const item = platformNavItems.find((i) => i.id === section);
  if (item === undefined || !isPlatformSectionAllowed(section)) return <></>;
  return (
    <div class="space-y-6">
      <PageHeader title={item.label} subtitle={item.subtitle} />
      {section === 'tenants' && <TenantsTab />}
      {section === 'users' && <UsersTab />}
      {section === 'requests' && <HelpRequestsTab />}
      {section === 'demos' && <DemosTab />}
      {section === 'funnel' && <FunnelTab />}
      {section === 'visitors' && <VisitorsTab />}
      {section === 'payments' && <PaymentSheetCard />}
      {section === 'staff' && <StaffTab />}
      {section === 'audit' && <AuditTab />}
      {section === 'settings' && <PlatformSettingsCard />}
      <LinkReadyModal />
    </div>
  );
}
