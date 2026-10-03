import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { BillingService } from '../src/server/billing/billing-service.ts';
import { readBillingSettings, writeBillingSettings, DEFAULT_BILLING_SETTINGS } from '../src/server/billing/settings.ts';

describe('cargos y estado de cobro (#21)', () => {
  let db: DatabaseSync;
  let now: Date;
  let billing: BillingService;
  let seq = 0;

  const gift = (tenantId: string, amount: number, expiresAt: string, id = `g-${String(++seq)}`) =>
    db
      .prepare("INSERT INTO gift_credits (id, tenant_id, amount, expires_at, origin, created_at) VALUES (?, ?, ?, ?, 'grant', '2026-10-01T00:00:00.000Z')")
      .run(id, tenantId, amount, expiresAt);
  const paid = (userId: string, amount: number) =>
    db
      .prepare("INSERT INTO paid_movements (id, user_id, kind, amount, day, created_at) VALUES (?, ?, 'payment', ?, '2026-10-01', '2026-10-01T00:00:00.000Z')")
      .run(`pm-${String(++seq)}`, userId, amount);
  const charges = () =>
    db
      .prepare('SELECT tenant_id, register_id, device_id, day, amount, paid_amount, gift_amount, debt_amount, rule FROM charges ORDER BY day, register_id, device_id')
      .all();

  beforeEach(() => {
    db = openSystemDb(':memory:');
    db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES ('u1', 'u1@x.com', 'h', 'Ana', 'user', '2026-10-01T00:00:00.000Z')").run();
    for (const t of ['t1', 't2']) {
      db.prepare("INSERT INTO tenants (id, slug, name, created_at, holder_user_id) VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', 'u1')").run(t, t, t);
    }
    db.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES ('demo', 'demo', 'Demo', '2026-10-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES ('demo', 'kiosco', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')").run();
    now = new Date('2026-10-05T15:00:00.000Z');
    billing = new BillingService({ db, now: () => now });
  });

  it('un cargo por caja y día; repetir no cobra dos veces', () => {
    gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    expect(billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-04', '2026-10-05'] })).toBe(2);
    expect(billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] })).toBe(0);
    billing.charge({ tenantId: 't1', registerId: 'r2', chargeDevice: '', days: ['2026-10-05'] });
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: 'dev-b', days: ['2026-10-05'] });
    expect(charges()).toHaveLength(4);
  });

  it('guarda el reparto y la regla; consume regalados por vencimiento', () => {
    gift('t1', 300, '2026-11-01T00:00:00.000Z', 'g-pronto');
    gift('t1', 50000, '2027-01-01T00:00:00.000Z', 'g-tarde');
    paid('u1', 5000);
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    expect(charges()).toEqual([
      expect.objectContaining({ day: '2026-10-05', amount: 1000, paid_amount: 500, gift_amount: 500, debt_amount: 0, rule: JSON.stringify({ price: 1000, paidShare: 0.5 }) }),
    ]);
    expect(db.prepare('SELECT credit_id, amount FROM gift_consumptions ORDER BY credit_id').all()).toEqual([
      { credit_id: 'g-pronto', amount: 300 },
      { credit_id: 'g-tarde', amount: 200 },
    ]);
    expect(db.prepare("SELECT amount, kind, tenant_id FROM paid_movements WHERE kind = 'charge'").all()).toEqual([
      { amount: -500, kind: 'charge', tenant_id: 't1' },
    ]);
  });

  it('un regalado vencido o anulado no cuenta', () => {
    gift('t1', 5000, '2026-10-05T14:00:00.000Z', 'g-vencido');
    gift('t1', 5000, '2027-01-01T00:00:00.000Z', 'g-anulado');
    db.prepare("UPDATE gift_credits SET voided_at = '2026-10-02T00:00:00.000Z' WHERE id = 'g-anulado'").run();
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    expect(charges()[0]).toMatchObject({ debt_amount: 1000 });
  });

  it('cambiar el precio no reescribe los cargos hechos', () => {
    gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-04'] });
    writeBillingSettings(db, { pricePerRegisterDay: 1500 }, 'root', now.toISOString());
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    expect(charges().map((c) => (c as { amount: number }).amount)).toEqual([1000, 1500]);
  });

  it('una demo o un comercio sin titular no cobra', () => {
    expect(billing.charge({ tenantId: 'demo', registerId: 'r9', chargeDevice: '', days: ['2026-10-05'] })).toBe(0);
    expect(billing.isBillable('demo')).toBe(false);
    expect(billing.summary('demo')).toMatchObject({ billable: false, state: 'ok' });
  });

  it('estado ok con saldo de sobra; low si cubre menos de 7 días', () => {
    gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    expect(billing.summary('t1')).toMatchObject({ state: 'ok', giftBalance: 50000, paidBalance: 0, debt: 0, daysCovered: 50, dailyBurn: 1000 });
    db.prepare('UPDATE gift_credits SET amount = 6000').run();
    expect(billing.summary('t1')).toMatchObject({ state: 'low', daysCovered: 6 });
  });

  it('el consumo diario cuenta las cajas y equipos con cargos en los últimos 7 días', () => {
    gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    billing.charge({ tenantId: 't1', registerId: 'r2', chargeDevice: '', days: ['2026-10-04'] });
    billing.charge({ tenantId: 't1', registerId: 'r3', chargeDevice: '', days: ['2026-09-28'] });
    expect(billing.summary('t1')).toMatchObject({ dailyBurn: 2000, daysCovered: 23 });
  });

  it('deuda: fecha límite a 10 días del cargo más antiguo en deuda; restringido al pasarla', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-03'] });
    expect(billing.summary('t1')).toMatchObject({ state: 'debt', debt: 1000, deadline: '2026-10-13' });
    now = new Date('2026-10-14T02:59:00.000Z'); // 13/10 23:59 en Argentina
    expect(billing.summary('t1').state).toBe('debt');
    now = new Date('2026-10-14T03:00:00.000Z'); // 14/10 00:00 en Argentina
    expect(billing.summary('t1')).toMatchObject({ state: 'restricted' });
  });

  it('grace_until posterior extiende la fecha límite; anterior no la acorta', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-03'] });
    db.prepare("UPDATE tenants SET grace_until = '2026-10-20' WHERE id = 't1'").run();
    now = new Date('2026-10-15T12:00:00.000Z');
    expect(billing.summary('t1')).toMatchObject({ state: 'debt', deadline: '2026-10-20' });
    db.prepare("UPDATE tenants SET grace_until = '2026-10-05' WHERE id = 't1'").run();
    expect(billing.summary('t1')).toMatchObject({ deadline: '2026-10-13' });
  });

  it('el pagado es del titular: lo comparten sus comercios; la deuda de uno no restringe al otro', () => {
    paid('u1', 1500);
    gift('t2', 50000, '2027-01-01T00:00:00.000Z');
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01', '2026-10-02'] });
    expect(billing.summary('t1')).toMatchObject({ paidBalance: 0, debt: 500 });
    expect(billing.summary('t2')).toMatchObject({ paidBalance: 0, state: 'ok' });
  });

  it('el bono de alta usa la configuración', () => {
    const id = billing.grantSignupBonus('t1', 'u1');
    expect(db.prepare('SELECT amount, origin, expires_at, granted_by FROM gift_credits WHERE id = ?').get(id)).toEqual({
      amount: 50000,
      origin: 'signup',
      expires_at: '2027-01-03T15:00:00.000Z',
      granted_by: 'u1',
    });
  });

  it('la configuración: valores por defecto, cambios guardados y un valor guardado inválido se ignora', () => {
    expect(readBillingSettings(db)).toEqual(DEFAULT_BILLING_SETTINGS);
    writeBillingSettings(db, { paidShare: 0.7, paymentAlias: 'mini.contax' }, 'root', now.toISOString());
    expect(readBillingSettings(db)).toMatchObject({ paidShare: 0.7, paymentAlias: 'mini.contax' });
    db.prepare("UPDATE billing_settings SET value = '-3' WHERE key = 'paidShare'").run();
    expect(readBillingSettings(db).paidShare).toBe(0.5);
  });
});
