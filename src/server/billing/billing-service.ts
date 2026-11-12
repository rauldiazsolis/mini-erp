import { randomUUID } from 'node:crypto';
import { sql, type ExpressionBuilder, type Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { allocateCharge, type GiftBalance } from './allocation.ts';
import { readBillingSettings, writeBillingSettings, type BillingSettingsPatch } from './settings.ts';
import type { BillingLegacyBridge } from './legacy-bridge.ts';
import { DomainError } from '../errors.ts';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import type {
  BillingSettings,
  BillingSummary,
  ChargesPage,
  CreditMovementItem,
  GiftItem,
  PaymentInfo,
  PlatformPaymentItem,
} from '../../shared/credits-types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

type Db = Kysely<SystemDatabase>;

function requirePositive(amount: number): void {
  if (!(amount > 0)) throw new DomainError(400, 'El importe tiene que ser mayor que 0');
}

/** Una suma de importes con centavos, sin el ruido de la coma flotante (`1000.15 - 1000`). */
function sumCents(a: number, b: number): number {
  return Math.round((a + b) * 100) / 100;
}

type DatedGift = GiftBalance & { expiresAt: string };

type GiftScope = ExpressionBuilder<SystemDatabase & { g: SystemDatabase['gift_credits'] }, 'g'>;

/** El remanente de un crédito regalado `g`: su importe menos lo consumido (subconsulta correlacionada). */
function remainingOf(eb: GiftScope) {
  const consumed = eb
    .selectFrom('gift_consumptions as gc')
    .select((sub) => sub.fn.coalesce(sub.fn.sum<number>('gc.amount'), sql.lit(0)).as('consumed'))
    .whereRef('gc.credit_id', '=', 'g.id');
  return eb('g.amount', '-', consumed);
}

/**
 * Cobro (#21), en PostgreSQL (esquema `system`): cargos por caja (o equipo ajeno) y día, saldo pagado
 * del titular, créditos regalados del comercio, deuda y gracia. Cada escritura va en su transacción;
 * las que tocan el saldo de un titular lo bloquean primero (`lockHolder`), así dos cargos o un cargo
 * y un pago a la vez no gastan dos veces el mismo saldo.
 */
export class BillingService {
  private db: Db;
  private now: () => Date;
  private legacy: BillingLegacyBridge;

  constructor(deps: { db: Db; now: () => Date; legacy: BillingLegacyBridge }) {
    this.db = deps.db;
    this.now = deps.now;
    this.legacy = deps.legacy;
  }

  /** Los comercios con titular (los que se cobran), para el barrido. */
  async billableTenantIds(): Promise<string[]> {
    const rows = await this.db.selectFrom('tenants').select('id').where('holder_user_id', 'is not', null).orderBy('seq').execute();
    return rows.map((r) => r.id);
  }

  async isBillable(tenantId: string): Promise<boolean> {
    return (await this.holderOf(tenantId)) !== null;
  }

  /** Crea los cargos que falten, en orden de día. Devuelve cuántos creó. */
  async charge(p: { tenantId: string; registerId: string; chargeDevice: string; days: readonly string[] }): Promise<number> {
    const holder = await this.holderOf(p.tenantId);
    if (holder === null) {
      if (!(await this.legacy.isDemoTenant(p.tenantId))) console.warn(`[cobro] el comercio ${p.tenantId} no tiene titular: no se cobra`);
      return 0;
    }
    // Los días con el comercio suspendido no se cobran (#23)
    const skip = await this.legacy.suspendedDays(p.tenantId, p.days);
    let created = 0;
    for (const day of [...new Set(p.days)].filter((d) => !skip.has(d)).sort()) {
      if (await this.chargeOne(p.tenantId, holder, p.registerId, p.chargeDevice, day)) created++;
    }
    return created;
  }

  async summary(tenantId: string): Promise<BillingSummary> {
    const settings = await readBillingSettings(this.db);
    const tenant = await this.db.selectFrom('tenants').select(['holder_user_id', 'grace_until']).where('id', '=', tenantId).executeTakeFirst();
    const holderId = tenant?.holder_user_id ?? null;
    const today = argentinaToday(this.now());
    const holder =
      holderId === null
        ? null
        : ((await this.db.selectFrom('users').select(['id as userId', 'name', 'email']).where('id', '=', holderId).executeTakeFirst()) ?? null);
    const paidBalance = holderId === null ? 0 : await this.paidBalance(holderId);
    const gifts = await this.giftBalances(tenantId);
    const giftBalance = gifts.reduce((sum, g) => sum + g.remaining, 0);
    const nextGiftExpiry = gifts[0]?.expiresAt ?? null;
    const debtRow = await this.db
      .selectFrom('charges')
      .select((eb) => [eb.fn.coalesce(eb.fn.sum<number>('debt_amount'), sql.lit(0)).as('debt'), eb.fn.min<string | null>('day').as('oldest')])
      .where('tenant_id', '=', tenantId)
      .where('debt_amount', '>', 0)
      .executeTakeFirstOrThrow();
    const activeUnits = await this.db
      .selectFrom('charges')
      .select(sql<number>`count(DISTINCT (${sql.ref('register_id')}, ${sql.ref('device_id')}))`.as('n'))
      .where('tenant_id', '=', tenantId)
      .where('day', '>=', shiftDay(today, -6))
      .executeTakeFirstOrThrow();
    const dailyBurn = settings.pricePerRegisterDay * Math.max(1, activeUnits.n);
    const base = { billable: holderId !== null, holder, paidBalance, giftBalance, nextGiftExpiry, debt: debtRow.debt, dailyBurn };

    if (holderId === null) {
      return { ...base, state: 'ok', deadline: null, daysCovered: null };
    }
    if (debtRow.debt > 0 && debtRow.oldest !== null) {
      const graceUntil = tenant?.grace_until ?? null;
      const byRule = shiftDay(debtRow.oldest, settings.graceDays);
      const deadline = graceUntil !== null && graceUntil > byRule ? graceUntil : byRule;
      return { ...base, state: today > deadline ? 'restricted' : 'debt', deadline, daysCovered: 0 };
    }
    const daysCovered = Math.floor((paidBalance + giftBalance) / dailyBurn);
    return { ...base, state: daysCovered < settings.lowBalanceDays ? 'low' : 'ok', deadline: null, daysCovered };
  }

  /** El bono de alta del comercio, con el importe y el vencimiento de la configuración. */
  async grantSignupBonus(tenantId: string, actorUserId: string | null, db: Db = this.db): Promise<string> {
    const settings = await readBillingSettings(db);
    const at = this.now();
    const id = `gift_${randomUUID()}`;
    await db
      .insertInto('gift_credits')
      .values({
        id,
        tenant_id: tenantId,
        amount: settings.signupBonus,
        expires_at: new Date(at.getTime() + settings.signupBonusDays * DAY_MS).toISOString(),
        origin: 'signup',
        granted_by: actorUserId,
        reason: 'Bono de alta',
        created_at: at.toISOString(),
      })
      .execute();
    return id;
  }

  // --- consultas de la pantalla Créditos ---

  /** Los cargos del comercio en el rango (días argentinos), del más nuevo al más viejo, con el total del filtro. */
  async listCharges(tenantId: string, q: { from?: string | undefined; to?: string | undefined; page: number; pageSize: number }): Promise<ChargesPage> {
    let filtered = this.db.selectFrom('charges as c').where('c.tenant_id', '=', tenantId);
    if (q.from !== undefined) filtered = filtered.where('c.day', '>=', q.from);
    if (q.to !== undefined) filtered = filtered.where('c.day', '<=', q.to);
    const totals = await filtered
      .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.coalesce(eb.fn.sum<number>('c.amount'), sql.lit(0)).as('total')])
      .executeTakeFirstOrThrow();
    const rows = await filtered
      .leftJoin('registers as r', 'r.id', 'c.register_id')
      .select((eb) => [
        'c.id',
        'c.day',
        'c.register_id',
        eb.fn.coalesce('r.name', sql.lit('Caja borrada')).as('register_name'),
        'c.device_id',
        'c.amount',
        'c.paid_amount',
        'c.gift_amount',
        'c.debt_amount',
        'c.created_at',
      ])
      .orderBy('c.day', 'desc')
      .orderBy('register_name')
      .orderBy('c.device_id')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        day: r.day,
        registerId: r.register_id,
        registerName: r.register_name,
        deviceId: r.device_id === '' ? null : r.device_id,
        amount: r.amount,
        paidAmount: r.paid_amount,
        giftAmount: r.gift_amount,
        debtAmount: r.debt_amount,
        createdAt: r.created_at,
      })),
      count: totals.n,
      page: q.page,
      pageSize: q.pageSize,
      total: totals.total,
    };
  }

  /** Pagos, devoluciones, deuda cancelada y créditos otorgados o anulados del comercio, lo más nuevo primero. */
  async listMovements(tenantId: string): Promise<CreditMovementItem[]> {
    // El día de un crédito es el de su instante en UTC, como cuando era `substr(created_at, 1, 10)`
    const utcDay = (column: 'g.created_at' | 'g.voided_at') => sql<string>`(${sql.ref(column)} AT TIME ZONE 'UTC')::date`;
    const paid = this.db
      .selectFrom('paid_movements as p')
      .leftJoin('users as u', 'u.id', 'p.created_by')
      .select([
        'p.id',
        sql<CreditMovementItem['kind']>`${sql.ref('p.kind')}`.as('kind'),
        'p.day',
        'p.amount',
        'p.info',
        'u.name as byName',
        sql<string>`${sql.ref('p.created_at')}`.as('createdAt'),
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('p.kind', 'in', ['payment', 'refund', 'debt-settlement']);
    const granted = this.db
      .selectFrom('gift_credits as g')
      .leftJoin('users as u', 'u.id', 'g.granted_by')
      .select([
        'g.id',
        sql<CreditMovementItem['kind']>`'gift-granted'`.as('kind'),
        utcDay('g.created_at').as('day'),
        'g.amount',
        'g.reason as info',
        'u.name as byName',
        sql<string>`${sql.ref('g.created_at')}`.as('createdAt'),
      ])
      .where('g.tenant_id', '=', tenantId);
    const voided = this.db
      .selectFrom('gift_credits as g')
      .leftJoin('users as u', 'u.id', 'g.voided_by')
      .select([
        sql<string>`${sql.ref('g.id')} || ':void'`.as('id'),
        sql<CreditMovementItem['kind']>`'gift-voided'`.as('kind'),
        utcDay('g.voided_at').as('day'),
        sql<number>`0::numeric`.as('amount'),
        'g.void_reason as info',
        'u.name as byName',
        sql<string>`${sql.ref('g.voided_at')}`.as('createdAt'),
      ])
      .where('g.tenant_id', '=', tenantId)
      .where('g.voided_at', 'is not', null);
    return await this.db
      .selectFrom(paid.unionAll(granted).unionAll(voided).as('m'))
      .select(['m.id', 'm.kind', 'm.day', 'm.amount', 'm.info', 'm.byName', 'm.createdAt'])
      .orderBy('m.createdAt', 'desc')
      .orderBy('m.id', 'desc')
      .limit(500)
      .execute();
  }

  /** Los créditos regalados del comercio con su remanente y estado. */
  async listGifts(tenantId: string): Promise<GiftItem[]> {
    const nowIso = this.now().toISOString();
    const rows = await this.db
      .selectFrom('gift_credits as g')
      .leftJoin('users as u', 'u.id', 'g.granted_by')
      .select((eb) => [
        'g.id',
        'g.origin',
        'g.amount',
        'g.expires_at',
        'g.voided_at',
        'g.reason',
        'g.created_at',
        'u.name as granted_by_name',
        remainingOf(eb).as('remaining'),
      ])
      .where('g.tenant_id', '=', tenantId)
      .orderBy('g.created_at', 'desc')
      .orderBy('g.id', 'desc')
      .execute();
    return rows.map((r): GiftItem => ({
      id: r.id,
      origin: r.origin === 'signup' ? 'signup' : 'grant',
      amount: r.amount,
      remaining: r.voided_at !== null || r.expires_at <= nowIso ? 0 : Math.max(0, r.remaining),
      expiresAt: r.expires_at,
      status: r.voided_at !== null ? 'voided' : r.expires_at <= nowIso ? 'expired' : r.remaining <= 0 ? 'used' : 'active',
      grantedByName: r.granted_by_name,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }

  async paymentInfo(): Promise<PaymentInfo> {
    const s = await readBillingSettings(this.db);
    return { alias: s.paymentAlias, cbu: s.paymentCbu, holder: s.paymentHolder, supportWhatsapp: s.supportWhatsapp };
  }

  // --- plataforma ---

  /** Un pago al titular del comercio: cancela primero la deuda de sus comercios, del cargo más antiguo; el resto queda de saldo. */
  async registerPayment(p: {
    tenantId: string;
    day: string;
    amount: number;
    info?: string | undefined;
    actorUserId: string;
    paymentRef?: string | undefined;
  }): Promise<{ movementId: string; settled: number }> {
    const holder = await this.requireHolder(p.tenantId);
    requirePositive(p.amount);
    if (p.paymentRef !== undefined && (await this.paymentRefExists(p.paymentRef))) {
      throw new DomainError(409, 'Ese pago ya estaba registrado');
    }
    const at = this.now().toISOString();
    const movementId = `pm_${randomUUID()}`;
    return await this.db.transaction().execute(async (trx) => {
      await this.lockHolder(holder, trx);
      // El índice único de payment_ref frena una carrera con la misma referencia: el segundo falla
      await trx
        .insertInto('paid_movements')
        .values({
          id: movementId,
          user_id: holder,
          kind: 'payment',
          amount: p.amount,
          tenant_id: p.tenantId,
          payment_ref: p.paymentRef ?? null,
          day: p.day,
          info: p.info ?? null,
          created_by: p.actorUserId,
          created_at: at,
        })
        .execute();
      const debts = await trx
        .selectFrom('charges as c')
        .innerJoin('tenants as t', 't.id', 'c.tenant_id')
        .select(['c.id', 'c.tenant_id', 'c.day', 'c.debt_amount'])
        .where('t.holder_user_id', '=', holder)
        .where('c.debt_amount', '>', 0)
        .orderBy('c.day')
        .orderBy('c.created_at')
        .orderBy('c.id')
        .execute();
      let left = p.amount;
      let settled = 0;
      for (const debt of debts) {
        if (left <= 0) break;
        const x = Math.min(left, debt.debt_amount);
        await trx
          .updateTable('charges')
          .set((eb) => ({
            debt_amount: eb('debt_amount', '-', x),
            paid_amount: eb('paid_amount', '+', x),
            debt_settled_at: sumCents(debt.debt_amount, -x) <= 0 ? at : null,
          }))
          .where('id', '=', debt.id)
          .execute();
        await trx
          .insertInto('paid_movements')
          .values({
            id: `pm_${randomUUID()}`,
            user_id: holder,
            kind: 'debt-settlement',
            amount: -x,
            tenant_id: debt.tenant_id,
            charge_id: debt.id,
            day: debt.day,
            created_by: p.actorUserId,
            created_at: at,
          })
          .execute();
        left = sumCents(left, -x);
        settled = sumCents(settled, x);
      }
      return { movementId, settled };
    });
  }

  /** Créditos regalados por root o soporte: vencen al terminar el día argentino `expiresOn`. */
  async grantCredits(p: { tenantId: string; amount: number; expiresOn: string; reason?: string | undefined; actorUserId: string }): Promise<string> {
    await this.requireTenant(p.tenantId);
    requirePositive(p.amount);
    const id = `gift_${randomUUID()}`;
    await this.db
      .insertInto('gift_credits')
      .values({
        id,
        tenant_id: p.tenantId,
        amount: p.amount,
        expires_at: `${shiftDay(p.expiresOn, 1)}T03:00:00.000Z`,
        origin: 'grant',
        granted_by: p.actorUserId,
        reason: p.reason ?? null,
        created_at: this.now().toISOString(),
      })
      .execute();
    return id;
  }

  /** Anula el remanente de un crédito regalado (lo consumido queda como está). */
  async voidCredit(p: { tenantId: string; creditId: string; reason: string; actorUserId: string }): Promise<void> {
    const res = await this.db
      .updateTable('gift_credits')
      .set({ voided_at: this.now().toISOString(), voided_by: p.actorUserId, void_reason: p.reason })
      .where('id', '=', p.creditId)
      .where('tenant_id', '=', p.tenantId)
      .where('voided_at', 'is', null)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) throw new DomainError(404, 'Crédito no encontrado');
  }

  async setGrace(p: { tenantId: string; until: string }): Promise<void> {
    await this.requireTenant(p.tenantId);
    await this.db.updateTable('tenants').set({ grace_until: p.until }).where('id', '=', p.tenantId).execute();
  }

  /** Devolución del saldo pagado del titular (solo root): nunca más que el saldo. */
  async refund(p: { tenantId: string; amount: number; info?: string | undefined; actorUserId: string }): Promise<string> {
    const holder = await this.requireHolder(p.tenantId);
    requirePositive(p.amount);
    const id = `pm_${randomUUID()}`;
    const at = this.now();
    await this.db.transaction().execute(async (trx) => {
      await this.lockHolder(holder, trx);
      if (p.amount > (await this.paidBalance(holder, trx))) throw new DomainError(400, 'La devolución supera el saldo pagado');
      await trx
        .insertInto('paid_movements')
        .values({
          id,
          user_id: holder,
          kind: 'refund',
          amount: -p.amount,
          tenant_id: p.tenantId,
          day: argentinaToday(at),
          info: p.info ?? null,
          created_by: p.actorUserId,
          created_at: at.toISOString(),
        })
        .execute();
    });
    return id;
  }

  /** Cambia el titular: tiene que ser un owner activo. El saldo pagado es de la persona y no se mueve. */
  async setHolder(p: { tenantId: string; userId: string }): Promise<void> {
    await this.requireTenant(p.tenantId);
    const owner = await this.db
      .selectFrom('memberships')
      .select('user_id')
      .where('tenant_id', '=', p.tenantId)
      .where('user_id', '=', p.userId)
      .where('role', '=', 'owner')
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (owner === undefined) throw new DomainError(400, 'El titular tiene que ser un owner activo del comercio');
    await this.db.updateTable('tenants').set({ holder_user_id: p.userId }).where('id', '=', p.tenantId).execute();
  }

  async settings(): Promise<BillingSettings> {
    return await readBillingSettings(this.db);
  }

  async updateSettings(patch: BillingSettingsPatch, actorUserId: string): Promise<BillingSettings> {
    return await writeBillingSettings(this.db, patch, actorUserId, this.now().toISOString());
  }

  /** Un comercio por su identificador, para la planilla; `demo` si es una demo. */
  async findTenantBySlug(slug: string): Promise<{ id: string; name: string; demo: boolean } | undefined> {
    const row = await this.db.selectFrom('tenants').select(['id', 'name']).where('slug', '=', slug).executeTakeFirst();
    return row === undefined ? undefined : { id: row.id, name: row.name, demo: await this.legacy.isDemoTenant(row.id) };
  }

  async paymentRefExists(ref: string): Promise<boolean> {
    return (await this.db.selectFrom('paid_movements').select('id').where('payment_ref', '=', ref).executeTakeFirst()) !== undefined;
  }

  /** Los pagos registrados, del más nuevo al más viejo. */
  async listPayments(limit = 200): Promise<PlatformPaymentItem[]> {
    const rows = await this.db
      .selectFrom('paid_movements as p')
      .innerJoin('users as h', 'h.id', 'p.user_id')
      .leftJoin('tenants as t', 't.id', 'p.tenant_id')
      .leftJoin('users as c', 'c.id', 'p.created_by')
      .select([
        'p.id',
        'p.day',
        'p.amount',
        'p.info',
        'p.tenant_id',
        't.name as tenant_name',
        'h.name as holder_name',
        'c.name as created_by_name',
        'p.created_at',
        'p.payment_ref',
      ])
      .where('p.kind', '=', 'payment')
      .orderBy('p.created_at', 'desc')
      .orderBy('p.id', 'desc')
      .limit(limit)
      .execute();
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

  private async requireTenant(tenantId: string): Promise<void> {
    const row = await this.db.selectFrom('tenants').select('id').where('id', '=', tenantId).executeTakeFirst();
    if (row === undefined || (await this.legacy.isDemoTenant(tenantId))) throw new DomainError(404, 'Comercio no encontrado');
  }

  private async requireHolder(tenantId: string): Promise<string> {
    await this.requireTenant(tenantId);
    const holder = await this.holderOf(tenantId);
    if (holder === null) throw new DomainError(400, 'El comercio no tiene titular');
    return holder;
  }

  private async holderOf(tenantId: string): Promise<string | null> {
    const row = await this.db.selectFrom('tenants').select('holder_user_id').where('id', '=', tenantId).executeTakeFirst();
    return row?.holder_user_id ?? null;
  }

  /**
   * Bloquea el saldo del titular hasta el fin de la transacción: cargos, pagos y devoluciones del
   * mismo titular van de a uno. Un candado de transacción sobre el id, no sobre la fila de `users`
   * (un `FOR UPDATE` ahí frenaría las FK que apuntan al usuario, como una sesión nueva).
   */
  private async lockHolder(holder: string, trx: Db): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${holder}`}, 0))`.execute(trx);
  }

  private async paidBalance(userId: string, db: Db = this.db): Promise<number> {
    const row = await db
      .selectFrom('paid_movements')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('amount'), sql.lit(0)).as('balance'))
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    return row.balance;
  }

  /** Regalados vigentes con remanente, por vencimiento más próximo. */
  private async giftBalances(tenantId: string, db: Db = this.db): Promise<DatedGift[]> {
    const rows = await db
      .selectFrom('gift_credits as g')
      .select((eb) => ['g.id', 'g.expires_at', remainingOf(eb).as('remaining')])
      .where('g.tenant_id', '=', tenantId)
      .where('g.voided_at', 'is', null)
      .where('g.expires_at', '>', this.now().toISOString())
      .orderBy('g.expires_at')
      .orderBy('g.created_at')
      .orderBy('g.id')
      .execute();
    return rows.filter((r) => r.remaining > 0).map((r) => ({ creditId: r.id, remaining: r.remaining, expiresAt: r.expires_at }));
  }

  private async chargeOne(tenantId: string, holder: string, registerId: string, device: string, day: string): Promise<boolean> {
    return await this.db.transaction().execute(async (trx) => {
      await this.lockHolder(holder, trx);
      const exists = await trx
        .selectFrom('charges')
        .select('id')
        .where('register_id', '=', registerId)
        .where('device_id', '=', device)
        .where('day', '=', day)
        .executeTakeFirst();
      if (exists !== undefined) return false;
      const settings = await readBillingSettings(trx);
      const allocation = allocateCharge({
        price: settings.pricePerRegisterDay,
        paidShare: settings.paidShare,
        paidBalance: await this.paidBalance(holder, trx),
        gifts: await this.giftBalances(tenantId, trx),
      });
      const id = `chg_${randomUUID()}`;
      const at = this.now().toISOString();
      const giftAmount = allocation.gifts.reduce((sum, g) => sum + g.amount, 0);
      await trx
        .insertInto('charges')
        .values({
          id,
          tenant_id: tenantId,
          register_id: registerId,
          device_id: device,
          day,
          amount: settings.pricePerRegisterDay,
          paid_amount: allocation.paid,
          gift_amount: giftAmount,
          debt_amount: allocation.debt,
          rule: JSON.stringify({ price: settings.pricePerRegisterDay, paidShare: settings.paidShare }),
          created_at: at,
        })
        .execute();
      if (allocation.gifts.length > 0) {
        await trx
          .insertInto('gift_consumptions')
          .values(allocation.gifts.map((g) => ({ charge_id: id, credit_id: g.creditId, amount: g.amount })))
          .execute();
      }
      if (allocation.paid > 0) {
        await trx
          .insertInto('paid_movements')
          .values({ id: `pm_${randomUUID()}`, user_id: holder, kind: 'charge', amount: -allocation.paid, tenant_id: tenantId, charge_id: id, day, created_at: at })
          .execute();
      }
      return true;
    });
  }
}
