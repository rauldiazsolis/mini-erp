import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from '../../shared/zod.ts';
import { lotIssuesSchema, parseBatchEvent, type LotIssue, type PushEvent } from './push-events.ts';
import { applyToBalance, type LedgerMovement } from '../customer/account-ledger.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { inSavepoint, isTransientError, jsonValue, stripNul, TransientError } from '../db/pg/sql-helpers.ts';
import { DEFAULT_BRANCH_ID } from '../db/tenant-manager.ts';
import { applyPendingFor, recordDiscrepancy, resolveVoidUnknown } from '../discrepancy/discrepancies.ts';
import { noticesFor, type NoticeContext } from '../notices/notice-service.ts';
import { saveCashMovement, saveCustomerPayment, saveSale } from '../sales/records.ts';

export type { LotIssue };

export type PushLotResult = {
  status: 'ok' | 'issues';
  issues?: LotIssue[];
  /** Días de las ventas (no anulaciones) aplicadas en este lote: los que se cobran (#21). */
  saleDays: string[];
};

type Db = Kysely<TenantDatabase>;

/** Un instante que llega de afuera, normalizado como lo guarda `timestamptz` (ISO en UTC). */
function instant(iso: string): string {
  return new Date(iso).toISOString();
}

/** Los avisos guardados de un lote (`jsonb`, ya parseado): se validan al leer; `undefined` si no hay. */
function storedIssues(value: unknown): LotIssue[] | undefined {
  const parsed = lotIssuesSchema.safeParse(value ?? undefined);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}

const cursorSchema = z.iso.datetime({ offset: true });

/**
 * El cursor del pull es el `updated_at` de la última fila entregada (texto ISO). Uno que no lo es
 * (otro backend, un dato corrupto) se ignora: el POS recibe la foto completa en vez de un error.
 */
function cursorInstant(cursor: string | undefined): string | undefined {
  if (cursor === undefined || !cursorSchema.safeParse(cursor).success) {
    return undefined;
  }
  const time = Date.parse(cursor);
  return Number.isNaN(time) || time < 0 ? undefined : new Date(time).toISOString();
}

export class ConnectorService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async processPushLot(params: {
    lotId: string;
    deviceId: string;
    events: unknown[];
    defaultBranchId?: string | undefined;
    /** La caja de la key y a qué equipo se cobran las ventas (#21). */
    registerId?: string | undefined;
    chargeDevice?: string | undefined;
  }): Promise<PushLotResult> {
    const now = new Date().toISOString();
    // PostgreSQL no admite el carácter nulo ni en `text` ni en `jsonb`: se quita del lote entero al
    // entrar, antes de guardarlo y de aplicar cada evento. Nunca es un dato.
    const lotId = stripNul(params.lotId);
    const deviceId = stripNul(params.deviceId);
    const events = stripNul(params.events);
    const register = { registerId: params.registerId ?? null, chargeDevice: params.chargeDevice ?? null };

    // Todo el lote en una transacción y cada evento en un SAVEPOINT (#2): un evento que falla se
    // deshace solo y queda como issue; el lote nunca queda en `processing` con efectos a medias.
    return await this.db.transaction().execute(async (trx) => {
      // Idempotencia: la fila del lote se toma primero. Un pedido repetido (también uno simultáneo,
      // que esperó al primero) no inserta nada.
      const claimed = await trx
        .insertInto('push_lots')
        .values({ id: lotId, device_id: deviceId, status: 'processing', events: jsonValue(events), issues: null, created_at: now, updated_at: now })
        .onConflict((oc) => oc.column('id').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (claimed === undefined) {
        // Ya procesado: se devuelve su estado guardado, sin repetir efectos
        const existing = await trx.selectFrom('push_lots').select(['status', 'issues']).where('id', '=', lotId).executeTakeFirst();
        const stored = storedIssues(existing?.issues);
        return {
          status: existing?.status === 'issues' ? 'issues' : 'ok',
          ...(stored === undefined ? {} : { issues: stored }),
          saleDays: [],
        };
      }

      // Un lote a la vez por comercio, como cuando la base era un archivo: dos lotes simultáneos que
      // tocan los mismos clientes o el mismo stock en otro orden se trabarían entre sí. El candado es
      // la fila de la primera sucursal (`FOR NO KEY UPDATE`: no frena al admin, que solo la referencia).
      const lock = await trx.selectFrom('branches').select('id').orderBy('seq').limit(1).forNoKeyUpdate().execute();
      if (lock.length === 0) {
        // La borró un reinicio total de la demo mientras esperábamos (la sembrada de nuevo no se ve
        // desde esta sentencia): el lote entero se deshace y el POS lo reintenta, ya con la key revocada
        throw new TransientError('El comercio se reinició mientras llegaba el lote: reintentar');
      }

      const issues: LotIssue[] = [];
      const saleDays = new Set<string>();
      const resolvedBranchId = await this.resolveBranchId(params.defaultBranchId, trx);
      for (const raw of events) {
        const parsed = parseBatchEvent(raw);
        if (!parsed.ok) {
          issues.push(parsed.issue);
          continue;
        }
        // El día de la venta se suma al lote solo si el evento se aplicó (su SAVEPOINT se liberó)
        const eventDays: string[] = [];
        try {
          const issue = await inSavepoint(
            trx,
            'evento',
            async () =>
              await this.applyEvent(trx, parsed.event, deviceId, resolvedBranchId, now, register, (day) => {
                eventDays.push(day);
              }),
          );
          for (const day of eventDays) {
            saleDays.add(day);
          }
          if (issue !== undefined) {
            issues.push(issue);
          }
        } catch (err: unknown) {
          // Un deadlock con otra transacción (otro lote a la vez, el admin) no es culpa del evento: el
          // lote entero falla y el POS lo reintenta, en vez de perder el evento como un aviso definitivo
          if (isTransientError(err)) {
            throw err;
          }
          const detail = err instanceof Error ? err.message : String(err);
          issues.push({ eventId: parsed.event.id, message: `No se pudo aplicar: ${detail}` });
        }
      }

      const status: 'ok' | 'issues' = issues.length > 0 ? 'issues' : 'ok';
      await trx
        .updateTable('push_lots')
        .set({ status, issues: issues.length > 0 ? jsonValue(issues) : null, updated_at: now })
        .where('id', '=', lotId)
        .execute();

      return {
        status,
        ...(issues.length > 0 ? { issues } : {}),
        saleDays: [...saleDays].sort(),
      };
    });
  }

  /** La sucursal por su id o su código; sin dato o si no existe, la primera (la de menor `seq`). */
  private async resolveBranchId(branchCodeOrId: string | undefined, db: Db = this.db): Promise<string> {
    if (branchCodeOrId !== undefined && branchCodeOrId !== '') {
      const row = await db
        .selectFrom('branches')
        .select('id')
        .where((eb) => eb.or([eb('id', '=', branchCodeOrId), eb('code', '=', branchCodeOrId)]))
        .orderBy('seq')
        .limit(1)
        .executeTakeFirst();
      if (row !== undefined) {
        return row.id;
      }
    }
    const first = await db.selectFrom('branches').select('id').orderBy('seq').limit(1).executeTakeFirst();
    return first?.id ?? DEFAULT_BRANCH_ID;
  }

  private async applyEvent(
    trx: Transaction<TenantDatabase>,
    event: PushEvent,
    deviceId: string,
    defaultBranchId: string,
    now: string,
    register: { registerId: string | null; chargeDevice: string | null },
    onSaleDay: (day: string) => void,
  ): Promise<LotIssue | undefined> {
    const originBranch = event.origin?.branch ?? (defaultBranchId ? defaultBranchId : null);
    const originPos = event.origin?.pointOfSale ?? null;
    const where = { deviceId, branch: originBranch, pointOfSale: originPos, ...register };
    // Ventas, cobranzas y movimientos de caja con sus columnas derivadas (#20)
    const receivedAt = event.createdAt ?? now;

    switch (event.type) {
      case 'sale': {
        const sale = event.sale;
        const day = await saveSale(trx, sale, where, receivedAt);
        // Una anulación no genera cargo; cualquier otro ticket, sí (#21)
        if (sale.voidsSaleId === undefined && day !== null) {
          onSaleDay(day);
        }

        // Si fue a cuenta corriente sin hold (fiado offline o acreditación por anulación)
        if (sale.customerId !== undefined) {
          for (const payment of sale.payments) {
            if (payment.method === 'account' && payment.reference === undefined) {
              await this.moveBalance(
                trx,
                sale.customerId,
                { type: 'sale', delta: payment.amount, description: `Venta ${sale.id}`, saleId: sale.id },
                { type: 'sale', id: sale.id },
                where,
                now,
              );
            }
          }
        }
        return undefined;
      }

      case 'stock-movement': {
        const movement = event.movement;
        const movementBranchId = await this.resolveBranchId(originBranch ?? defaultBranchId, trx);

        // Sin FK a productos: el movimiento de un producto que el comercio no tiene se guarda igual
        const inserted = await trx
          .insertInto('stock_movements')
          .values({
            id: movement.id,
            product_id: movement.productId,
            branch_id: movementBranchId,
            delta: movement.delta,
            reason: movement.reason,
            sale_id: movement.saleId ?? null,
            device_id: deviceId,
            branch: originBranch,
            point_of_sale: originPos,
            created_at: instant(receivedAt),
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .returning('id')
          .executeTakeFirst();
        if (inserted === undefined) {
          // El movimiento ya estaba (el evento llegó antes, en otro lote): el stock no se vuelve a sumar
          return undefined;
        }

        await trx
          .insertInto('stock')
          .values({ product_id: movement.productId, branch_id: movementBranchId, quantity: movement.delta, updated_at: now })
          .onConflict((oc) =>
            oc.columns(['product_id', 'branch_id']).doUpdateSet((eb) => ({
              quantity: sql<number>`${eb.ref('stock.quantity')} + ${eb.ref('excluded.quantity')}`,
              updated_at: eb.ref('excluded.updated_at'),
            })),
          )
          .execute();
        return undefined;
      }

      case 'customer': {
        const cust = event.customer;
        await trx
          .insertInto('customers')
          .values({
            id: cust.id,
            name: cust.name,
            document: cust.document ?? null,
            phone: cust.phone ?? null,
            credit_limit: cust.creditLimit ?? null,
            margin: cust.margin ?? null,
            balance: cust.balance ?? 0,
            unrestricted: cust.unrestricted === true,
            blocked_reason: cust.blocked?.reason ?? null,
            created_at: instant(receivedAt),
            updated_at: now,
          })
          .onConflict((oc) =>
            oc.column('id').doUpdateSet((eb) => ({
              name: eb.ref('excluded.name'),
              document: eb.ref('excluded.document'),
              phone: eb.ref('excluded.phone'),
              credit_limit: eb.fn.coalesce('excluded.credit_limit', 'customers.credit_limit'),
              margin: eb.fn.coalesce('excluded.margin', 'customers.margin'),
              unrestricted: eb.ref('excluded.unrestricted'),
              blocked_reason: eb.ref('excluded.blocked_reason'),
              updated_at: eb.ref('excluded.updated_at'),
            })),
          )
          .execute();

        // El cliente ya existe: sus movimientos pendientes se aplican (#2)
        await applyPendingFor(trx, cust.id, now);
        return undefined;
      }

      case 'account-hold-confirm': {
        const { holdId, saleId } = event;
        // El saldo se mueve solo si esta fila pasó de `pending` a `confirmed`: confirmarla dos veces no cobra dos
        const hold = await trx
          .updateTable('account_holds')
          .set({ status: 'confirmed', confirmed_at: now })
          .where('id', '=', holdId)
          .where('status', '=', 'pending')
          .returning(['customer_id', 'amount'])
          .executeTakeFirst();
        if (hold !== undefined) {
          await this.moveBalance(
            trx,
            hold.customer_id,
            { type: 'sale', delta: hold.amount, description: `Venta a cuenta corriente ${saleId}`, saleId },
            { type: 'sale', id: saleId },
            where,
            now,
          );
        }
        return undefined;
      }

      case 'account-hold-release': {
        await trx
          .updateTable('account_holds')
          .set({ status: 'released', released_at: now })
          .where('id', '=', event.holdId)
          .where('status', '=', 'pending')
          .execute();
        return undefined;
      }

      case 'cash-movement': {
        await saveCashMovement(trx, event.movement, where, receivedAt);
        return undefined;
      }

      case 'customer-payment': {
        const payment = event.payment;
        if (!(await saveCustomerPayment(trx, payment, where, receivedAt))) {
          return undefined;
        }
        const ref = { type: 'customer-payment' as const, id: payment.id };
        if (payment.voidsPaymentId === undefined) {
          await this.moveBalance(trx, payment.customerId, { type: 'payment', delta: -payment.total, description: `Cobranza ${payment.id}` }, ref, where, now);
          await resolveVoidUnknown(trx, payment.id, now);
          return undefined;
        }
        // Anulación (4.3.0): nunca se rechaza; el saldo sube por -total y lo raro queda para revisar
        await this.moveBalance(
          trx,
          payment.customerId,
          { type: 'payment-void', delta: -payment.total, description: `Anulación de cobranza ${payment.voidsPaymentId}` },
          ref,
          where,
          now,
        );
        const original = await trx
          .selectFrom('customer_payments')
          .select('customer_id')
          .where('id', '=', payment.voidsPaymentId)
          .executeTakeFirst();
        // Duplicada: otra anulación de la misma cobranza, del mismo cliente que la original (una de otro
        // cliente ya es su propia discrepancia y no cuenta)
        const otherVoid =
          original === undefined
            ? undefined
            : await trx
                .selectFrom('customer_payments')
                .select('id')
                .where('voids_payment_id', '=', payment.voidsPaymentId)
                .where('id', '!=', payment.id)
                .where('customer_id', '=', original.customer_id)
                .limit(1)
                .executeTakeFirst();
        const kind =
          original === undefined
            ? 'void-unknown-payment'
            : original.customer_id !== payment.customerId
              ? 'void-customer-mismatch'
              : otherVoid !== undefined
                ? 'void-duplicate'
                : undefined;
        if (kind !== undefined) {
          await recordDiscrepancy(
            trx,
            {
              kind,
              deviceId,
              originBranch,
              originPos,
              customerId: payment.customerId,
              refType: 'customer-payment',
              refId: payment.id,
              amount: -payment.total,
              ...(kind === 'void-unknown-payment' ? { voidsPaymentId: payment.voidsPaymentId } : {}),
            },
            now,
          );
        }
        return undefined;
      }
    }
  }

  /** Mueve el saldo; con un cliente desconocido, el movimiento queda pendiente como discrepancia (#2). */
  private async moveBalance(
    trx: Transaction<TenantDatabase>,
    customerId: string,
    movement: LedgerMovement,
    ref: { type: 'sale' | 'customer-payment'; id: string },
    origin: { deviceId: string; branch: string | null; pointOfSale: string | null },
    now: string,
  ): Promise<void> {
    if (await applyToBalance(trx, customerId, movement, now)) {
      return;
    }
    await recordDiscrepancy(
      trx,
      {
        kind: 'unknown-customer',
        deviceId: origin.deviceId,
        originBranch: origin.branch,
        originPos: origin.pointOfSale,
        customerId,
        refType: ref.type,
        refId: ref.id,
        amount: movement.delta,
        pending: movement,
      },
      now,
    );
  }

  async pullCatalog(params: {
    cursors: { products?: string | undefined; customers?: string | undefined };
    pendingLotIds: string[];
    branchId?: string;
    deviceId?: string | undefined;
    /** Cobro y caja de la terminal, para sus avisos (#21). */
    notices?: Omit<NoticeContext, 'deviceId'> | undefined;
  }) {
    const deviceId = stripNul(params.deviceId);
    const pendingLotIds = stripNul(params.pendingLotIds);

    // 1. Productos: lo cambiado después del cursor, en un orden estable (el id desempata)
    const productsAfter = cursorInstant(params.cursors.products);
    let productQuery = this.db
      .selectFrom('products')
      .select(['id', 'sku', 'barcodes', 'name', 'price', 'tax_rate', 'category', 'tracks_stock', 'blocked_reason', 'created_at', 'updated_at']);
    if (productsAfter !== undefined) {
      productQuery = productQuery.where('updated_at', '>', productsAfter);
    }
    const productRows = await productQuery.orderBy('updated_at').orderBy('id').execute();

    const products = productRows.map((r) => ({
      id: r.id,
      sku: r.sku,
      barcodes: barcodesSchema.parse(r.barcodes),
      name: r.name,
      price: r.price,
      taxRate: r.tax_rate,
      category: r.category,
      tracksStock: r.tracks_stock,
      createdAt: r.created_at,
      ...(r.blocked_reason ? { blocked: { reason: r.blocked_reason } } : {}),
    }));

    const lastProduct = productRows.at(-1);

    // 2. Clientes
    const customersAfter = cursorInstant(params.cursors.customers);
    let customerQuery = this.db
      .selectFrom('customers')
      .select(['id', 'name', 'document', 'phone', 'credit_limit', 'margin', 'balance', 'unrestricted', 'blocked_reason', 'created_at', 'updated_at']);
    if (customersAfter !== undefined) {
      customerQuery = customerQuery.where('updated_at', '>', customersAfter);
    }
    const customerRows = await customerQuery.orderBy('updated_at').orderBy('id').execute();

    const customers = customerRows.map((r) => ({
      id: r.id,
      name: r.name,
      ...(r.document ? { document: r.document } : {}),
      ...(r.phone ? { phone: r.phone } : {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ...(r.credit_limit !== null ? { creditLimit: r.credit_limit } : {}),
      ...(r.margin !== null ? { margin: r.margin } : {}),
      ...(r.balance !== null ? { balance: r.balance } : {}),
      ...(r.unrestricted ? { unrestricted: true } : {}),
      ...(r.blocked_reason ? { blocked: { reason: r.blocked_reason } } : {}),
    }));

    const lastCustomer = customerRows.at(-1);

    // 3. Stock (filtrado por sucursal si se especifica, o consolidado por defecto)
    let stockRows: { product_id: string; quantity: number | null; updated_at: string | null }[];
    if (params.branchId !== undefined && params.branchId !== '') {
      const resolvedBranchId = await this.resolveBranchId(params.branchId);
      stockRows = await this.db
        .selectFrom('stock')
        .select(['product_id', 'quantity', 'updated_at'])
        .where('branch_id', '=', resolvedBranchId)
        .orderBy('product_id')
        .execute();
    } else {
      stockRows = await this.db
        .selectFrom('stock')
        .select((eb) => ['product_id', eb.fn.sum<number | null>('quantity').as('quantity'), eb.fn.max('updated_at').as('updated_at')])
        .groupBy('product_id')
        .orderBy('product_id')
        .execute();
    }

    const stock = stockRows.map((r) => ({
      productId: r.product_id,
      quantity: r.quantity ?? 0,
      updatedAt: r.updated_at,
    }));

    // 4. Estados de lotes consultados
    const lots: Record<string, { status: string; issues?: LotIssue[] }> = {};
    const lotRows =
      pendingLotIds.length === 0
        ? []
        : await this.db.selectFrom('push_lots').select(['id', 'status', 'issues']).where('id', 'in', pendingLotIds).execute();
    for (const lot of lotRows) {
      const issues = storedIssues(lot.issues);
      lots[lot.id] = { status: lot.status, ...(issues === undefined ? {} : { issues }) };
    }

    return {
      products: {
        items: products,
        ...(lastProduct ? { nextCursor: lastProduct.updated_at } : {}),
      },
      customers: {
        items: customers,
        ...(lastCustomer ? { nextCursor: lastCustomer.updated_at } : {}),
      },
      stock,
      lots,
      // Avisos de este equipo (4.4.0, #2): la lista vigente y completa, sin cursor
      notices: await noticesFor(this.db, { deviceId, ...params.notices }),
    };
  }

  /**
   * Reserva de cuenta corriente. El disponible se calcula y la reserva se crea con el cliente
   * bloqueado (`FOR UPDATE`): dos pedidos a la vez no aprueban entre los dos más que el límite.
   */
  async requestAccountHold(params: {
    customerId: string;
    amount: number;
  }): Promise<{ approved: true; holdId: string } | { approved: false; reasonCode: string }> {
    const customerId = stripNul(params.customerId);
    return await this.db.transaction().execute(async (trx) => {
      const cust = await trx
        .selectFrom('customers')
        .select(['credit_limit', 'margin', 'balance', 'unrestricted'])
        .where('id', '=', customerId)
        .forUpdate()
        .executeTakeFirst();

      if (cust === undefined || cust.credit_limit === null) {
        return { approved: false, reasonCode: 'no-account' };
      }

      if (!cust.unrestricted) {
        const pending = await trx
          .selectFrom('account_holds')
          .select((eb) => eb.fn.coalesce(eb.fn.sum<number | null>('amount'), sql.lit(0)).as('total'))
          .where('customer_id', '=', customerId)
          .where('status', '=', 'pending')
          .executeTakeFirstOrThrow();

        const available = cust.credit_limit + (cust.margin ?? 0) - (cust.balance ?? 0) - pending.total;
        if (params.amount > available) {
          return { approved: false, reasonCode: 'insufficient-credit' };
        }
      }

      const holdId = `hld_${randomUUID()}`;
      await trx
        .insertInto('account_holds')
        .values({ id: holdId, customer_id: customerId, amount: params.amount, status: 'pending', created_at: new Date().toISOString() })
        .execute();
      return { approved: true, holdId };
    });
  }
}

const barcodesSchema = z.array(z.string()).catch([]);
