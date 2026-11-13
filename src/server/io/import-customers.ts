import { randomUUID } from 'node:crypto';
import type { Transaction, Updateable } from 'kysely';
import { normalizeDocument, normalizeHeader, parseBool } from './csv.ts';
import { parseMoneyCell, writeRow } from './import-row.ts';
import { postToBalance, roundMoney } from '../customer/account-ledger.ts';
import { applyPendingFor } from '../discrepancy/discrepancies.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import type { RowContext } from './import-service.ts';
import type { ImportRowResult } from '../../shared/import-fields.ts';

export const OPENING_IMPORTED = 'Saldo inicial (importado)';
export const OPENING_CORRECTION = 'Saldo inicial (corrección)';
const BALANCE_KEPT = 'Tiene movimientos posteriores: el saldo no se cambia';

/** Un cliente como está en la base, en memoria mientras dura la importación. */
type Customer = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  creditLimit: number;
  margin: number;
  balance: number;
  unrestricted: boolean;
  blockedReason: string | null;
};

/** Lo que trae la fila, ya convertido; un campo ausente no se toca. */
type Parsed = {
  name?: string;
  document?: string;
  phone?: string;
  creditLimit?: number;
  margin?: number;
  balance?: number;
  unrestricted?: boolean;
  blockedReason?: string;
};

const text = (v: string | undefined): string | undefined => (v === undefined || v === '' ? undefined : v);

function parseRow(row: RowContext): { data: Parsed; errors: string[] } {
  const errors: string[] = [];
  const amount = (label: string, v: string | undefined, nonNegative: boolean): number | undefined =>
    v === undefined || v === '' ? undefined : parseMoneyCell(label, v, row.decimal, nonNegative, errors);
  const name = text(row.get('name'));
  const document = text(row.get('document'));
  const phone = text(row.get('phone'));
  const blockedReason = text(row.get('blockedReason'));
  const creditLimit = amount('Límite de crédito', row.get('creditLimit'), true);
  const margin = amount('Margen', row.get('margin'), true);
  const balance = amount('Saldo', row.get('balance'), false);
  const rawUnrestricted = text(row.get('unrestricted'));
  const unrestricted = rawUnrestricted === undefined ? undefined : parseBool(rawUnrestricted);
  if (rawUnrestricted !== undefined && unrestricted === undefined) errors.push('Sin restricción: tiene que ser sí o no');
  return {
    data: {
      ...(name === undefined ? {} : { name }),
      ...(document === undefined ? {} : { document }),
      ...(phone === undefined ? {} : { phone }),
      ...(creditLimit === undefined ? {} : { creditLimit }),
      ...(margin === undefined ? {} : { margin }),
      ...(balance === undefined ? {} : { balance }),
      ...(unrestricted === undefined ? {} : { unrestricted }),
      ...(blockedReason === undefined ? {} : { blockedReason }),
    },
    errors,
  };
}

/**
 * Los clientes del comercio en memoria: la importación busca las coincidencias acá (por id,
 * documento sin puntos ni guiones o nombre normalizado) y los va actualizando con cada fila que se
 * escribe, así una fila ve lo que dejó la anterior sin volver a consultar la base.
 */
class Customers {
  private customers = new Map<string, Customer>();
  private byDocument = new Map<string, Set<string>>();
  private byName = new Map<string, Set<string>>();

  static async load(trx: Transaction<TenantDatabase>): Promise<Customers> {
    const customers = new Customers();
    const rows = await trx
      .selectFrom('customers')
      .select(['id', 'name', 'document', 'phone', 'credit_limit', 'margin', 'balance', 'unrestricted', 'blocked_reason'])
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    for (const r of rows) {
      customers.put({
        id: r.id,
        name: r.name,
        document: r.document,
        phone: r.phone,
        creditLimit: r.credit_limit ?? 0,
        margin: r.margin ?? 0,
        balance: r.balance ?? 0,
        unrestricted: r.unrestricted,
        blockedReason: r.blocked_reason,
      });
    }
    return customers;
  }

  get(id: string): Customer | undefined {
    return this.customers.get(id);
  }

  /** El primero con ese documento (el más viejo). */
  idByDocument(document: string): string | undefined {
    const [first] = this.byDocument.get(normalizeDocument(document)) ?? [];
    return first;
  }

  idsByName(name: string): string[] {
    return [...(this.byName.get(normalizeHeader(name)) ?? [])];
  }

  /** Agrega un cliente o reemplaza el que había con ese id, con sus índices. */
  put(customer: Customer): void {
    const previous = this.customers.get(customer.id);
    if (previous !== undefined) {
      if (previous.document !== null) this.byDocument.get(normalizeDocument(previous.document))?.delete(customer.id);
      this.byName.get(normalizeHeader(previous.name))?.delete(customer.id);
    }
    this.customers.set(customer.id, customer);
    if (customer.document !== null) {
      const documentKey = normalizeDocument(customer.document);
      this.byDocument.set(documentKey, (this.byDocument.get(documentKey) ?? new Set()).add(customer.id));
    }
    const nameKey = normalizeHeader(customer.name);
    this.byName.set(nameKey, (this.byName.get(nameKey) ?? new Set()).add(customer.id));
  }
}

/**
 * Clientes (#22): se reconocen por id, documento (sin puntos ni guiones) o, sin ninguno de los dos,
 * nombre normalizado. El saldo de un cliente nuevo entra como "Saldo inicial (importado)"; al
 * reimportar se corrige solo si todos sus movimientos son de importación (`opening`). Corre en la
 * transacción de la importación y cada fila escribe en su `SAVEPOINT`.
 */
export async function importCustomers(trx: Transaction<TenantDatabase>, rows: RowContext[], now: string): Promise<ImportRowResult[]> {
  const customers = await Customers.load(trx);
  const seen = new Map<string, number>();
  const results: ImportRowResult[] = [];
  const fail = (row: RowContext, key: string, message: string): void => {
    results.push({ line: row.line, key, action: 'error', messages: [message] });
  };

  for (const row of rows) {
    const id = text(row.get('id')?.trim());
    const { data, errors } = parseRow(row);
    const key = data.document ?? data.name ?? id ?? '';
    const identity =
      id !== undefined
        ? `id:${id}`
        : data.document !== undefined
          ? `doc:${normalizeDocument(data.document)}`
          : data.name !== undefined
            ? `name:${normalizeHeader(data.name)}`
            : undefined;
    if (identity === undefined) {
      fail(row, key, 'La fila no tiene nombre, documento ni id');
      continue;
    }
    const previous = seen.get(identity);
    if (previous !== undefined) {
      fail(row, key, `Repetida: ver la línea ${String(previous)}`);
      continue;
    }
    if (errors.length > 0) {
      results.push({ line: row.line, key, action: 'error', messages: errors });
      continue;
    }
    let existingId: string | undefined;
    if (id !== undefined) {
      existingId = customers.get(id)?.id;
    } else if (data.document !== undefined) {
      existingId = customers.idByDocument(data.document);
    } else if (data.name !== undefined) {
      const matches = customers.idsByName(data.name);
      if (matches.length > 1) {
        fail(row, key, `Hay ${String(matches.length)} clientes con ese nombre`);
        continue;
      }
      existingId = matches[0];
    }
    const current = existingId === undefined ? undefined : customers.get(existingId);

    if (current === undefined) {
      if (data.name === undefined) {
        fail(row, key, 'Falta el nombre para crearlo');
        continue;
      }
      const created: Customer = {
        id: id ?? `cust_${randomUUID()}`,
        name: data.name,
        document: data.document ?? null,
        phone: data.phone ?? null,
        creditLimit: data.creditLimit ?? 0,
        margin: data.margin ?? 0,
        balance: 0,
        unrestricted: data.unrestricted === true,
        blockedReason: data.blockedReason ?? null,
      };
      const opening = data.balance ?? 0;
      const failure = await writeRow(trx, row.line, async () => {
        await trx
          .insertInto('customers')
          .values({
            id: created.id,
            name: created.name,
            document: created.document,
            phone: created.phone,
            credit_limit: created.creditLimit,
            margin: created.margin,
            balance: 0,
            unrestricted: created.unrestricted,
            blocked_reason: created.blockedReason,
            created_at: now,
            updated_at: now,
          })
          .execute();
        if (opening !== 0) {
          await postToBalance(trx, created.id, { type: 'opening', delta: opening, description: OPENING_IMPORTED }, now);
        }
        // Lo que una caja le vendió o cobró antes de que existiera queda aplicado (#2)
        const pending = await applyPendingFor(trx, created.id, now);
        created.balance = opening;
        if (pending > 0) {
          const saved = await trx.selectFrom('customers').select('balance').where('id', '=', created.id).executeTakeFirstOrThrow();
          created.balance = saved.balance ?? 0;
        }
      });
      if (failure !== undefined) {
        fail(row, key, failure);
        continue;
      }
      // Solo una fila que se aplica "ocupa" la clave: corregida más abajo en el mismo archivo, entra
      seen.set(identity, row.line);
      customers.put(created);
      results.push({ line: row.line, key, action: 'create', messages: [] });
      continue;
    }

    // `20123456` no pisa `20.123.456`: es el mismo documento
    const sameDocument = data.document === undefined || normalizeDocument(data.document) === normalizeDocument(current.document ?? '');
    const updated: Customer = {
      ...current,
      ...(data.name === undefined ? {} : { name: data.name }),
      ...(data.document === undefined || sameDocument ? {} : { document: data.document }),
      ...(data.phone === undefined ? {} : { phone: data.phone }),
      ...(data.creditLimit === undefined ? {} : { creditLimit: data.creditLimit }),
      ...(data.margin === undefined ? {} : { margin: data.margin }),
      ...(data.unrestricted === undefined ? {} : { unrestricted: data.unrestricted }),
      ...(data.blockedReason === undefined ? {} : { blockedReason: data.blockedReason }),
    };
    // Solo los campos mapeados que cambian
    const changes: Updateable<TenantDatabase['customers']> = {
      ...(updated.name === current.name ? {} : { name: updated.name }),
      ...(updated.document === current.document ? {} : { document: updated.document }),
      ...(updated.phone === current.phone ? {} : { phone: updated.phone }),
      ...(updated.creditLimit === current.creditLimit ? {} : { credit_limit: updated.creditLimit }),
      ...(updated.margin === current.margin ? {} : { margin: updated.margin }),
      ...(updated.unrestricted === current.unrestricted ? {} : { unrestricted: updated.unrestricted }),
      ...(updated.blockedReason === current.blockedReason ? {} : { blocked_reason: updated.blockedReason }),
    };
    const fieldsChanged = Object.keys(changes).length > 0;
    const diff = data.balance === undefined ? 0 : roundMoney(data.balance - current.balance);
    const messages: string[] = [];
    const outcome = { balanceChanged: false };

    if (fieldsChanged || diff !== 0) {
      const failure = await writeRow(trx, row.line, async () => {
        if (fieldsChanged) {
          await trx.updateTable('customers').set({ ...changes, updated_at: now }).where('id', '=', current.id).execute();
        }
        if (diff === 0) return;
        const foreign = await trx
          .selectFrom('account_movements')
          .select('id')
          .where('customer_id', '=', current.id)
          .where('type', '!=', 'opening')
          .limit(1)
          .executeTakeFirst();
        if (foreign !== undefined) return;
        const posted = await postToBalance(trx, current.id, { type: 'opening', delta: diff, description: OPENING_CORRECTION }, now);
        if (posted !== undefined) {
          updated.balance = posted.balanceAfter;
          outcome.balanceChanged = true;
        }
      });
      if (failure !== undefined) {
        fail(row, key, failure);
        continue;
      }
      if (diff !== 0 && !outcome.balanceChanged) messages.push(BALANCE_KEPT);
      customers.put(updated);
    }
    seen.set(identity, row.line);
    results.push({ line: row.line, key, action: fieldsChanged || outcome.balanceChanged ? 'update' : 'unchanged', messages });
  }
  return results;
}
