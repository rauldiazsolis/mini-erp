import { signal } from '@preact/signals';

/** La sección y la solapa están en la URL (#59): acá queda el menú móvil. */
export const mobileMenuOpenSignal = signal<boolean>(false);

export function toggleMobileMenu(): void {
  mobileMenuOpenSignal.value = !mobileMenuOpenSignal.value;
}
