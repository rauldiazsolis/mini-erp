import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { BillingService } from '../src/server/billing/billing-service.ts';

describe('pagos, créditos, gracia, devoluciones y titular (#21)', () => {
  let db: DatabaseSync;
  let now: Date;
  let billing: BillingService;

  const gift = (tenantId: string, amount: number, expiresAt: string) =>
    db
      .prepare("INSERT INTO gift_credits (id, tenant_id, amount, expires_at, origin, created_at) VALUES (?, ?, ?, ?, 'grant', '2026-10-01T00:00:00.000Z')")
      .run(`g-${tenantId}-${String(amount)}`, tenantId, amount, expiresAt);

  beforeEach(() => {
    db = openSystemDb(':memory:');
    const user = db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES (?, ?, 'h', ?, 'user', '2026-10-01T00:00:00.000Z')");
    user.run('u1', 'u1@x.com', 'Ana');
    user.run('u2', 'u2@x.com', 'Beto');
    for (const t of ['t1', 't2']) {
      db.prepare("INSERT INTO tenants (id, slug, name, created_at, holder_user_id) VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', 'u1')").run(t, t, t);
    }
    const member = db.prepare("INSERT INTO memberships (user_id, tenant_id, role, status, created_at) VALUES (?, 't1', ?, ?, '2026-10-01T00:00:00.000Z')");
    member.run('u1', 'owner', 'active');
    member.run('u2', 'owner', 'active');
    now = new Date('2026-10-05T15:00:00.000Z');
    billing = new BillingService({ db, now: () => now });
  });

  it('un pago cancela primero la deuda, del cargo más antiguo, y el resto queda de saldo', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01', '2026-10-02'] });
    billing.charge({ tenantId: 't2', registerId: 'r2', chargeDevice: '', days: ['2026-10-03'] });
    const res = billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 2500, actorUserId: 'root' });
    expect(res.settled).toBe(2500);
    expect(db.prepare('SELECT day, debt_amount, paid_amount, debt_settled_at IS NOT NULL AS settled FROM charges ORDER BY day').all()).toEqual([
      { day: '2026-10-01', debt_amount: 0, paid_amount: 1000, settled: 1 },
      { day: '2026-10-02', debt_amount: 0, paid_amount: 1000, settled: 1 },
      { day: '2026-10-03', debt_amount: 500, paid_amount: 500, settled: 0 },
    ]);
    expect(billing.summary('t1')).toMatchObject({ debt: 0, paidBalance: 0, state: 'low' });
    expect(billing.summary('t2')).toMatchObject({ debt: 500 });
  });

  it('un pago más grande que la deuda deja el resto de saldo', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01'] });
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 5000, info: 'Transf. 1', actorUserId: 'root' });
    expect(billing.summary('t1')).toMatchObject({ debt: 0, paidBalance: 4000 });
  });

  it('después de un pago, los cargos siguientes se reparten según la proporción', () => {
    gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 10000, actorUserId: 'root' });
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    expect(db.prepare('SELECT paid_amount, gift_amount FROM charges').get()).toEqual({ paid_amount: 500, gift_amount: 500 });
  });

  it('un crédito regalado nuevo no cancela deuda', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01'] });
    billing.grantCredits({ tenantId: 't1', amount: 5000, expiresOn: '2026-12-31', actorUserId: 'root' });
    expect(billing.summary('t1')).toMatchObject({ debt: 1000, giftBalance: 5000 });
  });

  it('otorgar vence al final del día argentino; anular deja el remanente en cero', () => {
    const id = billing.grantCredits({ tenantId: 't1', amount: 5000, expiresOn: '2026-12-31', reason: 'Cortesía', actorUserId: 'root' });
    expect(db.prepare('SELECT expires_at, reason, granted_by, origin FROM gift_credits WHERE id = ?').get(id)).toEqual({
      expires_at: '2027-01-01T03:00:00.000Z',
      reason: 'Cortesía',
      granted_by: 'root',
      origin: 'grant',
    });
    billing.voidCredit({ tenantId: 't1', creditId: id, reason: 'Error', actorUserId: 'root' });
    expect(billing.summary('t1').giftBalance).toBe(0);
    expect(() => { billing.voidCredit({ tenantId: 't1', creditId: id, reason: 'Otra vez', actorUserId: 'root' }); }).toThrow('Crédito no encontrado');
  });

  it('la devolución no puede superar el saldo pagado', () => {
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 3000, actorUserId: 'root' });
    expect(() => billing.refund({ tenantId: 't1', amount: 3001, actorUserId: 'root' })).toThrow('La devolución supera el saldo pagado');
    billing.refund({ tenantId: 't1', amount: 3000, info: 'Baja', actorUserId: 'root' });
    expect(billing.summary('t1').paidBalance).toBe(0);
  });

  it('el titular nuevo tiene que ser owner activo; el saldo es de la persona y no se mueve', () => {
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 3000, actorUserId: 'root' });
    expect(() => { billing.setHolder({ tenantId: 't1', userId: 'nadie' }); }).toThrow('El titular tiene que ser un owner activo del comercio');
    billing.setHolder({ tenantId: 't1', userId: 'u2' });
    expect(billing.summary('t1')).toMatchObject({ paidBalance: 0, holder: { userId: 'u2', name: 'Beto' } });
    expect(billing.summary('t2')).toMatchObject({ paidBalance: 3000 });
  });

  it('extender la gracia con una fecha', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-09-01'] });
    expect(billing.summary('t1').state).toBe('restricted');
    billing.setGrace({ tenantId: 't1', until: '2026-10-10' });
    expect(billing.summary('t1')).toMatchObject({ state: 'debt', deadline: '2026-10-10' });
  });

  it('un pago con la misma referencia no se registra dos veces', () => {
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 100, actorUserId: 'root', paymentRef: 'abc' });
    expect(() => billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 100, actorUserId: 'root', paymentRef: 'abc' })).toThrow(
      'Ese pago ya estaba registrado',
    );
  });

  it('importes inválidos y comercios inexistentes', () => {
    expect(() => billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 0, actorUserId: 'root' })).toThrow('El importe tiene que ser mayor que 0');
    expect(() => billing.grantCredits({ tenantId: 'nada', amount: 10, expiresOn: '2026-12-31', actorUserId: 'root' })).toThrow('Comercio no encontrado');
  });

  it('la lista de pagos de la plataforma', () => {
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 100, info: 'op 1', actorUserId: 'u2', paymentRef: 'ref' });
    expect(billing.listPayments()).toEqual([
      expect.objectContaining({ day: '2026-10-05', amount: 100, info: 'op 1', tenantId: 't1', tenantName: 't1', holderName: 'Ana', createdByName: 'Beto', fromSheet: true }),
    ]);
  });
});
