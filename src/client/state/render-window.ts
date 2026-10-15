import { computed, signal, type ReadonlySignal } from '@preact/signals';

export const RENDER_STEP = 100;

export type RenderWindow<T> = {
  /** Las filas que se dibujan. */
  visible: ReadonlySignal<T[]>;
  hasMore: ReadonlySignal<boolean>;
  /** Suma un tramo más. */
  showMore: () => void;
};

/**
 * Las listas limitadas (productos, clientes, stock; #87) se bajan enteras, así buscar y filtrar es
 * instantáneo, pero se dibujan de a tramos: con miles de artículos el teléfono no dibuja miles de
 * filas. Cambiar los filtros vuelve al primer tramo, sin `effect`: el límite guarda los filtros con
 * los que se amplió.
 */
export function createRenderWindow<T>(items: ReadonlySignal<T[]>, filters: ReadonlySignal<unknown>, step = RENDER_STEP): RenderWindow<T> {
  const grown = signal<{ filters: unknown; limit: number }>({ filters: filters.peek(), limit: step });
  const limit = computed(() => (grown.value.filters === filters.value ? grown.value.limit : step));
  return {
    visible: computed(() => items.value.slice(0, limit.value)),
    hasMore: computed(() => items.value.length > limit.value),
    showMore: () => {
      grown.value = { filters: filters.peek(), limit: limit.peek() + step };
    },
  };
}
