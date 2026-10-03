import { describe, it, expect } from 'vitest';
import { calculateDaySummary } from '../src/server/sales/day-summary.ts';
import { methodKey } from '../src/shared/payment-methods.ts';

const line = (qty: number, unitPrice: number) => ({ qty, unitPrice });
const pay = (method: string, amount: number) => ({ method, amount });

describe('resumen del día como el /RESUMEN del POS (#20)', () => {
  it('ventas, anulación, devolución, medio desconocido, movimientos y cobranzas', () => {
    const summary = calculateDaySummary({
      sales: [
        { id: 's1', total: 1000, lines: [line(2, 500)], payments: [pay('cash', 1000)] },
        // Descuento de línea: el ajuste del POS es total − Σ unitPrice·qty
        { id: 's2', total: 500, lines: [line(1, 550)], payments: [pay('debit', 500)] },
        { id: 's3', total: -1000, lines: [line(-2, 500)], payments: [pay('cash', -1000)] },
        { id: 's4', total: -200, lines: [line(-1, 200)], payments: [pay('cash', -200)] },
        { id: 's5', total: 300, lines: [line(3, 100)], payments: [pay('crypto', 300)] },
      ],
      movements: [
        { direction: 'in', amount: 2000, source: 'manual' },
        { direction: 'out', amount: 500, source: 'manual' },
        { direction: 'out', amount: 150, source: 'count-adjustment' },
        { direction: null, amount: 999, source: null },
      ],
      collections: [
        { id: 'c1', total: 700, payments: [pay('cash', 700)] },
        { id: 'c2', total: 300, payments: [pay('transfer', 300)] },
        { id: 'c3', total: -700, payments: [pay('cash', -700)] },
      ],
      voidedSaleIds: new Set(['s1']),
      voidedPaymentIds: new Set(['c1']),
    });

    expect(summary).toEqual({
      totalSold: 600,
      ticketCount: 5,
      voidedCount: 1,
      adjustmentTotal: -50,
      totalsByMethod: { cash: -200, debit: 500, credit: 0, transfer: 0, qr: 0, account: 0, other: 300 },
      otherPayments: 800,
      cash: { sales: -200, income: 2000, expense: 500, countAdjustments: -150, collections: 0 },
      collections: { total: 300, count: 3, voidedCount: 1 },
      collectionsByMethod: { cash: 0, debit: 0, credit: 0, transfer: 300, qr: 0, account: 0, other: 0 },
    });
  });

  it('redondea a 2 decimales y un día vacío da ceros', () => {
    const summary = calculateDaySummary({
      sales: [
        { id: 'a', total: 0.1, lines: [], payments: [pay('cash', 0.1)] },
        { id: 'b', total: 0.2, lines: [], payments: [pay('cash', 0.2)] },
      ],
      movements: [], collections: [], voidedSaleIds: new Set(), voidedPaymentIds: new Set(),
    });
    expect(summary.totalSold).toBe(0.3);
    expect(summary.cash.sales).toBe(0.3);
    expect(calculateDaySummary({ sales: [], movements: [], collections: [], voidedSaleIds: new Set(), voidedPaymentIds: new Set() }).ticketCount).toBe(0);
  });

  it('un medio que no está en el contrato es "other"', () => {
    expect(methodKey('qr')).toBe('qr');
    expect(methodKey('crypto')).toBe('other');
  });
});
