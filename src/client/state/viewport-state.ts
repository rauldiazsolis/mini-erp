import { signal, type ReadonlySignal } from '@preact/signals';

/** Debajo de `md` de Tailwind (768 px): tarjetas en vez de tablas y filtros plegados (#89, #90). */
export const PHONE_QUERY = '(max-width: 767px)';

type MediaQueryLike = { matches: boolean; addEventListener: (type: 'change', listener: (e: { matches: boolean }) => void) => void };

/**
 * Si la pantalla es de teléfono, como signal: así se dibuja una sola de las dos vistas (tarjetas o
 * tabla), no las dos con una escondida por CSS.
 */
export function createPhoneSignal(query: () => MediaQueryLike | null): ReadonlySignal<boolean> {
  const mql = query();
  const phone = signal(mql?.matches ?? false);
  mql?.addEventListener('change', (e) => {
    phone.value = e.matches;
  });
  return phone;
}

export const isPhoneSignal = createPhoneSignal(() =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null,
);
