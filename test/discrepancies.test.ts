import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { applyToBalance } from '../src/server/customer/account-ledger.ts';
import {
  applyPendingFor, dismissDiscrepancy, listOpenDiscrepancies, recordDiscrepancy, resolveVoidUnknown,
} from '../src/server/discrepancy/discrepancies.ts';
import { discrepancyMessage } from '../src/server/discrepancy/messages.ts';
import { DomainError } from '../src/server/errors.ts';

const at = '2026-10-02T12:00:00.000Z';
let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  initTenantDb(db);
});

const cliente = (id: string, balance = 0) =>
  db.prepare('INSERT INTO customers (id, name, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, id, balance, at, at);
const saldo = (id: string) => (db.prepare('SELECT balance FROM customers WHERE id = ?').get(id) as { balance: number }).balance;
const base = { deviceId: 'dev-1', originBranch: 'CENTRAL', originPos: 'Caja 1' };

describe('applyToBalance (#2)', () => {
  it('suma al saldo y escribe el extracto; con un cliente desconocido devuelve false', () => {
    cliente('c1', 100);
    expect(applyToBalance(db, 'c1', { type: 'sale', delta: 50, description: 'Venta v1', saleId: 'v1' }, at)).toBe(true);
    expect(saldo('c1')).toBe(150);
    expect(db.prepare('SELECT type, amount, balance_after, sale_id FROM account_movements').all()).toEqual([
      { type: 'sale', amount: 50, balance_after: 150, sale_id: 'v1' },
    ]);
    expect(applyToBalance(db, 'nadie', { type: 'sale', delta: 50, description: 'x' }, at)).toBe(false);
  });
});

describe('discrepancias (#2)', () => {
  it('un movimiento pendiente se aplica cuando el cliente aparece, en orden', () => {
    recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950,
      pending: { type: 'sale', delta: 950, description: 'Venta v1', saleId: 'v1' } }, at);
    recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'customer-payment', refId: 'p1', amount: -500,
      pending: { type: 'payment', delta: -500, description: 'Cobranza p1' } }, '2026-10-02T12:01:00.000Z');
    expect(listOpenDiscrepancies(db)).toHaveLength(2);

    cliente('c9');
    expect(applyPendingFor(db, 'c9', at)).toBe(2);
    expect(saldo('c9')).toBe(450);
    expect(listOpenDiscrepancies(db)).toEqual([]);
    expect(db.prepare("SELECT resolution, resolved_by FROM discrepancies").all()).toEqual([
      { resolution: 'applied', resolved_by: 'system' }, { resolution: 'applied', resolved_by: 'system' },
    ]);
  });

  it('una descartada no se aplica', () => {
    const id = recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950,
      pending: { type: 'sale', delta: 950, description: 'Venta v1' } }, at);
    dismissDiscrepancy(db, id, 'user-1', 'Era una prueba', at);
    cliente('c9');
    expect(applyPendingFor(db, 'c9', at)).toBe(0);
    expect(saldo('c9')).toBe(0);
  });

  it('descartar: 404 si no existe, 409 si ya está resuelta', () => {
    expect(() => { dismissDiscrepancy(db, 'nada', 'u', 'x', at); }).toThrow(DomainError);
    const id = recordDiscrepancy(db, { ...base, kind: 'void-duplicate', customerId: 'c1', refType: 'customer-payment', refId: 'p3', amount: 500 }, at);
    dismissDiscrepancy(db, id, 'u', 'Revisado', at);
    try {
      dismissDiscrepancy(db, id, 'u', 'otra vez', at);
      expect.unreachable();
    } catch (err: unknown) {
      expect(err instanceof DomainError ? err.status : 0).toBe(409);
    }
  });

  it('resolveVoidUnknown resuelve las anulaciones que esperaban a esa cobranza', () => {
    recordDiscrepancy(db, { ...base, kind: 'void-unknown-payment', customerId: 'c1', refType: 'customer-payment', refId: 'p2', amount: 500,
      pending: undefined, voidsPaymentId: 'p1' }, at);
    resolveVoidUnknown(db, 'p1', at);
    expect(listOpenDiscrepancies(db)).toEqual([]);
  });

  it('filtra por equipo y arma el mensaje', () => {
    recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950,
      pending: { type: 'sale', delta: 950, description: 'Venta v1' } }, at);
    expect(listOpenDiscrepancies(db, { deviceId: 'otro' })).toEqual([]);
    const [d] = listOpenDiscrepancies(db, { deviceId: 'dev-1' });
    expect(d?.message).toBe('La venta a cuenta de $950 es de un cliente que mini contax todavía no tiene: se suma a su saldo cuando llegue el cliente.');
  });

  it.each([
    ['unknown-customer', 'customer-payment', -500, 'La cobranza de $500 es de un cliente que mini contax todavía no tiene: se descuenta de su saldo cuando llegue el cliente.'],
    ['void-unknown-payment', 'customer-payment', 500, 'Se anuló una cobranza que mini contax no tiene registrada ($500): revisalo en mini contax.'],
    ['void-customer-mismatch', 'customer-payment', 500, 'Se anuló una cobranza de otro cliente ($500): revisalo en mini contax.'],
    ['void-duplicate', 'customer-payment', 1234.5, 'Esa cobranza ya estaba anulada y se volvió a anular ($1.234,5): revisalo en mini contax.'],
  ] as const)('mensaje de %s', (kind, refType, amount, esperado) => {
    expect(discrepancyMessage({ kind, refType, amount })).toBe(esperado);
  });
});
