import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type CustomerRecord = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  creditLimit: number;
  margin: number;
  balance: number;
  availableCredit: number | null;
  unrestricted: boolean;
  isDebtor: boolean;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateCustomerInput = {
  id?: string;
  name: string;
  document?: string | null;
  phone?: string | null;
  creditLimit?: number;
  margin?: number;
  unrestricted?: boolean;
  initialBalance?: number;
  blockedReason?: string | null;
};

export type UpdateCustomerInput = {
  name?: string;
  document?: string | null;
  phone?: string | null;
  creditLimit?: number;
  margin?: number;
  unrestricted?: boolean;
  blockedReason?: string | null;
};

export type CustomerFilter = {
  search?: string;
  debtorsOnly?: boolean;
  blocked?: boolean;
  limit?: number;
  offset?: number;
};

export type RegisterPaymentInput = {
  amount: number;
  method?: string;
  reference?: string;
  description?: string;
};

export type PaymentResult = {
  customerId: string;
  previousBalance: number;
  amount: number;
  newBalance: number;
  movementId: string;
  updatedAt: string;
};

export type AdjustBalanceInput = {
  type: 'credit' | 'debit' | 'set';
  amount: number;
  reason: string;
};

export type AdjustBalanceResult = {
  customerId: string;
  previousBalance: number;
  delta: number;
  newBalance: number;
  movementId: string;
  updatedAt: string;
};

export type MovementFilter = {
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export type AccountMovementRecord = {
  id: string;
  customerId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  saleId: string | null;
  createdAt: string;
};

interface RawCustomerRow {
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
}

interface RawMovementRow {
  id: string;
  customer_id: string;
  type: string;
  amount: number;
  balance_after: number;
  description: string | null;
  sale_id: string | null;
  created_at: string;
}

export class CustomerService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // --- CRUD CLIENTES ---

  listCustomers(filter?: CustomerFilter): CustomerRecord[] {
    let sql = 'SELECT * FROM customers WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter?.debtorsOnly === true) {
      sql += ' AND balance > 0';
    }

    if (filter?.blocked !== undefined) {
      if (filter.blocked) {
        sql += ' AND blocked_reason IS NOT NULL';
      } else {
        sql += ' AND blocked_reason IS NULL';
      }
    }

    if (filter?.search !== undefined && filter.search.trim() !== '') {
      const term = `%${filter.search.trim()}%`;
      sql += ' AND (name LIKE ? OR document LIKE ? OR phone LIKE ?)';
      params.push(term, term, term);
    }

    sql += ' ORDER BY name ASC';

    if (filter?.limit !== undefined && filter.limit > 0) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        sql += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as unknown as RawCustomerRow[];
    return rows.map((r) => this.mapCustomerRow(r));
  }

  getCustomer(id: string): CustomerRecord | undefined {
    const row = this.db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as unknown as RawCustomerRow | undefined;
    if (!row) return undefined;
    return this.mapCustomerRow(row);
  }

  createCustomer(data: CreateCustomerInput): CustomerRecord {
    const id = data.id ?? `cust_${randomUUID()}`;
    const now = new Date().toISOString();
    const creditLimit = data.creditLimit ?? 0;
    const margin = data.margin ?? 0;
    const unrestricted = data.unrestricted === true ? 1 : 0;
    const initialBalance = data.initialBalance ?? 0;
    const blockedReason = data.blockedReason ?? null;

    this.db
      .prepare(
        `INSERT INTO customers (id, name, document, phone, credit_limit, margin, balance, unrestricted, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.name,
        data.document ?? null,
        data.phone ?? null,
        creditLimit,
        margin,
        initialBalance,
        unrestricted,
        blockedReason,
        now,
        now,
      );

    if (initialBalance !== 0) {
      const movId = `mov_${randomUUID()}`;
      this.db
        .prepare(
          `INSERT INTO account_movements (id, customer_id, type, amount, balance_after, description, sale_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(movId, id, 'adjustment', initialBalance, initialBalance, 'Saldo inicial registrado', now);
    }

    return {
      id,
      name: data.name,
      document: data.document ?? null,
      phone: data.phone ?? null,
      creditLimit,
      margin,
      balance: initialBalance,
      availableCredit: unrestricted === 1 ? null : Math.max(0, creditLimit + margin - initialBalance),
      unrestricted: unrestricted === 1,
      isDebtor: initialBalance > 0,
      blockedReason,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateCustomer(id: string, data: UpdateCustomerInput): CustomerRecord | undefined {
    const current = this.getCustomer(id);
    if (!current) return undefined;

    const now = new Date().toISOString();
    const name = data.name ?? current.name;
    const document = data.document !== undefined ? data.document : current.document;
    const phone = data.phone !== undefined ? data.phone : current.phone;
    const creditLimit = data.creditLimit !== undefined ? data.creditLimit : current.creditLimit;
    const margin = data.margin !== undefined ? data.margin : current.margin;
    const unrestricted = data.unrestricted !== undefined ? (data.unrestricted ? 1 : 0) : (current.unrestricted ? 1 : 0);
    const blockedReason = data.blockedReason !== undefined ? data.blockedReason : current.blockedReason;

    this.db
      .prepare(
        `UPDATE customers
         SET name = ?, document = ?, phone = ?, credit_limit = ?, margin = ?, unrestricted = ?, blocked_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(name, document, phone, creditLimit, margin, unrestricted, blockedReason, now, id);

    return {
      id,
      name,
      document,
      phone,
      creditLimit,
      margin,
      balance: current.balance,
      availableCredit: unrestricted === 1 ? null : Math.max(0, creditLimit + margin - current.balance),
      unrestricted: unrestricted === 1,
      isDebtor: current.balance > 0,
      blockedReason,
      createdAt: current.createdAt,
      updatedAt: now,
    };
  }

  deleteCustomer(id: string, options?: { hard?: boolean; blockedReason?: string }): CustomerRecord | { deleted: boolean } {
    const current = this.getCustomer(id);
    if (!current) {
      const err = new Error(`Cliente '${id}' no encontrado`);
      (err as unknown as { statusCode: number }).statusCode = 404;
      throw err;
    }

    if (options?.hard === true) {
      this.db.prepare('DELETE FROM customers WHERE id = ?').run(id);
      return { deleted: true };
    }

    const reason = options?.blockedReason ?? 'Archivado por administración';
    const updated = this.updateCustomer(id, { blockedReason: reason });
    if (!updated) {
      throw new Error(`No se pudo actualizar el cliente '${id}'`);
    }
    return updated;
  }

  // --- COBRANZAS Y PAGOS ---

  registerPayment(customerId: string, input: RegisterPaymentInput): PaymentResult {
    const customer = this.getCustomer(customerId);
    if (!customer) {
      const err = new Error(`Cliente '${customerId}' no encontrado`);
      (err as unknown as { statusCode: number }).statusCode = 404;
      throw err;
    }

    if (input.amount <= 0) {
      throw new Error('El monto del pago debe ser mayor a cero');
    }

    const now = new Date().toISOString();
    const previousBalance = customer.balance;
    const newBalance = previousBalance - input.amount;
    const movId = `mov_${randomUUID()}`;
    const paymentId = `pay_${randomUUID()}`;
    const description = input.description ?? (input.reference ? `Cobranza ref. ${input.reference}` : 'Cobranza manual');

    // 1. Asiento en cuenta corriente (amount negativo para reducir deuda)
    this.db
      .prepare(
        `INSERT INTO account_movements (id, customer_id, type, amount, balance_after, description, sale_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(movId, customerId, 'payment', -input.amount, newBalance, description, now);

    // 2. Registro formal en customer_payments
    this.db
      .prepare(
        `INSERT INTO customer_payments (id, customer_id, payload, device_id, branch, point_of_sale, created_at)
         VALUES (?, ?, ?, 'admin_panel', 'ADMIN', 'Oficina', ?)`,
      )
      .run(
        paymentId,
        customerId,
        JSON.stringify({
          id: paymentId,
          customerId,
          total: input.amount,
          method: input.method ?? 'cash',
          reference: input.reference ?? null,
        }),
        now,
      );

    // 3. Actualizar saldo del cliente y updated_at
    this.db
      .prepare('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?')
      .run(newBalance, now, customerId);

    return {
      customerId,
      previousBalance,
      amount: input.amount,
      newBalance,
      movementId: movId,
      updatedAt: now,
    };
  }

  // --- AJUSTES TRANSPARENTES DE SALDO ---

  adjustBalance(customerId: string, input: AdjustBalanceInput): AdjustBalanceResult {
    const customer = this.getCustomer(customerId);
    if (!customer) {
      const err = new Error(`Cliente '${customerId}' no encontrado`);
      (err as unknown as { statusCode: number }).statusCode = 404;
      throw err;
    }

    if (input.amount < 0) {
      throw new Error('El monto no puede ser negativo');
    }

    if (!input.reason || input.reason.trim() === '') {
      throw new Error('El motivo del ajuste es obligatorio para auditoría contable');
    }

    const previousBalance = customer.balance;
    let delta: number;
    let newBalance: number;

    if (input.type === 'credit') {
      delta = -input.amount;
      newBalance = previousBalance + delta;
    } else if (input.type === 'debit') {
      delta = input.amount;
      newBalance = previousBalance + delta;
    } else {
      // type === 'set'
      newBalance = input.amount;
      delta = newBalance - previousBalance;
    }

    const now = new Date().toISOString();
    const movId = `mov_${randomUUID()}`;

    // 1. Asiento en cuenta corriente
    this.db
      .prepare(
        `INSERT INTO account_movements (id, customer_id, type, amount, balance_after, description, sale_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(movId, customerId, 'adjustment', delta, newBalance, input.reason.trim(), now);

    // 2. Actualizar saldo deudor del cliente y timestamp
    this.db
      .prepare('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?')
      .run(newBalance, now, customerId);

    return {
      customerId,
      previousBalance,
      delta,
      newBalance,
      movementId: movId,
      updatedAt: now,
    };
  }

  // --- EXTRACTO DE CUENTA CORRIENTE ---

  listMovements(customerId: string, filter?: MovementFilter): AccountMovementRecord[] {
    let sql = 'SELECT * FROM account_movements WHERE customer_id = ?';
    const params: (string | number)[] = [customerId];

    if (filter?.type !== undefined && filter.type.trim() !== '') {
      sql += ' AND type = ?';
      params.push(filter.type.trim());
    }

    if (filter?.from !== undefined && filter.from.trim() !== '') {
      sql += ' AND created_at >= ?';
      params.push(filter.from.trim());
    }

    if (filter?.to !== undefined && filter.to.trim() !== '') {
      sql += ' AND created_at <= ?';
      params.push(filter.to.trim());
    }

    sql += ' ORDER BY created_at DESC';

    if (filter?.limit !== undefined && filter.limit > 0) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        sql += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as unknown as RawMovementRow[];

    return rows.map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      type: r.type,
      amount: r.amount,
      balanceAfter: r.balance_after,
      description: r.description,
      saleId: r.sale_id,
      createdAt: r.created_at,
    }));
  }

  private mapCustomerRow(r: RawCustomerRow): CustomerRecord {
    const creditLimit = r.credit_limit ?? 0;
    const margin = r.margin ?? 0;
    const balance = r.balance ?? 0;
    const unrestricted = r.unrestricted === 1;

    return {
      id: r.id,
      name: r.name,
      document: r.document,
      phone: r.phone,
      creditLimit,
      margin,
      balance,
      availableCredit: unrestricted ? null : Math.max(0, creditLimit + margin - balance),
      unrestricted,
      isDebtor: balance > 0,
      blockedReason: r.blocked_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
