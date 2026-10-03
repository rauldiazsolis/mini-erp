import { describe, it, expect } from 'vitest';
import { allocateCharge } from '../src/server/billing/allocation.ts';

const g = (creditId: string, remaining: number) => ({ creditId, remaining });

describe('reparto de un cargo (#21)', () => {
  it.each([
    ['con pagado, 50/50', { price: 1000, paidShare: 0.5, paidBalance: 5000, gifts: [g('a', 5000)] }, { paid: 500, gifts: [{ creditId: 'a', amount: 500 }], debt: 0 }],
    ['sin pagado, 100 % regalado', { price: 1000, paidShare: 0.5, paidBalance: 0, gifts: [g('a', 5000)] }, { paid: 0, gifts: [{ creditId: 'a', amount: 1000 }], debt: 0 }],
    ['sin regalados, 100 % pagado', { price: 1000, paidShare: 0.5, paidBalance: 5000, gifts: [] }, { paid: 1000, gifts: [], debt: 0 }],
    ['el pagado no alcanza: el regalado completa', { price: 1000, paidShare: 0.5, paidBalance: 200, gifts: [g('a', 5000)] }, { paid: 200, gifts: [{ creditId: 'a', amount: 800 }], debt: 0 }],
    ['el regalado no alcanza: el pagado completa', { price: 1000, paidShare: 0.5, paidBalance: 5000, gifts: [g('a', 300)] }, { paid: 700, gifts: [{ creditId: 'a', amount: 300 }], debt: 0 }],
    ['regalados por vencimiento, en orden', { price: 1000, paidShare: 0, paidBalance: 0, gifts: [g('a', 400), g('b', 5000)] }, { paid: 0, gifts: [{ creditId: 'a', amount: 400 }, { creditId: 'b', amount: 600 }], debt: 0 }],
    ['nada alcanza: el resto es deuda', { price: 1000, paidShare: 0.5, paidBalance: 100, gifts: [g('a', 300)] }, { paid: 100, gifts: [{ creditId: 'a', amount: 300 }], debt: 600 }],
    ['sin nada: todo deuda', { price: 1000, paidShare: 0.5, paidBalance: 0, gifts: [] }, { paid: 0, gifts: [], debt: 1000 }],
    ['pesos enteros: la parte pagada se redondea', { price: 1000, paidShare: 0.333, paidBalance: 5000, gifts: [g('a', 5000)] }, { paid: 333, gifts: [{ creditId: 'a', amount: 667 }], debt: 0 }],
    ['proporción 100 %: el regalado no se toca con pagado', { price: 1000, paidShare: 1, paidBalance: 5000, gifts: [g('a', 5000)] }, { paid: 1000, gifts: [], debt: 0 }],
    ['un saldo pagado negativo cuenta como 0', { price: 1000, paidShare: 0.5, paidBalance: -50, gifts: [g('a', 5000)] }, { paid: 0, gifts: [{ creditId: 'a', amount: 1000 }], debt: 0 }],
  ])('%s', (_name, input, expected) => {
    expect(allocateCharge(input)).toEqual(expected);
  });
});
