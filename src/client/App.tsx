import {
  isAuthenticatedSignal,
  tokenSignal,
  currentUserSignal,
  fetchProfile,
  activeTenantSignal,
} from './state/auth-state.ts';
import { activeViewSignal } from './state/navigation-state.ts';
import { AuthView } from './components/auth/AuthView.tsx';
import { AppShell } from './components/shell/AppShell.tsx';
import { DashboardView } from './components/dashboard/DashboardView.tsx';
import { CatalogView } from './components/catalog/CatalogView.tsx';
import { StockView } from './components/stock/StockView.tsx';
import { CustomerView } from './components/customers/CustomerView.tsx';
import { BulkView } from './components/bulk/BulkView.tsx';
import { SettingsView } from './components/settings/SettingsView.tsx';
import { Card, CardHeader } from './components/ui/Card.tsx';

import {
  merchantOnboardingActiveSignal,
  initMerchantOnboardingFromUrl,
} from './state/merchant-onboarding-state.ts';
import { MerchantOnboardingView } from './components/onboarding/MerchantOnboardingView.tsx';

// Inicializar detector de onboarding desde URL/query params
if (typeof window !== 'undefined') {
  initMerchantOnboardingFromUrl();
}

// Cargar perfil al inicializar si hay un token persistido
if (typeof window !== 'undefined' && tokenSignal.value && !currentUserSignal.value) {
  fetchProfile();
}

export function App() {
  if (merchantOnboardingActiveSignal.value) {
    return <MerchantOnboardingView />;
  }

  if (!isAuthenticatedSignal.value) {
    return <AuthView />;
  }

  const currentView = activeViewSignal.value;

  return (
    <AppShell>
      {/* Vista de Navegación Activa */}
      {currentView === 'dashboard' && <DashboardView />}

      {currentView === 'catalog' && <CatalogView />}

      {currentView === 'stock' && <StockView />}

      {currentView === 'customers' && <CustomerView />}

      {currentView === 'bulk' && <BulkView />}

      {currentView === 'settings' && <SettingsView />}
    </AppShell>
  );
}
