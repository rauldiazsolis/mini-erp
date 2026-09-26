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
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <span>Configuración & Terminales POS</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-bold uppercase tracking-wider">
              Conectividad & Preferencias
            </span>
          </h1>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Gestión de API Keys para cajas registradoras, administración de sucursales físicas y personalización de interfaz
          </p>
        </div>
      </div>

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
