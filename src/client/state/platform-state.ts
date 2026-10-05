import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { createSignalQuery, type QuerySource } from '../api/query-client.ts';
import { tokenSignal } from './auth-state.ts';
import { inSection, routeSignal } from './route-state.ts';
import { platformKey } from './query-keys.ts';
import { invalidateAfter } from './invalidation.ts';
import type { PlatformSectionId } from '../routing/admin-routes.ts';
import { showToast } from './toast-state.ts';
import type { BillingSettings, PlatformPaymentItem, SheetResultRow } from '../../shared/credits-types.ts';

/**
 * Plataforma de cobro (#21), para root y soporte: las acciones sobre un comercio (desde su detalle en
 * `/plataforma/comercios/<slug>`, #23) y lo global (planilla de cobranzas, pagos y configuración).
 */

export type PlatformSection = PlatformSectionId;

/** La sección de `/plataforma` (#59), la del ítem activo del menú (#81); el detalle de un comercio es Comercios. */
export const platformSectionSignal = computed<PlatformSection>(() => {
  const route = routeSignal.value;
  return route.kind === 'plataforma' ? route.section : 'tenants';
});
export const sheetTextSignal = signal<string>('');
export const sheetRowsSignal = signal<SheetResultRow[] | null>(null);
export const sheetAppliedSignal = signal<boolean>(false);
export const sheetBusySignal = signal<boolean>(false);

function token(): string | null {
  return tokenSignal.value;
}

function fail(err: unknown, title: string): false {
  showToast({ type: 'error', title, message: err instanceof Error ? err.message : 'Error inesperado' });
  return false;
}

/** Lo global de la plataforma, en `/plataforma` (#59): no es de un comercio. */
const platformSource = <T>(name: 'payments' | 'settings', path: string) => (): QuerySource<T> | null => {
  const t = tokenSignal.value;
  return t ? { key: platformKey(name), fn: () => apiFetch<T>(path, { token: t }) } : null;
};

const paymentsQuery = createSignalQuery<PlatformPaymentItem[]>({
  source: platformSource('payments', '/api/platform/payments'),
  enabled: () => inSection('platform'),
  onError: (err) => {
    fail(err, 'No se pudieron cargar los pagos');
  },
});

const settingsQuery = createSignalQuery<BillingSettings>({
  source: platformSource('settings', '/api/platform/settings'),
  enabled: () => inSection('platform'),
  onError: (err) => {
    fail(err, 'No se pudo cargar la configuración');
  },
});

export const platformPaymentsSignal = computed<PlatformPaymentItem[]>(() => paymentsQuery.data.value ?? []);
export const platformSettingsSignal = computed<BillingSettings | null>(() => settingsQuery.data.value ?? null);

/** Una acción sobre un comercio: avisa, deja viejos el panel y Uso y pagos y devuelve si salió bien. */
async function tenantAction(
  tenantId: string,
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: Record<string, unknown>,
  done: string,
): Promise<boolean> {
  const t = token();
  if (t === null) return false;
  try {
    await apiFetch(`/api/platform/tenants/${encodeURIComponent(tenantId)}${path}`, { method, token: t, body });
    showToast({ type: 'success', title: 'Listo', message: done });
    await invalidateAfter('platform-changed');
    return true;
  } catch (err: unknown) {
    return fail(err, 'No se pudo completar');
  }
}

/** Saca las claves sin valor: los opcionales vacíos no viajan. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== ''));
}

export function registerPayment(tenantId: string, input: { day: string; amount: number; info?: string | undefined }): Promise<boolean> {
  return tenantAction(tenantId, '/payments', 'POST', compact(input), 'Pago registrado');
}

export function grantCredits(tenantId: string, input: { amount: number; expiresOn: string; reason?: string | undefined }): Promise<boolean> {
  return tenantAction(tenantId, '/gift-credits', 'POST', compact(input), 'Bono otorgado');
}

export function voidCredit(tenantId: string, creditId: string, reason: string): Promise<boolean> {
  return tenantAction(tenantId, `/gift-credits/${creditId}`, 'DELETE', { reason }, 'Bono anulado');
}

export function extendGrace(tenantId: string, until: string): Promise<boolean> {
  return tenantAction(tenantId, '/grace', 'POST', { until }, 'Gracia extendida');
}

export function registerRefund(tenantId: string, input: { amount: number; info?: string | undefined }): Promise<boolean> {
  return tenantAction(tenantId, '/refunds', 'POST', compact(input), 'Devolución registrada');
}

export function changeHolder(tenantId: string, userId: string): Promise<boolean> {
  return tenantAction(tenantId, '/holder', 'PUT', { userId }, 'Titular cambiado');
}

async function sendSheet(dryRun: boolean): Promise<void> {
  const t = token();
  if (t === null) return;
  try {
    sheetBusySignal.value = true;
    const res = await apiFetch<{ rows: SheetResultRow[]; applied: boolean }>(`/api/platform/payments/import${dryRun ? '?dryRun=1' : ''}`, {
      method: 'POST',
      token: t,
      body: { csv: sheetTextSignal.value },
    });
    sheetRowsSignal.value = res.rows;
    sheetAppliedSignal.value = res.applied;
    if (res.applied) {
      const ok = res.rows.filter((r) => r.status === 'ok').length;
      showToast({ type: 'success', title: 'Planilla aplicada', message: `${String(ok)} pagos registrados` });
      await invalidateAfter('platform-changed');
    }
  } catch (err: unknown) {
    fail(err, 'No se pudo procesar la planilla');
  } finally {
    sheetBusySignal.value = false;
  }
}

export function previewSheet(): Promise<void> {
  return sendSheet(true);
}

export function applySheet(): Promise<void> {
  return sendSheet(false);
}

export async function loadSheetFile(file: File): Promise<void> {
  sheetTextSignal.value = await file.text();
  sheetRowsSignal.value = null;
  sheetAppliedSignal.value = false;
}

/** "3 para registrar, 1 ya registrado, 1 con error" (o "registrados", una vez aplicada). */
export function sheetSummary(rows: SheetResultRow[], applied: boolean): string {
  const ok = rows.filter((r) => r.status === 'ok').length;
  const dup = rows.filter((r) => r.status === 'duplicate').length;
  const err = rows.filter((r) => r.status === 'error').length;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  return [
    `${String(ok)} ${applied ? plural(ok, 'registrado', 'registrados') : 'para registrar'}`,
    ...(dup > 0 ? [`${String(dup)} ya ${plural(dup, 'registrado', 'registrados')}`] : []),
    ...(err > 0 ? [`${String(err)} con error`] : []),
  ].join(', ');
}

/** El formulario de configuración, todo en texto; el porcentaje pagado va de 0 a 100. */
export type SettingsDraft = Record<keyof BillingSettings, string>;

const NUMBER_FIELDS: Array<{ key: 'pricePerRegisterDay' | 'signupBonus' | 'signupBonusDays' | 'paidShare' | 'graceDays' | 'lowBalanceDays'; label: string }> = [
  { key: 'pricePerRegisterDay', label: 'Precio por caja y día' },
  { key: 'signupBonus', label: 'Bono de alta' },
  { key: 'signupBonusDays', label: 'Días del bono' },
  { key: 'paidShare', label: 'Porcentaje pagado' },
  { key: 'graceDays', label: 'Días de gracia' },
  { key: 'lowBalanceDays', label: 'Días del aviso' },
];

export function settingsToDraft(s: BillingSettings): SettingsDraft {
  return {
    pricePerRegisterDay: String(s.pricePerRegisterDay),
    signupBonus: String(s.signupBonus),
    signupBonusDays: String(s.signupBonusDays),
    paidShare: String(Math.round(s.paidShare * 100)),
    graceDays: String(s.graceDays),
    lowBalanceDays: String(s.lowBalanceDays),
    paymentAlias: s.paymentAlias,
    paymentCbu: s.paymentCbu,
    paymentHolder: s.paymentHolder,
    supportWhatsapp: s.supportWhatsapp,
  };
}

/** La configuración del formulario, o el error del primer número que no lo es (el resto lo valida el servidor). */
export function draftToSettings(d: SettingsDraft): BillingSettings | string {
  const n: Partial<Record<(typeof NUMBER_FIELDS)[number]['key'], number>> = {};
  for (const f of NUMBER_FIELDS) {
    const text = d[f.key].trim();
    const value = Number(text);
    if (text === '' || !Number.isFinite(value)) return `${f.label} tiene que ser un número`;
    n[f.key] = value;
  }
  return {
    pricePerRegisterDay: n.pricePerRegisterDay ?? 0,
    signupBonus: n.signupBonus ?? 0,
    signupBonusDays: n.signupBonusDays ?? 0,
    paidShare: (n.paidShare ?? 0) / 100,
    graceDays: n.graceDays ?? 0,
    lowBalanceDays: n.lowBalanceDays ?? 0,
    paymentAlias: d.paymentAlias.trim(),
    paymentCbu: d.paymentCbu.trim(),
    paymentHolder: d.paymentHolder.trim(),
    supportWhatsapp: d.supportWhatsapp.trim(),
  };
}

export async function fetchPlatformPayments(): Promise<void> {
  await paymentsQuery.refetch();
}

export async function fetchPlatformSettings(): Promise<void> {
  await settingsQuery.refetch();
}

export async function savePlatformSettings(patch: Partial<BillingSettings>): Promise<boolean> {
  const t = token();
  if (t === null) return false;
  try {
    const saved = await apiFetch<BillingSettings>('/api/platform/settings', { method: 'PUT', token: t, body: patch });
    settingsQuery.setData(() => saved);
    void invalidateAfter('platform-changed');
    showToast({ type: 'success', title: 'Configuración guardada', message: 'Los cambios valen para los cargos nuevos' });
    return true;
  } catch (err: unknown) {
    return fail(err, 'No se pudo guardar');
  }
}
