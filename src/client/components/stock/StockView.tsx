import { StockToolbar } from './StockToolbar.tsx';
import { StockMatrixTable } from './StockMatrixTable.tsx';
import { StockAdjustModal } from './StockAdjustModal.tsx';
import { KardexDrawer } from './KardexDrawer.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';

export function StockView() {
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
