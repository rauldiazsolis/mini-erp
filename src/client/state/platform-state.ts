import { signal, effect } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { activeSectionSignal } from './route-state.ts';
import { showToast } from './toast-state.ts';
import { refreshCredits } from './credits-state.ts';
import type { MemberItem } from './users-state.ts';
import type { BillingSettings, PlatformPaymentItem, SheetResultRow } from '../../shared/credits-types.ts';

/**
 * Plataforma de cobro (#21), para root y soporte: las acciones sobre el comercio que se impersona
 * (en su pantalla Créditos) y lo global (planilla de cobranzas, pagos y configuración).
 */

export type PlatformTab = 'payments' | 'settings';

export const platformTabSignal = signal<PlatformTab>('payments');
export const ownersSignal = signal<MemberItem[]>([]);
export const sheetTextSignal = signal<string>('');
export const sheetRowsSignal = signal<SheetResultRow[] | null>(null);
export const sheetAppliedSignal = signal<boolean>(false);
export const sheetBusySignal = signal<boolean>(false);
export const platformPaymentsSignal = signal<PlatformPaymentItem[]>([]);
export const platformSettingsSignal = signal<BillingSettings | null>(null);

function token(): string | null {
  return tokenSignal.value;
}

function tenantBase(): string | null {
  const tenantId = effectiveTenantIdSignal.value;
  return tenantId ? `/api/platform/tenants/${tenantId}` : null;
}

function fail(err: unknown, title: string): false {
  showToast({ type: 'error', title, message: err instanceof Error ? err.message : 'Error inesperado' });
  return false;
}

/** Una acción sobre el comercio activo: avisa, recarga Créditos y devuelve si salió bien. */
async function tenantAction(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: Record<string, unknown>,
  done: string,
): Promise<boolean> {
  const base = tenantBase();
  const t = token();
  if (base === null || t === null) return false;
  try {
    await apiFetch(`${base}${path}`, { method, token: t, body });
    showToast({ type: 'success', title: 'Listo', message: done });
    await refreshCredits();
    return true;
  } catch (err: unknown) {
    return fail(err, 'No se pudo completar');
  }
}

/** Saca las claves sin valor: los opcionales vacíos no viajan. */
function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== ''));
}

export function registerPayment(input: { day: string; amount: number; info?: string | undefined }): Promise<boolean> {
  return tenantAction('/payments', 'POST', compact(input), 'Pago registrado');
}

export function grantCredits(input: { amount: number; expiresOn: string; reason?: string | undefined }): Promise<boolean> {
  return tenantAction('/gift-credits', 'POST', compact(input), 'Créditos otorgados');
}

export function voidCredit(creditId: string, reason: string): Promise<boolean> {
  return tenantAction(`/gift-credits/${creditId}`, 'DELETE', { reason }, 'Créditos anulados');
}

export function extendGrace(until: string): Promise<boolean> {
  return tenantAction('/grace', 'POST', { until }, 'Gracia extendida');
}

export function registerRefund(input: { amount: number; info?: string | undefined }): Promise<boolean> {
  return tenantAction('/refunds', 'POST', compact(input), 'Devolución registrada');
}

export function changeHolder(userId: string): Promise<boolean> {
  return tenantAction('/holder', 'PUT', { userId }, 'Titular cambiado');
}

/** Los owners activos del comercio: los únicos que pueden ser titulares. */
export async function fetchOwners(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const t = token();
  if (!tenantId || t === null) return;
  try {
    const res = await apiFetch<{ members: MemberItem[] }>(`tenants/${tenantId}/users`, { token: t });
    ownersSignal.value = res.members.filter((m) => m.role === 'owner' && m.status === 'active');
  } catch (err: unknown) {
    fail(err, 'No se pudieron cargar los owners');
  }
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
      await fetchPlatformPayments();
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
  const t = token();
  if (t === null) return;
  try {
    platformPaymentsSignal.value = await apiFetch<PlatformPaymentItem[]>('/api/platform/payments', { token: t });
  } catch (err: unknown) {
    fail(err, 'No se pudieron cargar los pagos');
  }
}

export async function fetchPlatformSettings(): Promise<void> {
  const t = token();
  if (t === null) return;
  try {
    platformSettingsSignal.value = await apiFetch<BillingSettings>('/api/platform/settings', { token: t });
  } catch (err: unknown) {
    fail(err, 'No se pudo cargar la configuración');
  }
}

export async function savePlatformSettings(patch: Partial<BillingSettings>): Promise<boolean> {
  const t = token();
  if (t === null) return false;
  try {
    platformSettingsSignal.value = await apiFetch<BillingSettings>('/api/platform/settings', { method: 'PUT', token: t, body: patch });
    showToast({ type: 'success', title: 'Configuración guardada', message: 'Los cambios valen para los cargos nuevos' });
    return true;
  } catch (err: unknown) {
    return fail(err, 'No se pudo guardar');
  }
}

if (typeof window !== 'undefined') {
  effect(() => {
    if (activeSectionSignal.value === 'platform' && tokenSignal.value) {
      void fetchPlatformPayments();
      void fetchPlatformSettings();
    }
  });
}
