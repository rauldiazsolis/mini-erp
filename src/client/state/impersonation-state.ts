import { effect, signal } from '@preact/signals';
import { ApiError, apiFetch } from '../api/client.ts';
import {
  adoptImpersonation,
  currentUserSignal,
  isImpersonatingSignal,
  ownToken,
  resumeOwnSession,
  tokenSignal,
  type ImpersonationStart,
} from './auth-state.ts';
import { routeSignal } from './route-state.ts';
import { enterUrl, helpRequestUrl, type EnterRoute, type HelpRoute } from '../routing/admin-routes.ts';

/**
 * Impersonación de usuario por pestaña (#23): "Entrar como" y los links de pedidos de ayuda abren una
 * pestaña nueva con `noopener` (no hereda el almacenamiento de la que la abrió), que pide la
 * impersonación con la sesión propia de soporte y la adopta (`adoptImpersonation`, en `auth-state`).
 */
export type EnterStatus =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'not-staff' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

export const enterStatusSignal = signal<EnterStatus>({ kind: 'idle' });

export async function enterFromRoute(route: EnterRoute | HelpRoute): Promise<void> {
  const token = ownToken();
  const role = currentUserSignal.peek()?.globalRole;
  if (token === null) return;
  if (role !== 'root' && role !== 'support') {
    enterStatusSignal.value = { kind: 'not-staff' };
    return;
  }
  if (route.kind === 'entrar' && route.userId === null) {
    enterStatusSignal.value = { kind: 'error', message: 'Falta el usuario' };
    return;
  }
  enterStatusSignal.value = { kind: 'working' };
  const body =
    route.kind === 'ayuda'
      ? { helpRequestId: route.requestId }
      : { userId: route.userId, ...(route.tenantSlug === null ? {} : { tenantSlug: route.tenantSlug }) };
  try {
    const start = await apiFetch<ImpersonationStart>('impersonations', { method: 'POST', token, body });
    enterStatusSignal.value = { kind: 'idle' };
    await adoptImpersonation(start);
  } catch (err: unknown) {
    enterStatusSignal.value =
      err instanceof ApiError && err.status === 410
        ? { kind: 'expired' }
        : { kind: 'error', message: err instanceof Error ? err.message : 'No se pudo entrar' };
  }
}

/** En `/plataforma/entrar` y `/ayuda/<id>`, con la sesión de soporte cargada, pide la impersonación una vez. */
export function registerEnterEffects(): () => void {
  return effect(() => {
    const route = routeSignal.value;
    if ((route.kind !== 'entrar' && route.kind !== 'ayuda') || currentUserSignal.value === null || isImpersonatingSignal.value) return;
    if (enterStatusSignal.peek().kind !== 'idle') return;
    void enterFromRoute(route);
  });
}

/** "Salir": termina la impersonación y cierra la pestaña; si el navegador no la cierra, vuelve a /plataforma. */
export async function exitImpersonation(): Promise<void> {
  const token = tokenSignal.peek();
  if (token !== null) await apiFetch('impersonations/current', { method: 'DELETE', token }).catch(() => undefined);
  if (typeof window !== 'undefined') window.close();
  await resumeOwnSession();
}

function openTab(url: string): void {
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
}

export function openEnterTab(userId: string, tenantSlug?: string): void {
  openTab(enterUrl(userId, tenantSlug));
}

export function openHelpRequestTab(id: string): void {
  openTab(helpRequestUrl(id));
}

if (typeof window !== 'undefined') {
  registerEnterEffects();
}
