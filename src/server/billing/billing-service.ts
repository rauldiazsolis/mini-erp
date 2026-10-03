import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { allocateCharge, type GiftBalance } from './allocation.ts';
import { readBillingSettings, writeBillingSettings, type BillingSettingsPatch } from './settings.ts';
import { DomainError } from '../errors.ts';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import type { BillingSettings, BillingSummary, PlatformPaymentItem } from '../../shared/credits-types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function requirePositive(amount: number): void {
  if (!(amount > 0)) throw new DomainError(400, 'El importe tiene que ser mayor que 0');
}

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

  // --- plataforma ---

  /** Un pago al titular del comercio: cancela primero la deuda de sus comercios, del cargo más antiguo; el resto queda de saldo. */
  registerPayment(p: {
    tenantId: string;
    day: string;
    amount: number;
    info?: string | undefined;
    actorUserId: string;
    paymentRef?: string | undefined;
  }): { movementId: string; settled: number } {
    const holder = this.requireHolder(p.tenantId);
    requirePositive(p.amount);
    if (p.paymentRef !== undefined && this.db.prepare('SELECT 1 FROM paid_movements WHERE payment_ref = ?').get(p.paymentRef) !== undefined) {
      throw new DomainError(409, 'Ese pago ya estaba registrado');
    }
    const at = this.now().toISOString();
    const movementId = `pm_${randomUUID()}`;
    let settled = 0;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          "INSERT INTO paid_movements (id, user_id, kind, amount, tenant_id, payment_ref, day, info, created_by, created_at) VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(movementId, holder, p.amount, p.tenantId, p.paymentRef ?? null, p.day, p.info ?? null, p.actorUserId, at);
      const debts = this.db
        .prepare(
          `SELECT c.id, c.tenant_id, c.day, c.debt_amount FROM charges c JOIN tenants t ON t.id = c.tenant_id
           WHERE t.holder_user_id = ? AND c.debt_amount > 0 ORDER BY c.day, c.created_at, c.id`,
        )
        .all(holder) as { id: string; tenant_id: string; day: string; debt_amount: number }[];
      let left = p.amount;
      for (const debt of debts) {
        if (left <= 0) break;
        const x = Math.min(left, debt.debt_amount);
        this.db
          .prepare(
            `UPDATE charges SET debt_amount = debt_amount - ?, paid_amount = paid_amount + ?,
               debt_settled_at = CASE WHEN debt_amount - ? <= 0 THEN ? ELSE NULL END
             WHERE id = ?`,
          )
          .run(x, x, x, at, debt.id);
        this.db
          .prepare(
            "INSERT INTO paid_movements (id, user_id, kind, amount, tenant_id, charge_id, day, created_by, created_at) VALUES (?, ?, 'debt-settlement', ?, ?, ?, ?, ?, ?)",
          )
          .run(`pm_${randomUUID()}`, holder, -x, debt.tenant_id, debt.id, debt.day, p.actorUserId, at);
        left -= x;
        settled += x;
      }
      this.db.exec('COMMIT');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { movementId, settled };
  }

  /** Créditos regalados por root o soporte: vencen al terminar el día argentino `expiresOn`. */
  grantCredits(p: { tenantId: string; amount: number; expiresOn: string; reason?: string | undefined; actorUserId: string }): string {
    this.requireTenant(p.tenantId);
    requirePositive(p.amount);
    const id = `gift_${randomUUID()}`;
    const expiresAt = `${shiftDay(p.expiresOn, 1)}T03:00:00.000Z`;
    this.db
      .prepare("INSERT INTO gift_credits (id, tenant_id, amount, expires_at, origin, granted_by, reason, created_at) VALUES (?, ?, ?, ?, 'grant', ?, ?, ?)")
      .run(id, p.tenantId, p.amount, expiresAt, p.actorUserId, p.reason ?? null, this.now().toISOString());
    return id;
  }

  /** Anula el remanente de un crédito regalado (lo consumido queda como está). */
  voidCredit(p: { tenantId: string; creditId: string; reason: string; actorUserId: string }): void {
    const res = this.db
      .prepare('UPDATE gift_credits SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND tenant_id = ? AND voided_at IS NULL')
      .run(this.now().toISOString(), p.actorUserId, p.reason, p.creditId, p.tenantId);
    if (res.changes === 0) throw new DomainError(404, 'Crédito no encontrado');
  }

  setGrace(p: { tenantId: string; until: string }): void {
    this.requireTenant(p.tenantId);
    this.db.prepare('UPDATE tenants SET grace_until = ? WHERE id = ?').run(p.until, p.tenantId);
  }

  /** Devolución del saldo pagado del titular (solo root): nunca más que el saldo. */
  refund(p: { tenantId: string; amount: number; info?: string | undefined; actorUserId: string }): string {
    const holder = this.requireHolder(p.tenantId);
    requirePositive(p.amount);
    if (p.amount > this.paidBalance(holder)) throw new DomainError(400, 'La devolución supera el saldo pagado');
    const id = `pm_${randomUUID()}`;
    const at = this.now();
    this.db
      .prepare("INSERT INTO paid_movements (id, user_id, kind, amount, tenant_id, day, info, created_by, created_at) VALUES (?, ?, 'refund', ?, ?, ?, ?, ?, ?)")
      .run(id, holder, -p.amount, p.tenantId, argentinaToday(at), p.info ?? null, p.actorUserId, at.toISOString());
    return id;
  }

  /** Cambia el titular: tiene que ser un owner activo. El saldo pagado es de la persona y no se mueve. */
  setHolder(p: { tenantId: string; userId: string }): void {
    this.requireTenant(p.tenantId);
    const owner = this.db
      .prepare("SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ? AND role = 'owner' AND status = 'active'")
      .get(p.tenantId, p.userId);
    if (owner === undefined) throw new DomainError(400, 'El titular tiene que ser un owner activo del comercio');
    this.db.prepare('UPDATE tenants SET holder_user_id = ? WHERE id = ?').run(p.userId, p.tenantId);
  }

  settings(): BillingSettings {
    return readBillingSettings(this.db);
  }

  updateSettings(patch: BillingSettingsPatch, actorUserId: string): BillingSettings {
    return writeBillingSettings(this.db, patch, actorUserId, this.now().toISOString());
  }

  /** Un comercio por su identificador, para la planilla; `demo` si es una demo. */
  findTenantBySlug(slug: string): { id: string; name: string; demo: boolean } | undefined {
    const row = this.db
      .prepare('SELECT id, name, id IN (SELECT tenant_id FROM demo_sessions) AS demo FROM tenants WHERE slug = ?')
      .get(slug) as { id: string; name: string; demo: number } | undefined;
    return row === undefined ? undefined : { id: row.id, name: row.name, demo: row.demo === 1 };
  }

  paymentRefExists(ref: string): boolean {
    return this.db.prepare('SELECT 1 FROM paid_movements WHERE payment_ref = ?').get(ref) !== undefined;
  }

  /** Los pagos registrados, del más nuevo al más viejo. */
  listPayments(limit = 200): PlatformPaymentItem[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.day, p.amount, p.info, p.tenant_id, t.name AS tenant_name, h.name AS holder_name,
                c.name AS created_by_name, p.created_at, p.payment_ref
         FROM paid_movements p
         JOIN users h ON h.id = p.user_id
         LEFT JOIN tenants t ON t.id = p.tenant_id
         LEFT JOIN users c ON c.id = p.created_by
         WHERE p.kind = 'payment'
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ?`,
      )
      .all(limit) as {
      id: string;
      day: string;
      amount: number;
      info: string | null;
      tenant_id: string | null;
      tenant_name: string | null;
      holder_name: string;
      created_by_name: string | null;
      created_at: string;
      payment_ref: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      day: r.day,
      amount: r.amount,
      info: r.info,
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      holderName: r.holder_name,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      fromSheet: r.payment_ref !== null,
    }));
  }

  // --- internos ---

  private requireTenant(tenantId: string): void {
    const row = this.db.prepare('SELECT 1 FROM tenants WHERE id = ? AND id NOT IN (SELECT tenant_id FROM demo_sessions)').get(tenantId);
    if (row === undefined) throw new DomainError(404, 'Comercio no encontrado');
  }

  private requireHolder(tenantId: string): string {
    this.requireTenant(tenantId);
    const holder = this.holderOf(tenantId);
    if (holder === null) throw new DomainError(400, 'El comercio no tiene titular');
    return holder;
  }

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
