import type { ComponentChildren } from 'preact';

/**
 * Listas en el teléfono (#89): por debajo de `md`, cada fila es una tarjeta de dos renglones con lo
 * importante a la vista (el monto a la derecha), en vez de una tabla que esconde columnas al costado.
 * La tabla de siempre va en `DesktopOnly`.
 */
export function CardList(props: { children: ComponentChildren; label?: string | undefined }) {
  return (
    <ul class="md:hidden divide-y divide-slate-200 dark:divide-slate-800" aria-label={props.label}>
      {props.children}
    </ul>
  );
}

export function DesktopOnly(props: { children: ComponentChildren }) {
  return <div class="hidden md:block">{props.children}</div>;
}

export type CardRowProps = {
  /** Lo principal, arriba a la izquierda (el nombre, el número). */
  title: ComponentChildren;
  /** Arriba a la derecha, destacado (el monto, el stock). */
  aside?: ComponentChildren;
  /** El renglón de abajo, en gris (fecha, caja, detalle). */
  meta?: ComponentChildren;
  /** Acciones propias de la fila (íconos); no abren la fila. */
  actions?: ComponentChildren;
  /** Tocar la tarjeta abre su detalle. */
  onOpen?: (() => void) | undefined;
  class?: string | undefined;
};

export function CardRow(props: CardRowProps) {
  const body = (
    <>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 text-sm font-semibold text-slate-900 dark:text-white">{props.title}</div>
        {props.aside !== undefined && <div class="shrink-0 text-right text-sm font-bold">{props.aside}</div>}
      </div>
      {props.meta !== undefined && <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">{props.meta}</div>}
    </>
  );
  return (
    <li class={`flex items-center gap-2 px-4 py-3${props.class === undefined ? '' : ` ${props.class}`}`}>
      {props.onOpen === undefined ? (
        <div class="flex-1 min-w-0">{body}</div>
      ) : (
        <button
          type="button"
          class="flex-1 min-w-0 text-left rounded-lg -mx-1 px-1 py-0.5 active:bg-slate-100 dark:active:bg-slate-800"
          onClick={props.onOpen}
        >
          {body}
        </button>
      )}
      {props.actions !== undefined && <div class="shrink-0 flex items-center gap-1">{props.actions}</div>}
    </li>
  );
}
