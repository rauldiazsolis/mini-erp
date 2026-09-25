import {
  fetchStockData,
  stockItemsSignal,
  stockLoadingSignal,
} from '../../state/stock-state.ts';
import { effectiveTenantIdSignal } from '../../state/auth-state.ts';
import { StockToolbar } from './StockToolbar.tsx';
import { StockMatrixTable } from './StockMatrixTable.tsx';
import { StockAdjustModal } from './StockAdjustModal.tsx';
import { KardexDrawer } from './KardexDrawer.tsx';

let lastFetchedTenantId: string | null = null;

export function StockView() {
  const currentTenantId = effectiveTenantIdSignal.value;

  if (currentTenantId && currentTenantId !== lastFetchedTenantId) {
    lastFetchedTenantId = currentTenantId;
    fetchStockData();
  } else if (currentTenantId && stockItemsSignal.value.length === 0 && !stockLoadingSignal.value) {
    fetchStockData();
  }

  return (
    <div class="space-y-6 animate-in fade-in duration-150">
      {/* Encabezado de la Sección */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <span>Stock Multi-Sucursal & Kardex</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold uppercase tracking-wider">
              Control Auditado
            </span>
          </h1>
          <p class="text-xs text-slate-400 mt-1">
            Matriz consolidada por sucursales, ajustes de inventario auditados y trazabilidad inmutable de movimientos
          </p>
        </div>
      </div>

      {/* Barra de Filtros y Búsqueda */}
      <StockToolbar />

      {/* Matriz de Stock Multi-Sucursal */}
      <StockMatrixTable />

      {/* Modales de Ajuste y Auditoría Kardex */}
      <StockAdjustModal />
      <KardexDrawer />
    </div>
  );
}
