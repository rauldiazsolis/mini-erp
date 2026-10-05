import { describe, it, expect } from 'vitest';
import { parseBatchEvent } from '../src/server/connector/push-events.ts';

const createdAt = '2026-09-29T12:00:00.000Z';
const envelope = { createdAt, origin: { branch: 'CENTRAL', pointOfSale: 'POS-01' } };

const validEvents = {
  sale: {
    id: 'e-sale',
    type: 'sale',
    ...envelope,
    sale: { id: 's1', total: 100, status: 'closed', lines: [], payments: [{ method: 'cash', amount: 100 }], createdAt },
  },
  'stock-movement': {
    id: 'e-sm',
    type: 'stock-movement',
    ...envelope,
    movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt },
  },
  customer: { id: 'e-c', type: 'customer', ...envelope, customer: { id: 'c1', name: 'Ana', createdAt } },
  'account-hold-confirm': { id: 'e-hc', type: 'account-hold-confirm', ...envelope, holdId: 'h1', saleId: 's1' },
  'account-hold-release': { id: 'e-hr', type: 'account-hold-release', ...envelope, holdId: 'h1' },
  'cash-movement': {
    id: 'e-cm',
    type: 'cash-movement',
    ...envelope,
    movement: { id: 'cm1', direction: 'in', amount: 10, concept: 'Cambio', source: 'manual', createdAt },
  },
  'customer-payment': {
    id: 'e-cp',
    type: 'customer-payment',
    ...envelope,
    payment: { id: 'cp1', customerId: 'c1', payments: [{ method: 'cash', amount: 5 }], total: 5, createdAt },
  },
};

// Por tipo, un evento con un campo que el mini-erp lee roto o faltante.
const brokenEvents = {
  sale: { ...validEvents.sale, sale: { ...validEvents.sale.sale, total: 'cien' } },
  'stock-movement': {
    ...validEvents['stock-movement'],
    movement: { id: 'm1', productId: 'p1', reason: 'sale', createdAt },
  },
  customer: { ...validEvents.customer, customer: { id: 'c1', createdAt } },
  'account-hold-confirm': { id: 'e-hc', type: 'account-hold-confirm', ...envelope, holdId: 'h1' },
  'account-hold-release': { id: 'e-hr', type: 'account-hold-release', ...envelope },
  'cash-movement': { ...validEvents['cash-movement'], movement: { direction: 'in', amount: 10 } },
  'customer-payment': {
    ...validEvents['customer-payment'],
    payment: { id: 'cp1', customerId: 'c1', total: '5', createdAt },
  },
};

describe('parseBatchEvent (#1)', () => {
  it.each(Object.entries(validEvents))('acepta un evento %s válido', (type, raw) => {
    expect(parseBatchEvent(raw)).toMatchObject({ ok: true, event: { id: raw.id, type } });
  });

  it.each(Object.entries(brokenEvents))('un evento %s inválido es un issue con su eventId', (type, raw) => {
    expect(parseBatchEvent(raw)).toMatchObject({
      ok: false,
      issue: { eventId: raw.id, message: expect.stringContaining(`Evento ${type} inválido`) as unknown },
    });
  });

  it('conserva los campos que no valida (passthrough)', () => {
    expect(parseBatchEvent(validEvents.sale)).toMatchObject({
      ok: true,
      event: { origin: { branch: 'CENTRAL' }, sale: { status: 'closed', lines: [], createdAt } },
    });
  });

  it('conserva los campos desconocidos en todos los niveles', () => {
    const extra = { futuro: { x: 1 } };
    const sale = {
      ...validEvents.sale,
      ...extra,
      origin: { ...envelope.origin, ...extra },
      sale: { ...validEvents.sale.sale, ...extra, payments: [{ method: 'cash', amount: 100, ...extra }] },
    };
    const customer = {
      ...validEvents.customer,
      customer: { ...validEvents.customer.customer, ...extra, blocked: { reason: 'Mora', ...extra } },
    };
    const cash = { ...validEvents['cash-movement'], movement: { ...validEvents['cash-movement'].movement, ...extra } };
    const payment = { ...validEvents['customer-payment'], payment: { ...validEvents['customer-payment'].payment, ...extra } };
    const movement = { ...validEvents['stock-movement'], movement: { ...validEvents['stock-movement'].movement, ...extra } };
    expect(parseBatchEvent(sale)).toMatchObject({
      ok: true,
      event: { ...extra, origin: extra, sale: { ...extra, payments: [extra] } },
    });
    expect(parseBatchEvent(customer)).toMatchObject({ ok: true, event: { customer: { ...extra, blocked: extra } } });
    expect(parseBatchEvent(cash)).toMatchObject({ ok: true, event: { movement: extra } });
    expect(parseBatchEvent(payment)).toMatchObject({ ok: true, event: { payment: extra } });
    expect(parseBatchEvent(movement)).toMatchObject({ ok: true, event: { movement: extra } });
  });

  it('acepta un medio de pago o un motivo que no conoce (reglas de evolución)', () => {
    const sale = {
      ...validEvents.sale,
      sale: { ...validEvents.sale.sale, payments: [{ method: 'cripto', amount: 100 }] },
    };
    const movement = {
      ...validEvents['stock-movement'],
      movement: { ...validEvents['stock-movement'].movement, reason: 'merma' },
    };
    expect(parseBatchEvent(sale)).toMatchObject({ ok: true });
    expect(parseBatchEvent(movement)).toMatchObject({ ok: true });
  });

  it('acepta un evento de un POS anterior, sin origin ni createdAt', () => {
    expect(parseBatchEvent({ id: 'e-old', type: 'account-hold-release', holdId: 'h1' })).toMatchObject({ ok: true });
  });

  it('un tipo desconocido es un issue "no reconocido" con su eventId', () => {
    expect(parseBatchEvent({ id: 'e-x', type: 'session-open', ...envelope })).toEqual({
      ok: false,
      issue: { message: 'Tipo de evento no reconocido: session-open', eventId: 'e-x' },
    });
  });

  it.each([null, 42, 'venta', [], { type: 'sale' }, { id: '', type: 'sale' }])(
    'un elemento sin sobre válido (%j) es un issue sin eventId',
    (raw) => {
      const result = parseBatchEvent(raw);
      expect(result).toMatchObject({
        ok: false,
        issue: { message: expect.stringContaining('Evento inválido') as unknown },
      });
      expect(result.ok ? undefined : result.issue.eventId).toBeUndefined();
    },
  );

  it('un sobre sin type conserva el eventId', () => {
    expect(parseBatchEvent({ id: 'e-sin-tipo' })).toMatchObject({ ok: false, issue: { eventId: 'e-sin-tipo' } });
  });
});
