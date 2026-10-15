import type { ComponentChildren } from 'preact';
import { signal } from '@preact/signals';
import { Button } from './Button.tsx';
import { Drawer } from './Drawer.tsx';
import { isPhoneSignal } from '../../state/viewport-state.ts';

/** El panel de filtros abierto en el teléfono (uno a la vez), por su id. */
const openFiltersSignal = signal<string | null>(null);

export function closeFoldedFilters(): void {
  openFiltersSignal.value = null;
}

export type FoldedFiltersProps = {
  /** Distingue los paneles de cada pantalla. */
  id: string;
  /** Cuántos filtros hay puestos: van en el botón ("Filtros (2)"). */
  active: number;
  /** Lo que queda a la vista en el teléfono, al lado del botón (rangos rápidos, por ejemplo). */
  quick?: ComponentChildren;
  /** Los filtros: en escritorio, en su lugar; en el teléfono, en un panel que se abre con el botón. */
  children: ComponentChildren;
};

/**
 * Filtros plegables (#90): en el teléfono ocupan una sola fila ("Filtros (n)") y se abren en un
 * panel; en escritorio se ven como siempre. Cada filtro se aplica al cambiarlo, como en escritorio.
 */
export function FoldedFilters(props: FoldedFiltersProps) {
  const isOpen = openFiltersSignal.value === props.id;
  // En escritorio, los filtros en su lugar y nada más: no se dibujan dos veces
  if (!isPhoneSignal.value) return <>{props.children}</>;
  return (
    <>
      <div class="md:hidden flex flex-wrap items-center gap-2">
        {props.quick}
        <Button
          size="sm"
          variant={props.active > 0 ? 'primary' : 'secondary'}
          aria-haspopup="dialog"
          onClick={() => { openFiltersSignal.value = props.id; }}
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
          </svg>
          {props.active > 0 ? `Filtros (${String(props.active)})` : 'Filtros'}
        </Button>
      </div>
      <Drawer isOpen={isOpen} onClose={closeFoldedFilters} title="Filtros" maxWidth="max-w-md">
        <div class="space-y-4">
          {props.children}
          <Button class="w-full" onClick={closeFoldedFilters}>
            Ver resultados
          </Button>
        </div>
      </Drawer>
    </>
  );
}
