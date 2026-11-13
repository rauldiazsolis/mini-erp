import { randomUUID } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { isForeignKeyViolation, isUniqueViolation, searchable, searchPattern } from '../db/pg/sql-helpers.ts';
import { applyPendingFor } from '../discrepancy/discrepancies.ts';
import { DomainError } from '../errors.ts';
import { saveCustomerPayment } from '../sales/records.ts';
import { postToBalance, roundMoney } from './account-ledger.ts';

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
  id?: string | undefined;
  name: string;
  document?: string | null | undefined;
  phone?: string | null | undefined;
  creditLimit?: number | undefined;
  margin?: number | undefined;
  unrestricted?: boolean | undefined;
  initialBalance?: number | undefined;
  blockedReason?: string | null | undefined;
};

export type UpdateCustomerInput = {
  name?: string | undefined;
  document?: string | null | undefined;
  phone?: string | null | undefined;
  creditLimit?: number | undefined;
  margin?: number | undefined;
  unrestricted?: boolean | undefined;
  blockedReason?: string | null | undefined;
};

export type CustomerFilter = {
  search?: string | undefined;
  debtorsOnly?: boolean | undefined;
  blocked?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export type RegisterPaymentInput = {
  amount: number;
  method?: string | undefined;
  reference?: string | undefined;
  description?: string | undefined;
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
  type?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
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

const CUSTOMER_COLUMNS = [
  'id', 'name', 'document', 'phone', 'credit_limit', 'margin', 'balance', 'unrestricted', 'blocked_reason', 'created_at', 'updated_at',
] as const;

type CustomerRow = Pick<Selectable<TenantDatabase['customers']>, (typeof CUSTOMER_COLUMNS)[number]>;

function notFound(customerId: string): DomainError {
  return new DomainError(404, `Cliente '${customerId}' no encontrado`);
}

/** Un instante de un filtro, como lo compara `timestamptz`. Un día solo (`2026-10-01`) es su medianoche UTC. */
function filterInstant(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new DomainError(400, 'Fecha inválida');
  }
  return new Date(ms).toISOString();
}

export class CustomerService {
  private db: Kysely<TenantDatabase>;

  constructor(db: Kysely<TenantDatabase>) {
    this.db = db;
  }

  // --- CRUD CLIENTES ---

  async listCustomers(filter?: CustomerFilter): Promise<CustomerRecord[]> {
    let query = this.db.selectFrom('customers').select(CUSTOMER_COLUMNS);

    if (filter?.debtorsOnly === true) {
      query = query.where('balance', '>', 0);
    }

    if (filter?.blocked !== undefined) {
      query = query.where('blocked_reason', filter.blocked ? 'is not' : 'is', null);
    }

    if (filter?.search !== undefined && filter.search.trim() !== '') {
      const pattern = searchPattern(filter.search.trim());
      query = query.where((eb) =>
        eb.or([
          eb(searchable(eb.ref('name')), 'like', pattern),
          eb(searchable(eb.ref('document')), 'like', pattern),
          eb(searchable(eb.ref('phone')), 'like', pattern),
        ]),
      );
    }

    // Con id de desempate: dos clientes con el mismo nombre salen siempre en el mismo orden
    query = query.orderBy('name').orderBy('id');

    if (filter?.limit !== undefined && filter.limit > 0) {
      query = query.limit(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        query = query.offset(filter.offset);
      }
    }

    const rows = await query.execute();
    return rows.map((r) => this.mapCustomerRow(r));
  }

  async getCustomer(id: string, db: Kysely<TenantDatabase> = this.db): Promise<CustomerRecord | undefined> {
    const row = await db.selectFrom('customers').select(CUSTOMER_COLUMNS).where('id', '=', id).executeTakeFirst();
    return row === undefined ? undefined : this.mapCustomerRow(row);
  }

  async createCustomer(data: CreateCustomerInput): Promise<CustomerRecord> {
    const id = data.id ?? `cust_${randomUUID()}`;
    const now = new Date().toISOString();
    const initialBalance = data.initialBalance ?? 0;

    try {
      return await this.db.transaction().execute(async (trx) => {
        await trx
          .insertInto('customers')
          .values({
            id,
            name: data.name,
            document: data.document ?? null,
            phone: data.phone ?? null,
            credit_limit: data.creditLimit ?? 0,
            margin: data.margin ?? 0,
            balance: 0,
            unrestricted: data.unrestricted === true,
            blocked_reason: data.blockedReason ?? null,
            created_at: now,
            updated_at: now,
          })
          .execute();

        // El saldo inicial pasa por el libro, como cualquier otro movimiento
        if (initialBalance !== 0) {
          await postToBalance(trx, id, { type: 'adjustment', delta: initialBalance, description: 'Saldo inicial registrado' }, now);
        }

        // Lo que una caja le vendió o cobró antes de que existiera queda aplicado (#2)
        await applyPendingFor(trx, id, now);

        const created = await this.getCustomer(id, trx);
        if (created === undefined) {
          throw new Error(`No se encontró el cliente recién creado (${id})`);
        }
        return created;
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new DomainError(409, 'Ya existe un cliente con ese id');
      }
      throw err;
    }
  }

  async updateCustomer(id: string, data: UpdateCustomerInput): Promise<CustomerRecord | undefined> {
    const row = await this.db
      .updateTable('customers')
      .set({
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.document === undefined ? {} : { document: data.document }),
        ...(data.phone === undefined ? {} : { phone: data.phone }),
        ...(data.creditLimit === undefined ? {} : { credit_limit: data.creditLimit }),
        ...(data.margin === undefined ? {} : { margin: data.margin }),
        ...(data.unrestricted === undefined ? {} : { unrestricted: data.unrestricted }),
        ...(data.blockedReason === undefined ? {} : { blocked_reason: data.blockedReason }),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', id)
      .returning(CUSTOMER_COLUMNS)
      .executeTakeFirst();
    return row === undefined ? undefined : this.mapCustomerRow(row);
  }

  async deleteCustomer(id: string, options?: { hard?: boolean | undefined; blockedReason?: string | undefined }): Promise<CustomerRecord | { deleted: boolean }> {
    if (options?.hard === true) {
      // Sin leer antes: la FK de la cuenta corriente y de las reservas es la que decide (spec, fase 4)
      let deleted: { id: string } | undefined;
      try {
        deleted = await this.db.deleteFrom('customers').where('id', '=', id).returning('id').executeTakeFirst();
      } catch (err: unknown) {
        if (isForeignKeyViolation(err)) {
          throw new DomainError(409, 'El cliente tiene movimientos: archivalo');
        }
        throw err;
      }
      if (deleted === undefined) {
        throw notFound(id);
      }
      return { deleted: true };
    }

    const reason = options?.blockedReason ?? 'Archivado por administración';
    const updated = await this.updateCustomer(id, { blockedReason: reason });
    if (!updated) {
      throw notFound(id);
    }
    return updated;
  }

  // --- COBRANZAS Y PAGOS ---

  async registerPayment(customerId: string, input: RegisterPaymentInput): Promise<PaymentResult> {
    if (input.amount <= 0) {
      throw new DomainError(400, 'El monto del pago debe ser mayor a cero');
    }

    const now = new Date().toISOString();
    const paymentId = `pay_${randomUUID()}`;
    const description = input.description ?? (input.reference ? `Cobranza ref. ${input.reference}` : 'Cobranza manual');

    return await this.db.transaction().execute(async (trx) => {
      // 1. Asiento en cuenta corriente (negativo: baja la deuda) y saldo, juntos
      const posted = await postToBalance(trx, customerId, { type: 'payment', delta: -input.amount, description }, now);
      if (posted === undefined) {
        throw notFound(customerId);
      }

      // 2. Registro formal en customer_payments, con la forma del contrato (#20)
      await saveCustomerPayment(
        trx,
        {
          id: paymentId,
          customerId,
          payments: [
            {
              method: input.method ?? 'cash',
              amount: input.amount,
              ...(input.reference === undefined ? {} : { reference: input.reference }),
            },
          ],
          total: input.amount,
          createdAt: now,
        },
        { deviceId: 'admin_panel', branch: 'ADMIN', pointOfSale: 'Oficina' },
        now,
      );

      return {
        customerId,
        previousBalance: posted.previousBalance,
        amount: input.amount,
        newBalance: posted.balanceAfter,
        movementId: posted.movementId,
        updatedAt: now,
      };
    });
  }

  // --- AJUSTES TRANSPARENTES DE SALDO ---

  async adjustBalance(customerId: string, input: AdjustBalanceInput): Promise<AdjustBalanceResult> {
    if (input.amount < 0) {
      throw new DomainError(400, 'El monto no puede ser negativo');
    }

    if (!input.reason || input.reason.trim() === '') {
      throw new DomainError(400, 'El motivo del ajuste es obligatorio para auditoría contable');
    }

    const now = new Date().toISOString();
    const description = input.reason.trim();

    return await this.db.transaction().execute(async (trx) => {
      let delta: number;
      if (input.type === 'credit') {
        delta = -input.amount;
      } else if (input.type === 'debit') {
        delta = input.amount;
      } else {
        // 'set': la diferencia contra el saldo de ahora, con la fila bloqueada hasta el commit
        const current = await trx.selectFrom('customers').select('balance').where('id', '=', customerId).forUpdate().executeTakeFirst();
        if (current === undefined) {
          throw notFound(customerId);
        }
        delta = roundMoney(input.amount - (current.balance ?? 0));
      }

      const posted = await postToBalance(trx, customerId, { type: 'adjustment', delta, description }, now);
      if (posted === undefined) {
        throw notFound(customerId);
      }

      return {
        customerId,
        previousBalance: posted.previousBalance,
        delta: posted.amount,
        newBalance: posted.balanceAfter,
        movementId: posted.movementId,
        updatedAt: now,
      };
    });
  }

  // --- EXTRACTO DE CUENTA CORRIENTE ---

  async listMovements(customerId: string, filter?: MovementFilter): Promise<AccountMovementRecord[]> {
    let query = this.db
      .selectFrom('account_movements')
      .select(['id', 'customer_id', 'type', 'amount', 'balance_after', 'description', 'sale_id', 'created_at'])
      .where('customer_id', '=', customerId);

    if (filter?.type !== undefined && filter.type.trim() !== '') {
      query = query.where('type', '=', filter.type.trim());
    }

    if (filter?.from !== undefined && filter.from.trim() !== '') {
      query = query.where('created_at', '>=', filterInstant(filter.from.trim()));
    }

    if (filter?.to !== undefined && filter.to.trim() !== '') {
      query = query.where('created_at', '<=', filterInstant(filter.to.trim()));
    }

    // Con `seq` de desempate: el extracto se pide por tramos (#87) y, entre movimientos del mismo
    // instante, el último que se escribió sale primero
    query = query.orderBy('created_at', 'desc').orderBy('seq', 'desc');

    if (filter?.limit !== undefined && filter.limit > 0) {
      query = query.limit(filter.limit);
      if (filter.offset !== undefined && filter.offset > 0) {
        query = query.offset(filter.offset);
      }
    }

    const rows = await query.execute();

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

  private mapCustomerRow(r: CustomerRow): CustomerRecord {
    const creditLimit = r.credit_limit ?? 0;
    const margin = r.margin ?? 0;
    const balance = r.balance ?? 0;

    return {
      id: r.id,
      name: r.name,
      document: r.document,
      phone: r.phone,
      creditLimit,
      margin,
      balance,
      availableCredit: r.unrestricted ? null : Math.max(0, creditLimit + margin - balance),
      unrestricted: r.unrestricted,
      isDebtor: balance > 0,
      blockedReason: r.blocked_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
