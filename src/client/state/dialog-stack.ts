import { signal, computed } from '@preact/signals';

/**
 * Los diálogos abiertos (`DialogShell`, #56), del primero al último. Con un modal abierto lo de
 * afuera queda inerte, así que los toasts se dibujan adentro del diálogo de más arriba.
 */
export const openDialogsSignal = signal<readonly number[]>([]);

export const anyDialogOpenSignal = computed(() => openDialogsSignal.value.length > 0);

let lastId = 0;

export function pushDialog(): number {
  lastId += 1;
  openDialogsSignal.value = [...openDialogsSignal.value, lastId];
  return lastId;
}

export function popDialog(id: number): void {
  openDialogsSignal.value = openDialogsSignal.value.filter((d) => d !== id);
}

/** Lee siempre la señal, así quien lo llama en `render` se redibuja cuando cambia la pila. */
export function isTopDialog(id: number | null): boolean {
  const stack = openDialogsSignal.value;
  return id !== null && stack[stack.length - 1] === id;
}
