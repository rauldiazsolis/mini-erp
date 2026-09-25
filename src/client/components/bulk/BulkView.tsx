import { activeBulkTabSignal } from '../../state/bulk-state.ts';
import { BulkTabs } from './BulkTabs.tsx';
import { BulkPricesCard } from './BulkPricesCard.tsx';
import { BulkInterestsCard } from './BulkInterestsCard.tsx';
import { ImportExportCard } from './ImportExportCard.tsx';

export function BulkView() {
  const activeTab = activeBulkTabSignal.value;

  return (
    <div class="space-y-6 animate-in fade-in duration-150">
      {/* Encabezado */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <span>Operaciones Masivas</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold uppercase tracking-wider">
              Automatización ERP
            </span>
          </h1>
          <p class="text-xs text-slate-400 mt-1">
            Aumentos porcentuales de precios con redondeo, devengamiento de intereses en cuentas y migración de datos CSV/JSON
          </p>
        </div>
      </div>

      {/* Selector de Pestañas */}
      <BulkTabs />

      {/* Vista según la Pestaña Activa */}
      {activeTab === 'prices' && <BulkPricesCard />}
      {activeTab === 'interests' && <BulkInterestsCard />}
      {activeTab === 'io' && <ImportExportCard />}
    </div>
  );
}
