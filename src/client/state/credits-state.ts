import { computed } from '@preact/signals';
import { ApiError, apiFetch, setOnPaymentRequired } from '../api/client.ts';
import { isImpersonatingSignal } from './auth-state.ts';
import { inSection, routeFilters, routeTab, setFilters } from './route-state.ts';
import type { CreditsFilters, TabId } from '../routing/admin-routes.ts';
import { createTenantParamQuery, createTenantQuery } from './query-keys.ts';
import { invalidateAfter } from './invalidation.ts';
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
 * Uso y pagos (#21, #55): saldos, consumo por caja y día, movimientos, regalados y "Cómo pagar"
 * (owner y admin), y el estado de cobro que muestran la franja y la pantalla restringida (los tres roles).
 */

export type CreditsTab = TabId<'credits'>;
const CREDITS_TABS: readonly CreditsTab[] = ['charges', 'movements', 'gifts'];

export const creditsTabSignal = computed<CreditsTab>(() => routeTab('credits', CREDITS_TABS, 'charges'));

const STATUS_REFRESH_MS = 5 * 60 * 1000;

/** El estado de cobro (franja y restricción): siempre que haya comercio, y cada 5 minutos. */
const billingStatusQuery = createTenantQuery<BillingStatus>({
  domain: 'billing-status',
  refetchInterval: STATUS_REFRESH_MS,
  fn: ({ tenantId, token }) => apiFetch<BillingStatus>(`tenants/${tenantId}/billing-status`, { token }),
});
export const billingStatusSignal = computed<BillingStatus | null>(() => billingStatusQuery.data.value ?? null);

/** Restringido para quien usa el comercio; root y soporte impersonando siguen viendo todo. */
export const isRestrictedSignal = computed<boolean>(() => billingStatusSignal.value?.state === 'restricted' && !isImpersonatingSignal.value);

export const creditsFiltersSignal = computed<CreditsFilters>(() => routeFilters('credits'));

/** Por defecto, los últimos 30 días argentinos. */
export const chargesRangeSignal = computed<{ from: string; to: string }>(() => {
  const { from, to } = creditsFiltersSignal.value;
  if (from !== undefined && to !== undefined) return { from, to };
  const today = argentinaToday(new Date());
  return { from: shiftDay(today, -29), to: today };
});

/** Cambiar el rango vuelve a la primera página. */
export function setChargesRange(range: { from: string; to: string }): void {
  setFilters('credits', { from: range.from, to: range.to, page: 1 });
}

export function setChargesPage(page: number): void {
  setFilters('credits', { page });
}

const onCredits = (): boolean => inSection('credits');
const warnWith = (title: string) => (err: Error): void => {
  showToast({ type: 'error', title, message: err.message });
};

const creditsQuery = createTenantParamQuery<CreditsResponse, readonly ['summary']>({
  domain: 'credits',
  params: () => ['summary'],
  enabled: onCredits,
  onError: warnWith('No se pudieron cargar los créditos'),
  fn: ({ tenantId, token }) => apiFetch<CreditsResponse>(`tenants/${tenantId}/credits`, { token }),
});

const chargesQuery = createTenantParamQuery<ChargesPage, readonly ['charges', string, string, number]>({
  domain: 'credits',
  params: () => ['charges', chargesRangeSignal.value.from, chargesRangeSignal.value.to, creditsFiltersSignal.value.page],
  enabled: () => onCredits() && creditsTabSignal.value === 'charges',
  onError: warnWith('No se pudo cargar el consumo'),
  fn: ({ tenantId, token, params: [, from, to, page] }) => {
    const query = new URLSearchParams({ from, to, page: String(page), pageSize: '50' });
    return apiFetch<ChargesPage>(`tenants/${tenantId}/credits/charges?${query.toString()}`, { token });
  },
});

const movementsQuery = createTenantParamQuery<CreditMovementItem[], readonly ['movements']>({
  domain: 'credits',
  params: () => ['movements'],
  enabled: () => onCredits() && creditsTabSignal.value === 'movements',
  onError: warnWith('No se pudieron cargar los movimientos'),
  fn: ({ tenantId, token }) => apiFetch<CreditMovementItem[]>(`tenants/${tenantId}/credits/movements`, { token }),
});

const giftsQuery = createTenantParamQuery<GiftItem[], readonly ['gifts']>({
  domain: 'credits',
  params: () => ['gifts'],
  enabled: () => onCredits() && creditsTabSignal.value === 'gifts',
  onError: warnWith('No se pudieron cargar los créditos regalados'),
  fn: ({ tenantId, token }) => apiFetch<GiftItem[]>(`tenants/${tenantId}/credits/gifts`, { token }),
});

export const creditsSignal = computed<CreditsResponse | null>(() => creditsQuery.data.value ?? null);
export const chargesSignal = computed<ChargesPage | null>(() => chargesQuery.data.value ?? null);
export const movementsSignal = computed<CreditMovementItem[]>(() => movementsQuery.data.value ?? []);
export const giftsSignal = computed<GiftItem[]>(() => giftsQuery.data.value ?? []);
export const creditsLoadingSignal = creditsQuery.isLoading;

/** Todo lo de Uso y pagos y el estado de cobro (después de una acción de plataforma). */
export async function refreshCredits(): Promise<void> {
  await invalidateAfter('platform-changed');
}

export async function fetchBillingStatus(): Promise<void> {
  await billingStatusQuery.refetch();
}

/** Un `402 billing-restricted` deja el comercio como restringido. */
export function markRestrictedFromError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 402) return false;
  const data = err.data;
  if (typeof data !== 'object' || data === null || !('code' in data) || data.code !== 'billing-restricted') return false;
  const debt = 'debt' in data && typeof data.debt === 'number' ? data.debt : 0;
  const deadline = 'deadline' in data && typeof data.deadline === 'string' ? data.deadline : null;
  billingStatusQuery.setData(() => ({ state: 'restricted', debt, deadline }));
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
