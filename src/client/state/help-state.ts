import { computed, effect, signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { createSignalQuery, type QuerySource } from '../api/query-client.ts';
import { activeTenantSignal, currentUserSignal, isImpersonatingSignal, tokenSignal } from './auth-state.ts';
import { locationSignal } from './route-state.ts';
import { meKey } from './query-keys.ts';
import { showToast } from './toast-state.ts';
import { formatDate, formatTime } from '../format.ts';
import type { HelpRequestCreated, SupportAccess, SupportAccessItem } from '../../shared/help-types.ts';

/**
 * "Pedir ayuda" (#23): el usuario manda a soporte por WhatsApp un link a su pedido y ve los accesos
 * de soporte a su cuenta. Se consulta al entrar, al volver a la pestaña y cada 60 s con el modal abierto.
 */
export const helpModalOpenSignal = signal<boolean>(false);
export const helpMessageSignal = signal<string>('');
export const helpSendingSignal = signal<boolean>(false);

/** Un usuario de comercio con su sesión propia: los únicos que piden ayuda y ven los accesos. */
const isOwnUser = (): boolean => currentUserSignal.value?.globalRole === 'user' && !isImpersonatingSignal.value;

const supportAccessQuery = createSignalQuery<SupportAccess>({
  source: (): QuerySource<SupportAccess> | null => {
    const token = tokenSignal.value;
    if (token === null || !isOwnUser()) return null;
    return { key: meKey('support-access'), fn: () => apiFetch<SupportAccess>('me/support-access', { token }) };
  },
});

export const supportAccessSignal = computed<SupportAccess | null>(() => supportAccessQuery.data.value ?? null);

/** El botón aparece con un comercio activo, sin impersonar y con un WhatsApp de soporte configurado. */
export const canAskHelpSignal = computed<boolean>(
  () => isOwnUser() && activeTenantSignal.value !== null && (supportAccessSignal.value?.supportWhatsapp ?? '') !== '',
);

/** "Soporte está viendo tu cuenta": hay una impersonación viva sobre la cuenta. */
export const supportInsideSignal = computed<boolean>(() => isOwnUser() && supportAccessSignal.value?.activeNow === true);

export function helpWhatsappUrl(p: { phone: string; userName: string; tenantName: string; message: string; link: string }): string {
  const message = p.message.trim();
  const text = `Hola, soy ${p.userName} de ${p.tenantName}. ${message === '' ? '' : `${message} `}${p.link}`;
  return `https://wa.me/${p.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** "Soporte (Ana) entró a las 10:32 por tu pedido"; si no fue hoy, con la fecha. */
export function accessText(item: SupportAccessItem, now: Date): string {
  const today = formatDate(item.at) === formatDate(now.toISOString());
  const when = today ? `a las ${formatTime(item.at)}` : `el ${formatDate(item.at)} a las ${formatTime(item.at)}`;
  return `Soporte (${item.staffName}) entró ${when}${item.byRequest ? ' por tu pedido' : ''}`;
}

/** Crea el pedido con la pantalla actual y abre WhatsApp con el link para soporte. */
export async function sendHelpRequest(): Promise<boolean> {
  const token = tokenSignal.peek();
  const tenant = activeTenantSignal.peek();
  const user = currentUserSignal.peek();
  const phone = supportAccessSignal.peek()?.supportWhatsapp ?? '';
  if (token === null || tenant === null || user === null || phone === '') return false;
  helpSendingSignal.value = true;
  try {
    const { pathname, search } = locationSignal.peek();
    const message = helpMessageSignal.peek();
    const created = await apiFetch<HelpRequestCreated>(`tenants/${encodeURIComponent(tenant.tenantId)}/help-requests`, {
      method: 'POST',
      token,
      body: { path: `${pathname}${search}`, message },
    });
    window.open(helpWhatsappUrl({ phone, userName: user.name, tenantName: tenant.name, message, link: created.url }), '_blank', 'noopener');
    helpMessageSignal.value = '';
    await supportAccessQuery.refetch();
    return true;
  } catch (err: unknown) {
    showToast({ type: 'error', title: 'No se pudo pedir ayuda', message: err instanceof Error ? err.message : 'Error inesperado' });
    return false;
  } finally {
    helpSendingSignal.value = false;
  }
}

/** Con el modal abierto, los accesos se refrescan cada 60 s. */
export function registerHelpEffects(): () => void {
  return effect(() => {
    if (!helpModalOpenSignal.value) return;
    const id = setInterval(() => void supportAccessQuery.refetch(), 60_000);
    return () => {
      clearInterval(id);
    };
  });
}

if (typeof window !== 'undefined') {
  registerHelpEffects();
}
