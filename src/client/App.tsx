import type { JSX } from 'preact';
import {
  isAuthenticatedSignal,
  tokenSignal,
  currentUserSignal,
  fetchProfile,
  tenantAccessSignal,
} from './state/auth-state.ts';
import { activeSectionSignal, initRouting, routeSignal } from './state/route-state.ts';
import type { NavSection } from './routing/admin-routes.ts';
import { NoAccessView } from './components/shell/NoAccessView.tsx';
import { AuthView } from './components/auth/AuthView.tsx';
import { AppShell } from './components/shell/AppShell.tsx';
import { DashboardView } from './components/dashboard/DashboardView.tsx';
import { SalesView } from './components/sales/SalesView.tsx';
import { CatalogView } from './components/catalog/CatalogView.tsx';
import { StockView } from './components/stock/StockView.tsx';
import { CustomerView } from './components/customers/CustomerView.tsx';
import { BulkView } from './components/bulk/BulkView.tsx';
import { SettingsView } from './components/settings/SettingsView.tsx';
import { UsersView } from './components/users/UsersView.tsx';
import { CreditsView } from './components/credits/CreditsView.tsx';
import { RestrictedView } from './components/credits/RestrictedView.tsx';
import { PlatformView } from './components/platform/PlatformView.tsx';
import { isRestrictedSignal } from './state/credits-state.ts';

import {
  merchantOnboardingActiveSignal,
  initMerchantOnboardingFromUrl,
} from './state/merchant-onboarding-state.ts';
import { MerchantOnboardingView } from './components/onboarding/MerchantOnboardingView.tsx';
import { LandingView } from './components/landing/LandingView.tsx';
import { initLinkPageFromUrl } from './state/link-pages-state.ts';
import { InvitationView } from './components/links/InvitationView.tsx';
import { ResetPasswordView } from './components/links/ResetPasswordView.tsx';
import { maintenanceSignal } from './state/maintenance-state.ts';
import { MaintenanceView } from './components/maintenance/MaintenanceView.tsx';

// Ruta del SPA (#9) y, en /alta, los parámetros del alta
if (typeof window !== 'undefined') {
  initRouting();
  initMerchantOnboardingFromUrl();
  initLinkPageFromUrl();
}

// Cargar perfil al inicializar si hay un token persistido
if (typeof window !== 'undefined' && tokenSignal.value && !currentUserSignal.value) {
  void fetchProfile();
}

export function App() {
  // Servidor en mantenimiento (#47): tapa todo, incluidos el landing, el alta y los links
  if (maintenanceSignal.value) {
    return <MaintenanceView />;
  }

  const route = routeSignal.value;
  if (route.kind === 'landing') return <LandingView />;
  // Links de invitación y restablecimiento (#19): se abren con o sin sesión
  if (route.kind === 'invitacion') return <InvitationView />;
  if (route.kind === 'restablecer') return <ResetPasswordView />;
  if (route.kind === 'alta' || merchantOnboardingActiveSignal.value) return <MerchantOnboardingView />;
  // Sin sesión, el login en la misma URL: al entrar se abre esa pantalla (#59)
  if (!isAuthenticatedSignal.value) return <AuthView />;

  if (tenantAccessSignal.value === 'denied') {
    return (
      <AppShell>
        <NoAccessView />
      </AppShell>
    );
  }

  const section = activeSectionSignal.value ?? 'dashboard';
  // Comercio restringido por deuda (#21): solo Uso y pagos y Configuración; Plataforma no es del comercio
  if (isRestrictedSignal.value && section !== 'credits' && section !== 'settings' && section !== 'platform') {
    return (
      <AppShell>
        <RestrictedView />
      </AppShell>
    );
  }

  const View = VIEWS[section];
  return (
    <AppShell>
      <View />
    </AppShell>
  );
}

/** Una vista por sección: el tipo obliga a que estén todas (#59). */
const VIEWS: Record<NavSection, () => JSX.Element> = {
  dashboard: DashboardView,
  sales: SalesView,
  catalog: CatalogView,
  stock: StockView,
  customers: CustomerView,
  bulk: BulkView,
  users: UsersView,
  settings: SettingsView,
  credits: CreditsView,
  platform: PlatformView,
};
