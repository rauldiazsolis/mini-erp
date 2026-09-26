import { activeSettingsTabSignal } from '../../state/settings-state.ts';
import { SettingsTabs } from './SettingsTabs.tsx';
import { PosKeysSection } from './PosKeysSection.tsx';
import { BranchesSection } from './BranchesSection.tsx';
import { ConnectorGuideSection } from './ConnectorGuideSection.tsx';
import { AppearanceSection } from './AppearanceSection.tsx';

import { PageHeader } from '../ui/PageHeader.tsx';

export function SettingsView() {
  const activeTab = activeSettingsTabSignal.value;

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
