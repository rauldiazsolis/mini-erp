import { roundAmount } from '../dashboard/sale-lines.ts';
import { methodKey, type MethodKey } from '../../shared/payment-methods.ts';
import type { DaySummary } from '../../shared/sales-types.ts';

/**
 * Copia fiel de `calculateDaySummary` de offline-pos (`src/domain/day-summary.ts`, #20). El resumen
 * de mini tiene que cuadrar con el `/RESUMEN` del POS. Cambios: un medio desconocido suma en
 * `other` (reglas de evolución 4.4.0) y los totales por medio también se redondean. Una cobranza no
 * es una venta: tiene sus propios totales y su fila en el efectivo.
 */

type Money = { method: string; amount: number };
export type SummarySale = { id: string; total: number; lines: ReadonlyArray<{ qty: number; unitPrice: number }>; payments: readonly Money[] };
export type SummaryMovement = { direction: 'in' | 'out' | null; amount: number; source: string | null };
export type SummaryCollection = { id: string; total: number; payments: readonly Money[] };

function emptyByMethod(): Record<MethodKey, number> {
  return { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0, other: 0 };
}

function roundByMethod(totals: Record<MethodKey, number>): Record<MethodKey, number> {
  return {
    cash: roundAmount(totals.cash),
    debit: roundAmount(totals.debit),
    credit: roundAmount(totals.credit),
    transfer: roundAmount(totals.transfer),
    qr: roundAmount(totals.qr),
    account: roundAmount(totals.account),
    other: roundAmount(totals.other),
  };
}

export function calculateDaySummary(params: {
  sales: readonly SummarySale[];
  movements: readonly SummaryMovement[];
  collections: readonly SummaryCollection[];
  voidedSaleIds: ReadonlySet<string>;
  voidedPaymentIds: ReadonlySet<string>;
}): DaySummary {
  const totalsByMethod = emptyByMethod();
  let totalSold = 0;
  let adjustmentTotal = 0;
  for (const sale of params.sales) {
    totalSold += sale.total;
    adjustmentTotal += sale.total - sale.lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
    for (const payment of sale.payments) {
      totalsByMethod[methodKey(payment.method)] += payment.amount;
    }
  }

  let income = 0;
  let expense = 0;
  let countAdjustments = 0;
  for (const movement of params.movements) {
    if (movement.direction === null) continue;
    if (movement.source === 'count-adjustment') {
      countAdjustments += movement.direction === 'in' ? movement.amount : -movement.amount;
    } else if (movement.direction === 'in') {
      income += movement.amount;
    } else {
      expense += movement.amount;
    }
  }

  const collectionsByMethod = emptyByMethod();
  let collectionsTotal = 0;
  for (const collection of params.collections) {
    collectionsTotal += collection.total;
    for (const payment of collection.payments) {
      collectionsByMethod[methodKey(payment.method)] += payment.amount;
    }
  }

  const byMethod = roundByMethod(totalsByMethod);
  const collectionsRounded = roundByMethod(collectionsByMethod);
  return {
    totalSold: roundAmount(totalSold),
    ticketCount: params.sales.length,
    voidedCount: params.sales.filter((sale) => params.voidedSaleIds.has(sale.id)).length,
    adjustmentTotal: roundAmount(adjustmentTotal),
    totalsByMethod: byMethod,
    otherPayments: roundAmount(byMethod.debit + byMethod.credit + byMethod.transfer + byMethod.qr + byMethod.account + byMethod.other),
    cash: {
      sales: byMethod.cash,
      income: roundAmount(income),
      expense: roundAmount(expense),
      countAdjustments: roundAmount(countAdjustments),
      collections: collectionsRounded.cash,
    },
    collections: {
      total: roundAmount(collectionsTotal),
      count: params.collections.length,
      voidedCount: params.collections.filter((payment) => params.voidedPaymentIds.has(payment.id)).length,
    },
    collectionsByMethod: collectionsRounded,
  };
}
