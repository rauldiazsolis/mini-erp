import { signal } from '@preact/signals';

/**
 * Un solo SPA (#9): landing en `/`, admin en `/admin`, alta en `/alta`, y los links de invitación y
 * restablecimiento en `/invitacion` y `/restablecer` (#19).
 */
export type AppRoute = 'landing' | 'admin' | 'alta' | 'invitacion' | 'restablecer';

function normalize(pathname: string): string {
  const clean = pathname.toLowerCase().replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

export function routeFromPath(pathname: string): AppRoute {
  const path = normalize(pathname);
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/alta' || path === '/onboarding') return 'alta';
  if (path === '/invitacion') return 'invitacion';
  if (path === '/restablecer') return 'restablecer';
  return 'landing';
}

/** La ruta vieja del alta (`/onboarding`) se reescribe a `/alta`. */
export function canonicalPath(pathname: string): string | undefined {
  return normalize(pathname) === '/onboarding' ? '/alta' : undefined;
}

export const routeSignal = signal<AppRoute>(
  typeof window === 'undefined' ? 'landing' : routeFromPath(window.location.pathname),
);

export function navigate(path: string): void {
  if (typeof window !== 'undefined') {
    window.history.pushState(null, '', path);
  }
  routeSignal.value = routeFromPath(new URL(path, 'http://localhost').pathname);
}

export function initRouting(): void {
  const canonical = canonicalPath(window.location.pathname);
  if (canonical !== undefined) {
    window.history.replaceState(null, '', `${canonical}${window.location.search}${window.location.hash}`);
  }
  routeSignal.value = routeFromPath(window.location.pathname);
  window.addEventListener('popstate', () => {
    routeSignal.value = routeFromPath(window.location.pathname);
  });
}
