import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { createTenantSchema } from '../src/server/db/pg/migrations/migrate.ts';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { applyToBalance } from '../src/server/customer/account-ledger.ts';
import {
  applyPendingFor, dismissDiscrepancy, listOpenDiscrepancies, recordDiscrepancy, resolveVoidUnknown,
} from '../src/server/discrepancy/discrepancies.ts';
import { discrepancyMessage } from '../src/server/discrepancy/messages.ts';
import { DomainError } from '../src/server/errors.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pg = setupTestDb();

const at = '2026-10-02T12:00:00.000Z';
let db: Kysely<TenantDatabase>;

beforeEach(async () => {
  await createTenantSchema(pg().root, 'kiosco');
  db = pg().forTenant('kiosco');
});

const cliente = async (id: string, balance: number | null = 0) => {
  await db.insertInto('customers').values({ id, name: id, balance, created_at: at, updated_at: at }).execute();
};
const saldo = async (id: string) => (await db.selectFrom('customers').select('balance').where('id', '=', id).executeTakeFirstOrThrow()).balance;
const movimientos = async () =>
  await db.selectFrom('account_movements').select(['type', 'amount', 'balance_after', 'sale_id']).orderBy('seq').execute();
const base = { deviceId: 'dev-1', originBranch: 'CENTRAL', originPos: 'Caja 1' };

describe('applyToBalance (#2)', () => {
  it('suma al saldo y escribe el extracto; con un cliente desconocido devuelve false', async () => {
    await cliente('c1', 100);
    expect(await applyToBalance(db, 'c1', { type: 'sale', delta: 50, description: 'Venta v1', saleId: 'v1' }, at)).toBe(true);
    expect(await saldo('c1')).toBe(150);
    expect(await movimientos()).toEqual([
      { type: 'sale', amount: 50, balance_after: 150, sale_id: 'v1' },
    ]);
    expect(await applyToBalance(db, 'nadie', { type: 'sale', delta: 50, description: 'x' }, at)).toBe(false);
    expect(await movimientos()).toHaveLength(1);
  });

  it('el saldo se suma sobre numeric: sin ruido de coma flotante, y el extracto cuadra', async () => {
    await cliente('c1', 0);
    // 0.1 + 0.2 en JS es 0.30000000000000004; el POS manda totales así
    await applyToBalance(db, 'c1', { type: 'sale', delta: 0.1, description: 'a' }, at);
    await applyToBalance(db, 'c1', { type: 'sale', delta: 0.2, description: 'b' }, at);
    await applyToBalance(db, 'c1', { type: 'sale', delta: 0.1 + 0.2, description: 'c' }, at);
    expect(await saldo('c1')).toBe(0.6);
    expect((await movimientos()).map((m) => [m.amount, m.balance_after])).toEqual([[0.1, 0.1], [0.2, 0.3], [0.3, 0.6]]);
  });

  it('el importe se redondea al centavo y el saldo se mueve por lo que quedó guardado', async () => {
    await cliente('c1', 10);
    await applyToBalance(db, 'c1', { type: 'sale', delta: 1.005, description: 'a' }, at);
    await applyToBalance(db, 'c1', { type: 'payment', delta: -0.004, description: 'b' }, at);
    const filas = await movimientos();
    expect(filas.map((m) => m.amount)).toEqual([1.01, 0]);
    // balance_after es el saldo anterior más los importes guardados
    expect(filas.map((m) => m.balance_after)).toEqual([11.01, 11.01]);
    expect(await saldo('c1')).toBe(11.01);
  });

  it('un saldo en null cuenta como 0', async () => {
    await cliente('c1', null);
    await applyToBalance(db, 'c1', { type: 'sale', delta: 25, description: 'a' }, at);
    expect(await saldo('c1')).toBe(25);
  });

  it('dos movimientos a la vez no se pisan', async () => {
    await cliente('c1', 0);
    await Promise.all([1, 2, 3, 4].map((n) => applyToBalance(db, 'c1', { type: 'sale', delta: 10, description: `v${String(n)}` }, at)));
    expect(await saldo('c1')).toBe(40);
    expect((await movimientos()).map((m) => m.balance_after)).toEqual([10, 20, 30, 40]);
  });

  it('dentro de una transacción que se deshace no queda nada', async () => {
    await cliente('c1', 0);
    await expect(
      db.transaction().execute(async (trx) => {
        await applyToBalance(trx, 'c1', { type: 'sale', delta: 10, description: 'a' }, at);
        throw new Error('se deshace');
      }),
    ).rejects.toThrow('se deshace');
    expect(await saldo('c1')).toBe(0);
    expect(await movimientos()).toEqual([]);
  });
});

describe('discrepancias (#2)', () => {
  it('un movimiento pendiente se aplica cuando el cliente aparece, en orden', async () => {
    await recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950,
      pending: { type: 'sale', delta: 950, description: 'Venta v1', saleId: 'v1' } }, at);
    await recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'customer-payment', refId: 'p1', amount: -500,
      pending: { type: 'payment', delta: -500, description: 'Cobranza p1' } }, '2026-10-02T12:01:00.000Z');
    expect(await listOpenDiscrepancies(db)).toHaveLength(2);

    await cliente('c9');
    expect(await applyPendingFor(db, 'c9', at)).toBe(2);
    expect(await saldo('c9')).toBe(450);
    expect(await listOpenDiscrepancies(db)).toEqual([]);
    expect(await db.selectFrom('discrepancies').select(['resolution', 'resolved_by']).orderBy('seq').execute()).toEqual([
      { resolution: 'applied', resolved_by: 'system' }, { resolution: 'applied', resolved_by: 'system' },
    ]);
  });

  it('una descartada no se aplica', async () => {
    const id = await recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950,
      pending: { type: 'sale', delta: 950, description: 'Venta v1' } }, at);
    await dismissDiscrepancy(db, id, 'user-1', 'Era una prueba', at);
    await cliente('c9');
    expect(await applyPendingFor(db, 'c9', at)).toBe(0);
    expect(await saldo('c9')).toBe(0);
  });

  it('descartar: 404 si no existe, 409 si ya está resuelta', async () => {
    await expect(dismissDiscrepancy(db, 'nada', 'u', 'x', at)).rejects.toThrow(DomainError);
    const id = await recordDiscrepancy(db, { ...base, kind: 'void-duplicate', customerId: 'c1', refType: 'customer-payment', refId: 'p3', amount: 500 }, at);
    await dismissDiscrepancy(db, id, 'u', 'Revisado', at);
    try {
      await dismissDiscrepancy(db, id, 'u', 'otra vez', at);
      expect.unreachable();
    } catch (err: unknown) {
      expect(err instanceof DomainError ? err.status : 0).toBe(409);
    }
  });

  it('una discrepancia ya aplicada no se descarta: el descarte no la pisa', async () => {
    const id = await recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950,
      pending: { type: 'sale', delta: 950, description: 'Venta v1' } }, at);
    await cliente('c9');
    await applyPendingFor(db, 'c9', at);
    await expect(dismissDiscrepancy(db, id, 'u', 'tarde', at)).rejects.toMatchObject({ status: 409 });
    expect(await db.selectFrom('discrepancies').select(['resolution', 'resolved_by', 'note']).execute()).toEqual([
      { resolution: 'applied', resolved_by: 'system', note: null },
    ]);
  });

  it('un pendiente que no es un movimiento válido no se aplica y sigue abierto', async () => {
    await recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950 }, at);
    await db.updateTable('discrepancies').set({ pending: JSON.stringify({ type: 'sale', delta: 'mucho' }) }).execute();
    await cliente('c9');
    expect(await applyPendingFor(db, 'c9', at)).toBe(0);
    expect(await saldo('c9')).toBe(0);
    expect(await listOpenDiscrepancies(db)).toHaveLength(1);
  });

  it('con la misma hora, se listan y se aplican en orden de llegada', async () => {
    for (const n of [1, 2, 3]) {
      await recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'sale', refId: `v${String(n)}`, amount: n,
        pending: { type: 'sale', delta: n, description: `Venta v${String(n)}` } }, at);
    }
    expect((await listOpenDiscrepancies(db)).map((d) => d.refId)).toEqual(['v1', 'v2', 'v3']);
    await cliente('c9');
    await applyPendingFor(db, 'c9', at);
    expect((await db.selectFrom('account_movements').select('description').orderBy('seq').execute()).map((m) => m.description)).toEqual([
      'Venta v1', 'Venta v2', 'Venta v3',
    ]);
  });

  it('resolveVoidUnknown resuelve las anulaciones que esperaban a esa cobranza', async () => {
    await recordDiscrepancy(db, { ...base, kind: 'void-unknown-payment', customerId: 'c1', refType: 'customer-payment', refId: 'p2', amount: 500,
      pending: undefined, voidsPaymentId: 'p1' }, at);
    await recordDiscrepancy(db, { ...base, kind: 'void-unknown-payment', customerId: 'c1', refType: 'customer-payment', refId: 'p4', amount: 500,
      pending: undefined, voidsPaymentId: 'otra' }, at);
    await resolveVoidUnknown(db, 'p1', at);
    // La que esperaba a otra cobranza sigue abierta
    expect((await listOpenDiscrepancies(db)).map((d) => d.refId)).toEqual(['p4']);
  });

  it('filtra por equipo y arma el mensaje', async () => {
    await recordDiscrepancy(db, { ...base, kind: 'unknown-customer', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950,
      pending: { type: 'sale', delta: 950, description: 'Venta v1' } }, at);
    expect(await listOpenDiscrepancies(db, { deviceId: 'otro' })).toEqual([]);
    const [d] = await listOpenDiscrepancies(db, { deviceId: 'dev-1' });
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
