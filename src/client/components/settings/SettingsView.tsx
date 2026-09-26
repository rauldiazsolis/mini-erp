import {
  activeSettingsTabSignal,
  fetchApiKeys,
  fetchSettingsBranches,
  apiKeysSignal,
  settingsBranchesSignal,
} from '../../state/settings-state.ts';
import { effectiveTenantIdSignal } from '../../state/auth-state.ts';
import { SettingsTabs } from './SettingsTabs.tsx';
import { PosKeysSection } from './PosKeysSection.tsx';
import { BranchesSection } from './BranchesSection.tsx';
import { ConnectorGuideSection } from './ConnectorGuideSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';

import { PageHeader } from '../ui/PageHeader.tsx';

let lastFetchedTenantId: string | null = null;

export function SettingsView() {
  const currentTenantId = effectiveTenantIdSignal.value;
  const activeTab = activeSettingsTabSignal.value;

  if (currentTenantId && currentTenantId !== lastFetchedTenantId) {
    lastFetchedTenantId = currentTenantId;
    fetchApiKeys();
    fetchSettingsBranches();
  } else if (currentTenantId && apiKeysSignal.value.length === 0 && settingsBranchesSignal.value.length === 0) {
    fetchApiKeys();
    fetchSettingsBranches();
  }

  return (
    <div class="space-y-6 animate-in fade-in duration-150">
      {/* Encabezado */}
      <PageHeader
        title="Configuración & Terminales POS"
        badge="Conectividad & Preferencias"
        subtitle="Gestión de API Keys para cajas registradoras, administración de sucursales físicas y personalización de interfaz"
      />

      {/* Tabs */}
      <SettingsTabs />

      {/* Secciones */}
      {activeTab === 'pos' && <PosKeysSection />}
      {activeTab === 'branches' && <BranchesSection />}
      {activeTab === 'connection' && <ConnectorGuideSection />}
      {activeTab === 'appearance' && <AppearanceSection />}
    </div>
  );
}
