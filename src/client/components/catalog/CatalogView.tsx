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
      {/* Encabezado de la Sección */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <span>Catálogo & Precios</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold uppercase tracking-wider">
              Grilla Interactiva
            </span>
          </h1>
          <p class="text-xs text-slate-400 mt-1">
            Gestión centralizada de artículos, códigos de barra, precios en tiempo real y alícuotas con sincronización directa al POS
          </p>
        </div>
      </div>

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
