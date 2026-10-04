import { signal } from '@preact/signals';

export type ActiveNavView = 'dashboard' | 'sales' | 'catalog' | 'stock' | 'customers' | 'bulk' | 'users' | 'settings' | 'credits' | 'platform';

export const activeViewSignal = signal<ActiveNavView>('dashboard');
export const mobileMenuOpenSignal = signal<boolean>(false);
export const impersonationModalOpenSignal = signal<boolean>(false);

export function navigateTo(view: ActiveNavView): void {
  activeViewSignal.value = view;
  mobileMenuOpenSignal.value = false;
}

export function toggleMobileMenu(): void {
  mobileMenuOpenSignal.value = !mobileMenuOpenSignal.value;
}

export function openImpersonationModal(): void {
  impersonationModalOpenSignal.value = true;
}

export function closeImpersonationModal(): void {
  impersonationModalOpenSignal.value = false;
}
