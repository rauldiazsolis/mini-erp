import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { parseBatchEvent, type LotIssue, type PushEvent } from './push-events.ts';
import { applyToBalance, type LedgerMovement } from '../customer/account-ledger.ts';
import { applyPendingFor, recordDiscrepancy, resolveVoidUnknown } from '../discrepancy/discrepancies.ts';

export type { LotIssue };

export type PushLotResult = {
  status: 'ok' | 'issues';
  issues?: LotIssue[];
};

export class ConnectorService {
  private tenantDb: DatabaseSync;

  constructor(tenantDb: DatabaseSync) {
    this.tenantDb = tenantDb;
  }

  processPushLot(params: {
    lotId: string;
    deviceId: string;
    events: unknown[];
    defaultBranchId?: string | undefined;
  }): PushLotResult {
    const now = new Date().toISOString();

    // Idempotencia: si el lote ya fue procesado, no repetir efectos
    const existing = this.tenantDb
      .prepare('SELECT status, issues FROM push_lots WHERE id = ?')
      .get(params.lotId) as { status: string; issues: string | null } | undefined;

    if (existing !== undefined && (existing.status === 'ok' || existing.status === 'issues')) {
      return {
        status: existing.status,
        ...(existing.issues ? { issues: JSON.parse(existing.issues) as LotIssue[] } : {}),
      };
    }

    const issues: LotIssue[] = [];
    // Todo el lote en una transacción y cada evento en un SAVEPOINT (#2): un evento que falla se
    // deshace solo y queda como issue; el lote nunca queda en `processing` con efectos a medias.
    this.tenantDb.exec('BEGIN');
    try {
      this.tenantDb
        .prepare(
          'INSERT INTO push_lots (id, device_id, status, events, issues, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(id) DO NOTHING',
        )
        .run(params.lotId, params.deviceId, 'processing', JSON.stringify(params.events), now, now);

      const resolvedBranchId = this.resolveBranchId(params.defaultBranchId);
      for (const raw of params.events) {
        const parsed = parseBatchEvent(raw);
        if (!parsed.ok) {
          issues.push(parsed.issue);
          continue;
        }
        this.tenantDb.exec('SAVEPOINT evento');
        try {
          const issue = this.applyEvent(parsed.event, params.deviceId, resolvedBranchId, now);
          this.tenantDb.exec('RELEASE evento');
          if (issue !== undefined) {
            issues.push(issue);
          }
        } catch (err: unknown) {
          this.tenantDb.exec('ROLLBACK TO evento');
          this.tenantDb.exec('RELEASE evento');
          const detail = err instanceof Error ? err.message : String(err);
          issues.push({ eventId: parsed.event.id, message: `No se pudo aplicar: ${detail}` });
        }
      }

      const finalStatus: 'ok' | 'issues' = issues.length > 0 ? 'issues' : 'ok';
      this.tenantDb
        .prepare('UPDATE push_lots SET status = ?, issues = ?, updated_at = ? WHERE id = ?')
        .run(finalStatus, issues.length > 0 ? JSON.stringify(issues) : null, now, params.lotId);
      this.tenantDb.exec('COMMIT');
    } catch (err: unknown) {
      this.tenantDb.exec('ROLLBACK');
      throw err;
    }

    return {
      status: issues.length > 0 ? 'issues' : 'ok',
      ...(issues.length > 0 ? { issues } : {}),
    };
  }

  private resolveBranchId(branchCodeOrId?: string): string {
    if (!branchCodeOrId) {
      const defaultBranch = this.tenantDb.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string } | undefined;
      return defaultBranch?.id ?? 'branch-central';
    }
    const row = this.tenantDb.prepare('SELECT id FROM branches WHERE id = ? OR code = ?').get(branchCodeOrId, branchCodeOrId) as { id: string } | undefined;
    if (row !== undefined) {
      return row.id;
    }
    const first = this.tenantDb.prepare('SELECT id FROM branches LIMIT 1').get() as { id: string } | undefined;
    return first?.id ?? 'branch-central';
  }

  private applyEvent(
    event: PushEvent,
    deviceId: string,
    defaultBranchId: string,
    now: string,
  ): LotIssue | undefined {
    const originBranch = event.origin?.branch ?? (defaultBranchId ? defaultBranchId : null);
    const originPos = event.origin?.pointOfSale ?? null;
    const where = { deviceId, branch: originBranch, pointOfSale: originPos };

    switch (event.type) {
      case 'sale': {
        const sale = event.sale;

        this.tenantDb
          .prepare(
            `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
          )
          .run(
            sale.id,
            JSON.stringify(sale),
            deviceId,
            originBranch,
            originPos,
            sale.total,
            sale.voidsSaleId ?? null,
            event.createdAt ?? now,
          );

        // Si fue a cuenta corriente sin hold (fiado offline o acreditación por anulación)
        if (sale.customerId !== undefined) {
          for (const payment of sale.payments) {
            if (payment.method === 'account' && payment.reference === undefined) {
              this.moveBalance(
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

        const movementBranchId = this.resolveBranchId(originBranch ?? defaultBranchId);

        this.tenantDb
          .prepare(
            `INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, sale_id, device_id, branch, point_of_sale, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          )
          .run(
            movement.id,
            movement.productId,
            movementBranchId,
            movement.delta,
            movement.reason,
            movement.saleId ?? null,
            deviceId,
            originBranch,
            originPos,
            event.createdAt ?? now,
          );

        // Actualizar stock de la sucursal
        this.tenantDb
          .prepare(
            `INSERT INTO stock (product_id, branch_id, quantity, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`,
          )
          .run(movement.productId, movementBranchId, movement.delta, now);

        return undefined;
      }

      case 'customer': {
        const cust = event.customer;

        this.tenantDb
          .prepare(
            `INSERT INTO customers (id, name, document, phone, credit_limit, margin, balance, unrestricted, blocked_reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET 
               name = excluded.name,
               document = excluded.document,
               phone = excluded.phone,
               credit_limit = COALESCE(excluded.credit_limit, customers.credit_limit),
               margin = COALESCE(excluded.margin, customers.margin),
               unrestricted = excluded.unrestricted,
               blocked_reason = excluded.blocked_reason,
               updated_at = excluded.updated_at`,
          )
          .run(
            cust.id,
            cust.name,
            cust.document ?? null,
            cust.phone ?? null,
            cust.creditLimit ?? null,
            cust.margin ?? null,
            cust.balance ?? 0,
            cust.unrestricted ? 1 : 0,
            cust.blocked?.reason ?? null,
            event.createdAt ?? now,
            now,
          );

        // El cliente ya existe: sus movimientos pendientes se aplican (#2)
        applyPendingFor(this.tenantDb, cust.id, now);

        return undefined;
      }

      case 'account-hold-confirm': {
        const { holdId, saleId } = event;

        const hold = this.tenantDb
          .prepare('SELECT customer_id, amount, status FROM account_holds WHERE id = ?')
          .get(holdId) as { customer_id: string; amount: number; status: string } | undefined;

        if (hold !== undefined && hold.status === 'pending') {
          this.tenantDb
            .prepare("UPDATE account_holds SET status = 'confirmed', confirmed_at = ? WHERE id = ?")
            .run(now, holdId);

          this.moveBalance(
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
        const { holdId } = event;
        this.tenantDb
          .prepare("UPDATE account_holds SET status = 'released', released_at = ? WHERE id = ? AND status = 'pending'")
          .run(now, holdId);
        return undefined;
      }

      case 'cash-movement': {
        const movement = event.movement;
        this.tenantDb
          .prepare(
            `INSERT INTO cash_movements (id, payload, device_id, branch, point_of_sale, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
          )
          .run(movement.id, JSON.stringify(movement), deviceId, originBranch, originPos, event.createdAt ?? now);
        return undefined;
      }

      case 'customer-payment': {
        const payment = event.payment;
        const inserted = this.tenantDb
          .prepare(
            `INSERT INTO customer_payments (id, customer_id, payload, device_id, branch, point_of_sale, voids_payment_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          )
          .run(payment.id, payment.customerId, JSON.stringify(payment), deviceId, originBranch, originPos, payment.voidsPaymentId ?? null, event.createdAt ?? now);
        if (inserted.changes === 0) {
          return undefined;
        }
        const ref = { type: 'customer-payment' as const, id: payment.id };
        if (payment.voidsPaymentId === undefined) {
          this.moveBalance(payment.customerId, { type: 'payment', delta: -payment.total, description: `Cobranza ${payment.id}` }, ref, where, now);
          resolveVoidUnknown(this.tenantDb, payment.id, now);
          return undefined;
        }
        // Anulación (4.3.0): nunca se rechaza; el saldo sube por -total y lo raro queda para revisar
        this.moveBalance(
          payment.customerId,
          { type: 'payment-void', delta: -payment.total, description: `Anulación de cobranza ${payment.voidsPaymentId}` },
          ref,
          where,
          now,
        );
        const original = this.tenantDb
          .prepare('SELECT customer_id FROM customer_payments WHERE id = ?')
          .get(payment.voidsPaymentId) as { customer_id: string } | undefined;
        // Duplicada: otra anulación de la misma cobranza, del mismo cliente que la original (una de otro
        // cliente ya es su propia discrepancia y no cuenta)
        const otherVoid =
          original === undefined
            ? undefined
            : this.tenantDb
                .prepare('SELECT 1 FROM customer_payments WHERE voids_payment_id = ? AND id != ? AND customer_id = ? LIMIT 1')
                .get(payment.voidsPaymentId, payment.id, original.customer_id);
        const kind =
          original === undefined
            ? 'void-unknown-payment'
            : original.customer_id !== payment.customerId
              ? 'void-customer-mismatch'
              : otherVoid !== undefined
                ? 'void-duplicate'
                : undefined;
        if (kind !== undefined) {
          recordDiscrepancy(
            this.tenantDb,
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
  private moveBalance(
    customerId: string,
    movement: LedgerMovement,
    ref: { type: 'sale' | 'customer-payment'; id: string },
    origin: { deviceId: string; branch: string | null; pointOfSale: string | null },
    now: string,
  ): void {
    if (applyToBalance(this.tenantDb, customerId, movement, now)) {
      return;
    }
    recordDiscrepancy(
      this.tenantDb,
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

  pullCatalog(params: {
    cursors: { products?: string | undefined; customers?: string | undefined };
    pendingLotIds: string[];
    branchId?: string;
  }) {
    // 1. Productos
    const productRows = (
      params.cursors.products === undefined
        ? this.tenantDb.prepare('SELECT * FROM products ORDER BY updated_at ASC').all()
        : this.tenantDb.prepare('SELECT * FROM products WHERE updated_at > ? ORDER BY updated_at ASC').all(params.cursors.products)
    ) as {
      id: string;
      sku: string;
      barcodes: string;
      name: string;
      price: number;
      tax_rate: number;
      category: string;
      tracks_stock: number;
      blocked_reason: string | null;
      created_at: string;
      updated_at: string;
    }[];

    const products = productRows.map((r) => ({
      id: r.id,
      sku: r.sku,
      barcodes: JSON.parse(r.barcodes) as string[],
      name: r.name,
      price: r.price,
      taxRate: r.tax_rate,
      category: r.category,
      tracksStock: r.tracks_stock === 1,
      createdAt: r.created_at,
      ...(r.blocked_reason ? { blocked: { reason: r.blocked_reason } } : {}),
    }));

    const lastProduct = productRows.at(-1);

    // 2. Clientes
    const customerRows = (
      params.cursors.customers === undefined
        ? this.tenantDb.prepare('SELECT * FROM customers ORDER BY updated_at ASC').all()
        : this.tenantDb.prepare('SELECT * FROM customers WHERE updated_at > ? ORDER BY updated_at ASC').all(params.cursors.customers)
    ) as {
      id: string;
      name: string;
      document: string | null;
      phone: string | null;
      credit_limit: number | null;
      margin: number | null;
      balance: number | null;
      unrestricted: number;
      blocked_reason: string | null;
      created_at: string;
      updated_at: string;
    }[];

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
      ...(r.unrestricted === 1 ? { unrestricted: true } : {}),
      ...(r.blocked_reason ? { blocked: { reason: r.blocked_reason } } : {}),
    }));

    const lastCustomer = customerRows.at(-1);

    // 3. Stock (filtrado por sucursal si se especifica, o consolidado por defecto)
    let stockRows: { product_id: string; quantity: number | null; updated_at: string }[];
    if (params.branchId !== undefined && params.branchId !== '') {
      const resolvedBranchId = this.resolveBranchId(params.branchId);
      stockRows = this.tenantDb
        .prepare('SELECT product_id, quantity, updated_at FROM stock WHERE branch_id = ?')
        .all(resolvedBranchId) as { product_id: string; quantity: number | null; updated_at: string }[];
    } else {
      stockRows = this.tenantDb
        .prepare('SELECT product_id, SUM(quantity) as quantity, MAX(updated_at) as updated_at FROM stock GROUP BY product_id')
        .all() as { product_id: string; quantity: number | null; updated_at: string }[];
    }

    const stock = stockRows.map((r) => ({
      productId: r.product_id,
      quantity: r.quantity ?? 0,
      updatedAt: r.updated_at,
    }));

    // 4. Estados de lotes consultados
    const lots: Record<string, { status: string; issues?: LotIssue[] }> = {};
    for (const lotId of params.pendingLotIds) {
      const lot = this.tenantDb
        .prepare('SELECT status, issues FROM push_lots WHERE id = ?')
        .get(lotId) as { status: string; issues: string | null } | undefined;

      if (lot !== undefined) {
        lots[lotId] = {
          status: lot.status,
          ...(lot.issues ? { issues: JSON.parse(lot.issues) as LotIssue[] } : {}),
        };
      }
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
    };
  }

  requestAccountHold(params: {
    customerId: string;
    amount: number;
  }): { approved: true; holdId: string } | { approved: false; reasonCode: string } {
    const cust = this.tenantDb
      .prepare('SELECT credit_limit, margin, balance, unrestricted FROM customers WHERE id = ?')
      .get(params.customerId) as
      | { credit_limit: number | null; margin: number | null; balance: number | null; unrestricted: number }
      | undefined;

    if (cust === undefined || cust.credit_limit === null) {
      return { approved: false, reasonCode: 'no-account' };
    }

    if (cust.unrestricted === 1) {
      const holdId = `hld_${randomUUID()}`;
      const now = new Date().toISOString();
      this.tenantDb
        .prepare('INSERT INTO account_holds (id, customer_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(holdId, params.customerId, params.amount, 'pending', now);
      return { approved: true, holdId };
    }

    const pendingRow = this.tenantDb
      .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM account_holds WHERE customer_id = ? AND status = 'pending'")
      .get(params.customerId) as { total: number };

    const creditLimit = cust.credit_limit;
    const margin = cust.margin ?? 0;
    const balance = cust.balance ?? 0;
    const pendingHeld = pendingRow.total;

    const available = creditLimit + margin - balance - pendingHeld;

    if (params.amount > available) {
      return { approved: false, reasonCode: 'insufficient-credit' };
    }

    const holdId = `hld_${randomUUID()}`;
    const now = new Date().toISOString();

    this.tenantDb
      .prepare('INSERT INTO account_holds (id, customer_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(holdId, params.customerId, params.amount, 'pending', now);

    return { approved: true, holdId };
  }
}
