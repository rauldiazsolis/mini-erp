import { CatalogToolbar } from './CatalogToolbar.tsx';
import { CatalogGrid } from './CatalogGrid.tsx';
import { ProductModal } from './ProductModal.tsx';
import { BlockProductModal } from './BlockProductModal.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';

export function CatalogView() {
  return (
    <div class="space-y-6 animate-in fade-in duration-150">
      {/* Encabezado de la Sección con PageHeader */}
      <PageHeader
        title="Catálogo & Precios"
        badge="Grilla Interactiva"
        description="Gestión centralizada de artículos, códigos de barra, precios en tiempo real y alícuotas con sincronización directa al POS"
      />

      {/* Barra de Filtros y Herramientas */}
      <CatalogToolbar />

      {/* Grilla Tipo Excel/Sheets */}
      <CatalogGrid />

      {/* Modales de Formulario y Bloqueo */}
      <ProductModal />
      <BlockProductModal />
    </div>
  );
}
