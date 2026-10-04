import { signal } from '@preact/signals';

/** La sección y la solapa están en la URL (#59): acá quedan el menú móvil y el modal de impersonación. */
export const mobileMenuOpenSignal = signal<boolean>(false);
export const impersonationModalOpenSignal = signal<boolean>(false);

export function toggleMobileMenu(): void {
  mobileMenuOpenSignal.value = !mobileMenuOpenSignal.value;
}

export function openImpersonationModal(): void {
  impersonationModalOpenSignal.value = true;
}

export function closeImpersonationModal(): void {
  impersonationModalOpenSignal.value = false;
}
