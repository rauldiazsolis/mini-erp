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
import { PageHeader } from '../ui/PageHeader.tsx';

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
      {/* Encabezado con PageHeader */}
      <PageHeader
        title="Stock Multi-Sucursal & Kardex"
        badge="Control Auditado"
        description="Matriz consolidada por sucursales, ajustes de inventario auditados y trazabilidad inmutable de movimientos"
      />

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
