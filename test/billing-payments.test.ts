import { describe, it, expect, beforeEach } from 'vitest';
import { sql, type Kysely } from 'kysely';
import type { SystemDatabase } from '../src/server/db/pg/system-schema.ts';
import { BillingService } from '../src/server/billing/billing-service.ts';
import { setupTestDb } from './helpers/test-db.ts';
import { fakeBillingBridge } from './helpers/billing-bridge.ts';

const pgDb = setupTestDb();

describe('pagos, créditos, gracia, devoluciones y titular (#21)', () => {
  let db: Kysely<SystemDatabase>;
  let now: Date;
  let billing: BillingService;

  const gift = async (tenantId: string, amount: number, expiresAt: string) =>
    await db
      .insertInto('gift_credits')
      .values({ id: `g-${tenantId}-${String(amount)}`, tenant_id: tenantId, amount, expires_at: expiresAt, origin: 'grant', created_at: '2026-10-01T00:00:00.000Z' })
      .execute();

  beforeEach(async () => {
    db = pgDb().system;
    const at = '2026-10-01T00:00:00.000Z';
    await db
      .insertInto('users')
      .values([
        { id: 'u1', email: 'u1@x.com', password_hash: 'h', name: 'Ana', global_role: 'user', created_at: at },
        { id: 'u2', email: 'u2@x.com', password_hash: 'h', name: 'Beto', global_role: 'user', created_at: at },
      ])
      .execute();
    for (const t of ['t1', 't2']) {
      await db.insertInto('tenants').values({ id: t, slug: t, name: t, created_at: at, holder_user_id: 'u1' }).execute();
    }
    await db
      .insertInto('memberships')
      .values([
        { user_id: 'u1', tenant_id: 't1', role: 'owner', status: 'active', created_at: at },
        { user_id: 'u2', tenant_id: 't1', role: 'owner', status: 'active', created_at: at },
      ])
      .execute();
    now = new Date('2026-10-05T15:00:00.000Z');
    billing = new BillingService({ db, now: () => now, legacy: fakeBillingBridge() });
  });

  it('un pago cancela primero la deuda, del cargo más antiguo, y el resto queda de saldo', async () => {
    await billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01', '2026-10-02'] });
    await billing.charge({ tenantId: 't2', registerId: 'r2', chargeDevice: '', days: ['2026-10-03'] });
    const res = await billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 2500, actorUserId: 'root' });
    expect(res.settled).toBe(2500);
    const rows = await db
      .selectFrom('charges')
      .select(['day', 'debt_amount', 'paid_amount', sql<boolean>`debt_settled_at IS NOT NULL`.as('settled')])
      .orderBy('day')
      .execute();
    expect(rows).toEqual([
      { day: '2026-10-01', debt_amount: 0, paid_amount: 1000, settled: true },
      { day: '2026-10-02', debt_amount: 0, paid_amount: 1000, settled: true },
      { day: '2026-10-03', debt_amount: 500, paid_amount: 500, settled: false },
    ]);
    expect(await billing.summary('t1')).toMatchObject({ debt: 0, paidBalance: 0, state: 'low' });
    expect(await billing.summary('t2')).toMatchObject({ debt: 500 });
  });

  it('un pago con centavos cancela la deuda y deja los centavos de saldo, sin ruido de coma flotante', async () => {
    await billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01'] });
    const res = await billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 1000.15, actorUserId: 'root' });
    expect(res.settled).toBe(1000);
    expect(await billing.summary('t1')).toMatchObject({ debt: 0, paidBalance: 0.15 });
  });

  it('varios cargos a la vez del mismo titular no gastan dos veces el mismo saldo', async () => {
    await billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 500, actorUserId: 'root' });
    // Con las conexiones del pool ya abiertas, los cuatro cargos corren de verdad a la vez
    await Promise.all(Array.from({ length: 4 }, async () => await sql`SELECT pg_sleep(0.05)`.execute(db)));
    const registers = ['r1', 'r2', 'r3', 'r4'];
    await Promise.all(registers.map((r, i) => billing.charge({ tenantId: i % 2 === 0 ? 't1' : 't2', registerId: r, chargeDevice: '', days: ['2026-10-05'] })));
    expect(await billing.summary('t1')).toMatchObject({ paidBalance: 0 });
    const paidOut = await db.selectFrom('charges').select('paid_amount').execute();
    expect(paidOut.map((c) => c.paid_amount).sort()).toEqual([0, 0, 0, 500]);
  });

  it('un pago más grande que la deuda deja el resto de saldo', async () => {
    await billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01'] });
    await billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 5000, info: 'Transf. 1', actorUserId: 'root' });
    expect(await billing.summary('t1')).toMatchObject({ debt: 0, paidBalance: 4000 });
  });

  it('después de un pago, los cargos siguientes se reparten según la proporción', async () => {
    await gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    await billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 10000, actorUserId: 'root' });
    await billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    expect(await db.selectFrom('charges').select(['paid_amount', 'gift_amount']).executeTakeFirst()).toEqual({ paid_amount: 500, gift_amount: 500 });
  });

  it('un crédito regalado nuevo no cancela deuda', async () => {
    await billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01'] });
    await billing.grantCredits({ tenantId: 't1', amount: 5000, expiresOn: '2026-12-31', actorUserId: 'root' });
    expect(await billing.summary('t1')).toMatchObject({ debt: 1000, giftBalance: 5000 });
  });

  it('otorgar vence al final del día argentino; anular deja el remanente en cero', async () => {
    const id = await billing.grantCredits({ tenantId: 't1', amount: 5000, expiresOn: '2026-12-31', reason: 'Cortesía', actorUserId: 'root' });
    expect(await db.selectFrom('gift_credits').select(['expires_at', 'reason', 'granted_by', 'origin']).where('id', '=', id).executeTakeFirst()).toEqual({
      expires_at: '2027-01-01T03:00:00.000Z',
      reason: 'Cortesía',
      granted_by: 'root',
      origin: 'grant',
    });
    await billing.voidCredit({ tenantId: 't1', creditId: id, reason: 'Error', actorUserId: 'root' });
    expect((await billing.summary('t1')).giftBalance).toBe(0);
    await expect(billing.voidCredit({ tenantId: 't1', creditId: id, reason: 'Otra vez', actorUserId: 'root' })).rejects.toThrow('Crédito no encontrado');
  });

  it('la devolución no puede superar el saldo pagado', async () => {
    await billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 3000, actorUserId: 'root' });
    await expect(billing.refund({ tenantId: 't1', amount: 3001, actorUserId: 'root' })).rejects.toThrow('La devolución supera el saldo pagado');
    await billing.refund({ tenantId: 't1', amount: 3000, info: 'Baja', actorUserId: 'root' });
    expect((await billing.summary('t1')).paidBalance).toBe(0);
  });

  it('el titular nuevo tiene que ser owner activo; el saldo es de la persona y no se mueve', async () => {
    await billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 3000, actorUserId: 'root' });
    await expect(billing.setHolder({ tenantId: 't1', userId: 'nadie' })).rejects.toThrow('El titular tiene que ser un owner activo del comercio');
    await billing.setHolder({ tenantId: 't1', userId: 'u2' });
    expect(await billing.summary('t1')).toMatchObject({ paidBalance: 0, holder: { userId: 'u2', name: 'Beto' } });
    expect(await billing.summary('t2')).toMatchObject({ paidBalance: 3000 });
  });

  it('extender la gracia con una fecha', async () => {
    await billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-09-01'] });
    expect((await billing.summary('t1')).state).toBe('restricted');
    await billing.setGrace({ tenantId: 't1', until: '2026-10-10' });
    expect(await billing.summary('t1')).toMatchObject({ state: 'debt', deadline: '2026-10-10' });
  });

  it('un pago con la misma referencia no se registra dos veces', async () => {
    await billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 100, actorUserId: 'root', paymentRef: 'abc' });
    await expect(billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 100, actorUserId: 'root', paymentRef: 'abc' })).rejects.toThrow(
      'Ese pago ya estaba registrado',
    );
  });

  it('importes inválidos y comercios inexistentes', async () => {
    await expect(billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 0, actorUserId: 'root' })).rejects.toThrow('El importe tiene que ser mayor que 0');
    await expect(billing.grantCredits({ tenantId: 'nada', amount: 10, expiresOn: '2026-12-31', actorUserId: 'root' })).rejects.toThrow('Comercio no encontrado');
  });

  it('la lista de pagos de la plataforma', async () => {
    await billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 100, info: 'op 1', actorUserId: 'u2', paymentRef: 'ref' });
    expect(await billing.listPayments()).toEqual([
      expect.objectContaining({ day: '2026-10-05', amount: 100, info: 'op 1', tenantId: 't1', tenantName: 't1', holderName: 'Ana', createdByName: 'Beto', fromSheet: true }),
    ]);
  });
});
