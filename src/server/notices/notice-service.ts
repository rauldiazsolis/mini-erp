import type { DatabaseSync } from 'node:sqlite';
import { listOpenDiscrepancies } from '../discrepancy/discrepancies.ts';
import { formatDayShort, formatPesos } from '../billing/money-text.ts';
import type { BillingSummary } from '../../shared/credits-types.ts';
import type { RegisterNoticeState } from '../../shared/register-types.ts';

/** Aviso del backend para la terminal (contrato 4.4.0, `BackendNotice`). */
export type BackendNotice = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  ref?: { type: string; id: string };
};

/** Lo que los avisos necesitan además de la base del comercio: el cobro y la caja de la terminal (#21). */
export type NoticeContext = {
  deviceId: string | undefined;
  billing?: BillingSummary | undefined;
  register?: RegisterNoticeState | undefined;
};

/**
 * La lista vigente y completa de avisos de un equipo (#2), calculada en el momento: un aviso
 * desaparece cuando su causa se resuelve. Créditos y caja (#21) y las discrepancias abiertas que generó.
 */
export function noticesFor(db: DatabaseSync, ctx: NoticeContext): BackendNotice[] {
  const notices: BackendNotice[] = [];
  const credits = creditsNotice(ctx.billing);
  if (credits !== undefined) notices.push(credits);
  const register = registerNotice(ctx.register);
  if (register !== undefined) notices.push(register);
  if (ctx.deviceId === undefined || ctx.deviceId === '') {
    return notices;
  }
  return [
    ...notices,
    ...listOpenDiscrepancies(db, { deviceId: ctx.deviceId }).map((d): BackendNotice => ({
      id: `discrepancy:${d.id}`,
      severity: 'warning',
      message: d.message,
      ref: { type: d.refType, id: d.refId },
    })),
  ];
}

/** Saldo bajo, deuda o restricción: excluyentes. Una demo (sin titular) no tiene. */
function creditsNotice(billing: BillingSummary | undefined): BackendNotice | undefined {
  if (billing === undefined || !billing.billable) return undefined;
  switch (billing.state) {
    case 'low':
      return {
        id: 'credits:low',
        severity: 'warning',
        message: `Te quedan créditos para unos ${String(billing.daysCovered ?? 0)} días. Cargá saldo desde mini → Créditos.`,
      };
    case 'debt':
      return {
        id: 'credits:debt',
        severity: 'critical',
        message: `mini contax: sin créditos, debés ${formatPesos(billing.debt)}. Pagá antes del ${formatDayShort(billing.deadline ?? '')} para que mini siga funcionando. El POS sigue vendiendo.`,
      };
    case 'restricted':
      return {
        id: 'credits:restricted',
        severity: 'critical',
        message: `mini contax está restringido por deuda de ${formatPesos(billing.debt)}. El POS sigue vendiendo y sincronizando. Pagá desde mini → Créditos.`,
      };
    case 'ok':
      return undefined;
  }
}

function registerNotice(register: RegisterNoticeState | undefined): BackendNotice | undefined {
  if (register === undefined) return undefined;
  const ref = { type: 'register', id: register.registerId };
  if (register.binding === 'foreign') {
    return {
      id: 'register:foreign-device',
      severity: 'warning',
      ref,
      message: 'Esta caja está ligada a otro equipo: tus ventas se cobran aparte. Pedile al dueño que te pase la caja o te cree una.',
    };
  }
  if (register.sharedRecently) {
    return { id: 'register:shared-key', severity: 'warning', ref, message: 'Otro equipo está usando la key de esta caja.' };
  }
  return undefined;
}
