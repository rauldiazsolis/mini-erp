import { activeBulkTabSignal } from '../../state/bulk-state.ts';
import { BulkTabs } from './BulkTabs.tsx';
import { BulkPricesCard } from './BulkPricesCard.tsx';
import { BulkInterestsCard } from './BulkInterestsCard.tsx';
import { ImportExportCard } from './ImportExportCard.tsx';

import { PageHeader } from '../ui/PageHeader.tsx';

export function BulkView() {
  const activeTab = activeBulkTabSignal.value;

  return (
    <div class="space-y-6 animate-in fade-in duration-150">
      {/* Encabezado */}
      <PageHeader
        title="Operaciones Masivas"
        badge="Automatización ERP"
        subtitle="Aumentos porcentuales de precios con redondeo, devengamiento de intereses en cuentas y migración de datos CSV/JSON"
      />

      {/* Selector de Pestañas */}
      <BulkTabs />

      {/* Vista según la Pestaña Activa */}
      {activeTab === 'prices' && <BulkPricesCard />}
      {activeTab === 'interests' && <BulkInterestsCard />}
      {activeTab === 'io' && <ImportExportCard />}
    </div>
  );
}
