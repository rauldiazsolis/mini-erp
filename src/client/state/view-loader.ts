import { effect } from '@preact/signals';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { activeSectionSignal } from './route-state.ts';
import type { NavSection } from '../routing/admin-routes.ts';

/**
 * Carga los datos de una pantalla al cambiar de comercio y cada vez que se entra a ella (#22: después
 * de importar, Catálogo, Clientes y Stock se ven al día). Arreglo mínimo: la navegación con router y
 * TanStack Query queda para su propia etapa. Devuelve la función que corta el efecto.
 */
export function loadOnTenantAndView(view: NavSection, load: () => unknown): () => void {
  let lastTenant: string | null = null;
  return effect(() => {
    const tenant = effectiveTenantIdSignal.value;
    const onView = activeSectionSignal.value === view;
    if (tenant === null || !tokenSignal.value) return;
    if (tenant !== lastTenant || onView) {
      lastTenant = tenant;
      void load();
    }
  });
}
