import type { BillingState } from '../../../shared/credits-types.ts';
import type { AccountStatus, TenantStatus } from '../../../shared/platform-types.ts';

const BADGE = {
  neutral: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20',
  ok: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  danger: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
};

export function Badge(props: { tone: keyof typeof BADGE; children: string }) {
  return <span class={`inline-block text-[11px] px-2 py-0.5 rounded-full border font-semibold ${BADGE[props.tone]}`}>{props.children}</span>;
}

const BILLING: Record<BillingState, { text: string; tone: keyof typeof BADGE }> = {
  ok: { text: 'Al día', tone: 'ok' },
  low: { text: 'Saldo bajo', tone: 'warning' },
  debt: { text: 'Con deuda', tone: 'danger' },
  restricted: { text: 'Restringido', tone: 'danger' },
};

/** El estado de cobro de un comercio (#21), en las listas de la plataforma (#23). */
export function BillingBadge(props: { state: BillingState }) {
  const b = BILLING[props.state];
  return <Badge tone={b.tone}>{b.text}</Badge>;
}

export function TenantStatusBadge(props: { status: TenantStatus }) {
  if (props.status === 'suspended') return <Badge tone="danger">Suspendido</Badge>;
  if (props.status === 'maintenance') return <Badge tone="warning">Mantenimiento</Badge>;
  return <Badge tone="ok">Activo</Badge>;
}

export function AccountStatusBadge(props: { status: AccountStatus }) {
  return props.status === 'disabled' ? <Badge tone="danger">Desactivada</Badge> : <Badge tone="ok">Activa</Badge>;
}
