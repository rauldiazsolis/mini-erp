import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { allocateCharge, type GiftBalance } from './allocation.ts';
import { readBillingSettings } from './settings.ts';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import type { BillingSummary } from '../../shared/credits-types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

type DatedGift = GiftBalance & { expiresAt: string };

/**
 * Cobro (#21), en la base de sistema: cargos por caja (o equipo ajeno) y día, saldo pagado del
 * titular, créditos regalados del comercio, deuda y gracia. Cada escritura va en su transacción.
 */
export class BillingService {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; now: () => Date }) {
    this.db = deps.db;
    this.now = deps.now;
  }

  isBillable(tenantId: string): boolean {
    return this.holderOf(tenantId) !== null;
  }

  /** Crea los cargos que falten, en orden de día. Devuelve cuántos creó. */
  charge(p: { tenantId: string; registerId: string; chargeDevice: string; days: readonly string[] }): number {
    const holder = this.holderOf(p.tenantId);
    if (holder === null) {
      const demo = this.db.prepare('SELECT 1 FROM demo_sessions WHERE tenant_id = ?').get(p.tenantId);
      if (demo === undefined) console.warn(`[cobro] el comercio ${p.tenantId} no tiene titular: no se cobra`);
      return 0;
    }
    let created = 0;
    for (const day of [...new Set(p.days)].sort()) {
      if (this.chargeOne(p.tenantId, holder, p.registerId, p.chargeDevice, day)) created++;
    }
    return created;
  }

  summary(tenantId: string): BillingSummary {
    const settings = readBillingSettings(this.db);
    const holderId = this.holderOf(tenantId);
    const today = argentinaToday(this.now());
    const holder =
      holderId === null
        ? null
        : ((this.db.prepare('SELECT id AS userId, name, email FROM users WHERE id = ?').get(holderId) as
            | { userId: string; name: string; email: string }
            | undefined) ?? null);
    const paidBalance = holderId === null ? 0 : this.paidBalance(holderId);
    const gifts = this.giftBalances(tenantId);
    const giftBalance = gifts.reduce((sum, g) => sum + g.remaining, 0);
    const nextGiftExpiry = gifts[0]?.expiresAt ?? null;
    const debtRow = this.db
      .prepare('SELECT COALESCE(SUM(debt_amount), 0) AS debt, MIN(day) AS oldest FROM charges WHERE tenant_id = ? AND debt_amount > 0')
      .get(tenantId) as { debt: number; oldest: string | null };
    const activeUnits = (
      this.db
        .prepare("SELECT COUNT(DISTINCT register_id || '|' || device_id) AS n FROM charges WHERE tenant_id = ? AND day >= ?")
        .get(tenantId, shiftDay(today, -6)) as { n: number }
    ).n;
    const dailyBurn = settings.pricePerRegisterDay * Math.max(1, activeUnits);
    const base = { billable: holderId !== null, holder, paidBalance, giftBalance, nextGiftExpiry, debt: debtRow.debt, dailyBurn };

    if (holderId === null) {
      return { ...base, state: 'ok', deadline: null, daysCovered: null };
    }
    if (debtRow.debt > 0 && debtRow.oldest !== null) {
      const graceUntil = (this.db.prepare('SELECT grace_until FROM tenants WHERE id = ?').get(tenantId) as { grace_until: string | null })
        .grace_until;
      const byRule = shiftDay(debtRow.oldest, settings.graceDays);
      const deadline = graceUntil !== null && graceUntil > byRule ? graceUntil : byRule;
      return { ...base, state: today > deadline ? 'restricted' : 'debt', deadline, daysCovered: 0 };
    }
    const daysCovered = Math.floor((paidBalance + giftBalance) / dailyBurn);
    return { ...base, state: daysCovered < settings.lowBalanceDays ? 'low' : 'ok', deadline: null, daysCovered };
  }

  /** El bono de alta del comercio, con el importe y el vencimiento de la configuración. */
  grantSignupBonus(tenantId: string, actorUserId: string | null): string {
    const settings = readBillingSettings(this.db);
    const at = this.now();
    const id = `gift_${randomUUID()}`;
    this.db
      .prepare(
        "INSERT INTO gift_credits (id, tenant_id, amount, expires_at, origin, granted_by, reason, created_at) VALUES (?, ?, ?, ?, 'signup', ?, 'Bono de alta', ?)",
      )
      .run(id, tenantId, settings.signupBonus, new Date(at.getTime() + settings.signupBonusDays * DAY_MS).toISOString(), actorUserId, at.toISOString());
    return id;
  }

  // --- internos ---

  private holderOf(tenantId: string): string | null {
    const row = this.db.prepare('SELECT holder_user_id FROM tenants WHERE id = ?').get(tenantId) as
      | { holder_user_id: string | null }
      | undefined;
    return row?.holder_user_id ?? null;
  }

  private paidBalance(userId: string): number {
    return (this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM paid_movements WHERE user_id = ?').get(userId) as { balance: number })
      .balance;
  }

  /** Regalados vigentes con remanente, por vencimiento más próximo. */
  private giftBalances(tenantId: string): DatedGift[] {
    const rows = this.db
      .prepare(
        `SELECT g.id, g.expires_at, g.amount - COALESCE((SELECT SUM(c.amount) FROM gift_consumptions c WHERE c.credit_id = g.id), 0) AS remaining
         FROM gift_credits g
         WHERE g.tenant_id = ? AND g.voided_at IS NULL AND g.expires_at > ?
         ORDER BY g.expires_at, g.created_at, g.id`,
      )
      .all(tenantId, this.now().toISOString()) as { id: string; expires_at: string; remaining: number }[];
    return rows.filter((r) => r.remaining > 0).map((r) => ({ creditId: r.id, remaining: r.remaining, expiresAt: r.expires_at }));
  }

  private chargeOne(tenantId: string, holder: string, registerId: string, device: string, day: string): boolean {
    this.db.exec('BEGIN');
    try {
      const exists = this.db.prepare('SELECT 1 FROM charges WHERE register_id = ? AND device_id = ? AND day = ?').get(registerId, device, day);
      if (exists !== undefined) {
        this.db.exec('COMMIT');
        return false;
      }
      const settings = readBillingSettings(this.db);
      const allocation = allocateCharge({
        price: settings.pricePerRegisterDay,
        paidShare: settings.paidShare,
        paidBalance: this.paidBalance(holder),
        gifts: this.giftBalances(tenantId),
      });
      const id = `chg_${randomUUID()}`;
      const at = this.now().toISOString();
      const giftAmount = allocation.gifts.reduce((sum, g) => sum + g.amount, 0);
      this.db
        .prepare(
          `INSERT INTO charges (id, tenant_id, register_id, device_id, day, amount, paid_amount, gift_amount, debt_amount, rule, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          tenantId,
          registerId,
          device,
          day,
          settings.pricePerRegisterDay,
          allocation.paid,
          giftAmount,
          allocation.debt,
          JSON.stringify({ price: settings.pricePerRegisterDay, paidShare: settings.paidShare }),
          at,
        );
      const consume = this.db.prepare('INSERT INTO gift_consumptions (charge_id, credit_id, amount) VALUES (?, ?, ?)');
      for (const g of allocation.gifts) consume.run(id, g.creditId, g.amount);
      if (allocation.paid > 0) {
        this.db
          .prepare("INSERT INTO paid_movements (id, user_id, kind, amount, tenant_id, charge_id, day, created_at) VALUES (?, ?, 'charge', ?, ?, ?, ?, ?)")
          .run(`pm_${randomUUID()}`, holder, -allocation.paid, tenantId, id, day, at);
      }
      this.db.exec('COMMIT');
      return true;
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
