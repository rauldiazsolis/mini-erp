import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type LotIssue = { message: string; eventId?: string };

export type BatchEvent = {
  type: string;
  id: string;
  createdAt?: string;
  origin?: { branch?: string; pointOfSale?: string };
} & Record<string, unknown>;

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
    events: BatchEvent[];
    defaultBranchId?: string;
  }): PushLotResult {
    const now = new Date().toISOString();

    // Idempotencia: si el lote ya fue procesado, no repetir efectos
    const existing = this.tenantDb
      .prepare('SELECT status, issues FROM push_lots WHERE id = ?')
      .get(params.lotId) as { status: string; issues: string | null } | undefined;

    if (existing !== undefined && (existing.status === 'ok' || existing.status === 'issues')) {
      return {
        status: existing.status as 'ok' | 'issues',
        issues: existing.issues ? (JSON.parse(existing.issues) as LotIssue[]) : undefined,
      };
    }

    // Registrar lote en cola
    this.tenantDb
      .prepare(
        'INSERT INTO push_lots (id, device_id, status, events, issues, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(id) DO NOTHING',
      )
      .run(params.lotId, params.deviceId, 'processing', JSON.stringify(params.events), now, now);

    const issues: LotIssue[] = [];
    const resolvedBranchId = this.resolveBranchId(params.defaultBranchId);

    // Procesar cada evento atómicamente
    for (const event of params.events) {
      const issue = this.applyEvent(event, params.deviceId, resolvedBranchId, now);
      if (issue !== undefined) {
        issues.push(issue);
      }
    }

    const finalStatus: 'ok' | 'issues' = issues.length > 0 ? 'issues' : 'ok';
    const issuesJson = issues.length > 0 ? JSON.stringify(issues) : null;

    this.tenantDb
      .prepare(
        'UPDATE push_lots SET status = ?, issues = ?, updated_at = ? WHERE id = ?',
      )
      .run(finalStatus, issuesJson, now, params.lotId);

    return {
      status: finalStatus,
      issues: issues.length > 0 ? issues : undefined,
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
    event: BatchEvent,
    deviceId: string,
    defaultBranchId: string,
    now: string,
  ): LotIssue | undefined {
    const originBranch = event.origin?.branch ?? null;
    const originPos = event.origin?.pointOfSale ?? null;

    switch (event.type) {
      case 'sale': {
        const sale = event['sale'] as {
          id: string;
          total: number;
          customerId?: string;
          voidsSaleId?: string;
          payments?: { method: string; amount: number; reference?: string }[];
        };

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
          for (const payment of sale.payments ?? []) {
            if (payment.method === 'account' && payment.reference === undefined) {
              this.adjustCustomerBalance(
                sale.customerId,
                payment.amount,
                'sale',
                `Venta ${sale.id}`,
                sale.id,
                now,
              );
            }
          }
        }
        return undefined;
      }

      case 'stock-movement': {
        const movement = event['movement'] as {
          id: string;
          productId: string;
          delta: number;
          reason: string;
          saleId?: string;
        };

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
        const cust = event['customer'] as {
          id: string;
          name: string;
          document?: string;
          phone?: string;
          creditLimit?: number;
          margin?: number;
          balance?: number;
          unrestricted?: boolean;
          blocked?: { reason: string };
        };

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

        return undefined;
      }

      case 'account-hold-confirm': {
        const holdId = String(event['holdId']);
        const saleId = String(event['saleId']);

        const hold = this.tenantDb
          .prepare('SELECT customer_id, amount, status FROM account_holds WHERE id = ?')
          .get(holdId) as { customer_id: string; amount: number; status: string } | undefined;

        if (hold !== undefined && hold.status === 'pending') {
          this.tenantDb
            .prepare("UPDATE account_holds SET status = 'confirmed', confirmed_at = ? WHERE id = ?")
            .run(now, holdId);

          this.adjustCustomerBalance(
            hold.customer_id,
            hold.amount,
            'sale',
            `Venta a cuenta corriente ${saleId}`,
            saleId,
            now,
          );
        }
        return undefined;
      }

      case 'account-hold-release': {
        const holdId = String(event['holdId']);
        this.tenantDb
          .prepare("UPDATE account_holds SET status = 'released', released_at = ? WHERE id = ? AND status = 'pending'")
          .run(now, holdId);
        return undefined;
      }

      case 'cash-movement': {
        const movement = event['movement'] as { id: string };
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
        const payment = event['payment'] as { id: string; customerId: string; total: number };
        const inserted = this.tenantDb
          .prepare(
            `INSERT INTO customer_payments (id, customer_id, payload, device_id, branch, point_of_sale, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO NOTHING`,
          )
          .run(payment.id, payment.customerId, JSON.stringify(payment), deviceId, originBranch, originPos, event.createdAt ?? now);

        if (inserted.changes > 0) {
          this.adjustCustomerBalance(
            payment.customerId,
            -payment.total,
            'payment',
            `Cobranza ${payment.id}`,
            undefined,
            now,
          );
        }
        return undefined;
      }

      default:
        return {
          message: `Tipo de evento no reconocido: ${event.type}`,
          eventId: event.id,
        };
    }
  }

  private adjustCustomerBalance(
    customerId: string,
    delta: number,
    type: 'sale' | 'payment' | 'adjustment' | 'interest',
    description: string,
    saleId: string | undefined,
    now: string,
  ): void {
    const cust = this.tenantDb
      .prepare('SELECT balance FROM customers WHERE id = ?')
      .get(customerId) as { balance: number | null } | undefined;

    if (cust === undefined) {
      return;
    }

    const currentBalance = cust.balance ?? 0;
    const newBalance = Math.round((currentBalance + delta) * 100) / 100;

    this.tenantDb
      .prepare('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?')
      .run(newBalance, now, customerId);

    const movId = `mov_${randomUUID()}`;
    this.tenantDb
      .prepare(
        `INSERT INTO account_movements (id, customer_id, type, amount, balance_after, description, sale_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(movId, customerId, type, delta, newBalance, description, saleId ?? null, now);
  }

  pullCatalog(params: {
    cursors: { products?: string; customers?: string };
    pendingLotIds: string[];
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

    // 3. Stock completo consolidado
    const stockRows = this.tenantDb
      .prepare('SELECT product_id, SUM(quantity) as quantity, MAX(updated_at) as updated_at FROM stock GROUP BY product_id')
      .all() as { product_id: string; quantity: number | null; updated_at: string }[];

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

    const creditLimit = cust.credit_limit ?? 0;
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
