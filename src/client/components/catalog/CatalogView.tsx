import {
  fetchCatalog,
  productsSignal,
  catalogLoadingSignal,
} from '../../state/catalog-state.ts';
import { effectiveTenantIdSignal } from '../../state/auth-state.ts';
import { CatalogToolbar } from './CatalogToolbar.tsx';
import { CatalogGrid } from './CatalogGrid.tsx';
import { ProductModal } from './ProductModal.tsx';
import { BlockProductModal } from './BlockProductModal.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';

let lastFetchedTenantId: string | null = null;

export function CatalogView() {
  const currentTenantId = effectiveTenantIdSignal.value;

  // Carga inicial o reactiva cuando cambia el tenant seleccionado
  if (currentTenantId && currentTenantId !== lastFetchedTenantId) {
    lastFetchedTenantId = currentTenantId;
    fetchCatalog();
  } else if (currentTenantId && productsSignal.value.length === 0 && !catalogLoadingSignal.value) {
    // Si la lista está vacía y no está cargando, asegurar el fetch inicial
    fetchCatalog();
  }

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
