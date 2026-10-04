import { signal, computed, effect } from '@preact/signals';
import { ApiError, apiFetch, setOnPaymentRequired } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal, isImpersonatingSignal } from './auth-state.ts';
import { activeSectionSignal, routeTab } from './route-state.ts';
import type { TabId } from '../routing/admin-routes.ts';
import { showToast } from './toast-state.ts';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import type {
  BillingStatus,
  ChargesPage,
  CreditMovementItem,
  CreditsResponse,
  GiftItem,
} from '../../shared/credits-types.ts';

/**
 * Créditos del comercio (#21): saldos, consumo por caja y día, movimientos, regalados y "Cómo pagar"
 * (owner y admin), y el estado de cobro que muestran la franja y la pantalla restringida (los tres roles).
 */

export type CreditsTab = TabId<'credits'>;
const CREDITS_TABS: readonly CreditsTab[] = ['charges', 'movements', 'gifts'];

export const creditsSignal = signal<CreditsResponse | null>(null);
export const chargesSignal = signal<ChargesPage | null>(null);
export const movementsSignal = signal<CreditMovementItem[]>([]);
export const giftsSignal = signal<GiftItem[]>([]);
export const creditsTabSignal = computed<CreditsTab>(() => routeTab('credits', CREDITS_TABS, 'charges'));
export const creditsLoadingSignal = signal<boolean>(false);
const today = argentinaToday(new Date());
/** Por defecto, los últimos 30 días argentinos. */
export const chargesRangeSignal = signal<{ from: string; to: string }>({ from: shiftDay(today, -29), to: today });

export const billingStatusSignal = signal<BillingStatus | null>(null);

/** Restringido para quien usa el comercio; root y soporte impersonando siguen viendo todo. */
export const isRestrictedSignal = computed<boolean>(() => billingStatusSignal.value?.state === 'restricted' && !isImpersonatingSignal.value);

function base(): { path: string; token: string } | null {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  return tenantId && token ? { path: `tenants/${tenantId}`, token } : null;
}

function warn(err: unknown, title: string): void {
  showToast({ type: 'error', title, message: err instanceof Error ? err.message : 'Error inesperado' });
}

export async function fetchCredits(): Promise<void> {
  const ctx = base();
  if (ctx === null) return;
  try {
    creditsLoadingSignal.value = true;
    creditsSignal.value = await apiFetch<CreditsResponse>(`${ctx.path}/credits`, { token: ctx.token });
  } catch (err: unknown) {
    warn(err, 'No se pudieron cargar los créditos');
  } finally {
    creditsLoadingSignal.value = false;
  }
}

export async function fetchCharges(page = 1): Promise<void> {
  const ctx = base();
  if (ctx === null) return;
  const range = chargesRangeSignal.value;
  const query = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: '50' });
  try {
    chargesSignal.value = await apiFetch<ChargesPage>(`${ctx.path}/credits/charges?${query.toString()}`, { token: ctx.token });
  } catch (err: unknown) {
    warn(err, 'No se pudo cargar el consumo');
  }
}

export async function fetchMovements(): Promise<void> {
  const ctx = base();
  if (ctx === null) return;
  try {
    movementsSignal.value = await apiFetch<CreditMovementItem[]>(`${ctx.path}/credits/movements`, { token: ctx.token });
  } catch (err: unknown) {
    warn(err, 'No se pudieron cargar los movimientos');
  }
}

export async function fetchGifts(): Promise<void> {
  const ctx = base();
  if (ctx === null) return;
  try {
    giftsSignal.value = await apiFetch<GiftItem[]>(`${ctx.path}/credits/gifts`, { token: ctx.token });
  } catch (err: unknown) {
    warn(err, 'No se pudieron cargar los créditos regalados');
  }
}

/** Todo lo de la pantalla Créditos. */
export async function refreshCredits(): Promise<void> {
  await Promise.all([fetchCredits(), fetchCharges(), fetchMovements(), fetchGifts(), fetchBillingStatus()]);
}

export async function fetchBillingStatus(): Promise<void> {
  const ctx = base();
  if (ctx === null) return;
  try {
    billingStatusSignal.value = await apiFetch<BillingStatus>(`${ctx.path}/billing-status`, { token: ctx.token });
  } catch {
    // Sin estado no se muestra la franja: no hace falta avisar
  }
}

/** Un `402 billing-restricted` deja el comercio como restringido. */
export function markRestrictedFromError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 402) return false;
  const data = err.data;
  if (typeof data !== 'object' || data === null || !('code' in data) || data.code !== 'billing-restricted') return false;
  const debt = 'debt' in data && typeof data.debt === 'number' ? data.debt : 0;
  const deadline = 'deadline' in data && typeof data.deadline === 'string' ? data.deadline : null;
  billingStatusSignal.value = { state: 'restricted', debt, deadline };
  return true;
}

setOnPaymentRequired((data) => {
  markRestrictedFromError(new ApiError(402, 'Restringido', data));
});

/** El botón "Avisar por WhatsApp" de "Cómo pagar": el teléfono de soporte con el mensaje armado. */
export function whatsappPayUrl(p: { phone: string; tenantName: string }): string {
  const digits = p.phone.replace(/\D/g, '');
  const text = `Hola, soy de ${p.tenantName}. Ya transferí para cargar saldo en mini contax.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

const STATUS_REFRESH_MS = 5 * 60 * 1000;

if (typeof window !== 'undefined') {
  // El estado de cobro: al cambiar de comercio y cada 5 minutos
  effect(() => {
    if (effectiveTenantIdSignal.value && tokenSignal.value) {
      void fetchBillingStatus();
    } else {
      billingStatusSignal.value = null;
    }
  });
  setInterval(() => {
    void fetchBillingStatus();
  }, STATUS_REFRESH_MS);
  // La pantalla Créditos se carga al entrar
  effect(() => {
    if (activeSectionSignal.value === 'credits' && effectiveTenantIdSignal.value && tokenSignal.value) {
      void refreshCredits();
    }
  });
}
