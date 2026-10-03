import {
  isAuthenticatedSignal,
  tokenSignal,
  currentUserSignal,
  fetchProfile,
} from './state/auth-state.ts';
import { activeViewSignal } from './state/navigation-state.ts';
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
import { initRouting, routeSignal } from './state/route-state.ts';
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

  if (routeSignal.value === 'landing') {
    return <LandingView />;
  }

  // Links de invitación y restablecimiento (#19): se abren con o sin sesión
  if (routeSignal.value === 'invitacion') {
    return <InvitationView />;
  }

  if (routeSignal.value === 'restablecer') {
    return <ResetPasswordView />;
  }

  if (routeSignal.value === 'alta' || merchantOnboardingActiveSignal.value) {
    return <MerchantOnboardingView />;
  }

  if (!isAuthenticatedSignal.value) {
    return <AuthView />;
  }

  const currentView = activeViewSignal.value;

  // Comercio restringido por deuda (#21): solo Créditos y Configuración (cuenta y apariencia); Plataforma no es del comercio
  if (isRestrictedSignal.value && currentView !== 'credits' && currentView !== 'settings' && currentView !== 'platform') {
    return (
      <AppShell>
        <RestrictedView />
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Vista de Navegación Activa */}
      {currentView === 'dashboard' && <DashboardView />}

      {currentView === 'sales' && <SalesView />}

      {currentView === 'catalog' && <CatalogView />}

      {currentView === 'stock' && <StockView />}

      {currentView === 'customers' && <CustomerView />}

      {currentView === 'bulk' && <BulkView />}

      {currentView === 'users' && <UsersView />}

      {currentView === 'settings' && <SettingsView />}

      {currentView === 'credits' && <CreditsView />}

      {currentView === 'platform' && <PlatformView />}
    </AppShell>
  );
}
