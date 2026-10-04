import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeDocument, normalizeHeader, parseAmount, parseBool } from './csv.ts';
import { applyToBalance } from '../customer/account-ledger.ts';
import { applyPendingFor } from '../discrepancy/discrepancies.ts';
import type { RowContext } from './import-service.ts';
import type { ImportRowResult } from '../../shared/import-fields.ts';

export const OPENING_IMPORTED = 'Saldo inicial (importado)';
export const OPENING_CORRECTION = 'Saldo inicial (corrección)';
const BALANCE_KEPT = 'Tiene movimientos posteriores: el saldo no se cambia';

type CustomerRow = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  credit_limit: number | null;
  margin: number | null;
  balance: number | null;
  unrestricted: number;
  blocked_reason: string | null;
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
  const amount = (label: string, v: string | undefined, nonNegative: boolean): number | undefined => {
    if (v === undefined || v === '') return undefined;
    const n = parseAmount(v, row.decimal);
    if (n === undefined) errors.push(`${label}: no es un número`);
    else if (nonNegative && n < 0) errors.push(`${label}: no puede ser negativo`);
    return n;
  };
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
 * Clientes (#22): se reconocen por id, documento (sin puntos ni guiones) o, sin ninguno de los dos,
 * nombre normalizado. El saldo de un cliente nuevo entra como "Saldo inicial (importado)"; al
 * reimportar se corrige solo si todos sus movimientos son de importación (`opening`).
 */
export function importCustomers(db: DatabaseSync, rows: RowContext[], now: string): ImportRowResult[] {
  const byName = new Map<string, string[]>();
  const rememberName = (name: string, id: string): void => {
    const key = normalizeHeader(name);
    byName.set(key, [...(byName.get(key) ?? []), id]);
  };
  for (const c of db.prepare('SELECT id, name FROM customers').all() as { id: string; name: string }[]) rememberName(c.name, c.id);
  const findByDocument = db.prepare(
    "SELECT id FROM customers WHERE REPLACE(REPLACE(REPLACE(document, '.', ''), '-', ''), ' ', '') = ?",
  );
  const getCustomer = db.prepare('SELECT * FROM customers WHERE id = ?');
  const foreignMovements = db.prepare("SELECT COUNT(*) AS n FROM account_movements WHERE customer_id = ? AND type != 'opening'");
  const seen = new Map<string, number>();
  const results: ImportRowResult[] = [];

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
      results.push({ line: row.line, key, action: 'error', messages: ['La fila no tiene nombre, documento ni id'] });
      continue;
    }
    const previous = seen.get(identity);
    if (previous !== undefined) {
      results.push({ line: row.line, key, action: 'error', messages: [`Repetida: ver la línea ${String(previous)}`] });
      continue;
    }
    if (errors.length > 0) {
      results.push({ line: row.line, key, action: 'error', messages: errors });
      continue;
    }
    let existingId: string | undefined;
    if (id !== undefined) {
      existingId = getCustomer.get(id) === undefined ? undefined : id;
    } else if (data.document !== undefined) {
      existingId = (findByDocument.get(normalizeDocument(data.document)) as { id: string } | undefined)?.id;
    } else if (data.name !== undefined) {
      const matches = byName.get(normalizeHeader(data.name)) ?? [];
      if (matches.length > 1) {
        results.push({ line: row.line, key, action: 'error', messages: [`Hay ${String(matches.length)} clientes con ese nombre`] });
        continue;
      }
      existingId = matches[0];
    }
    if (existingId === undefined) {
      if (data.name === undefined) {
        results.push({ line: row.line, key, action: 'error', messages: ['Falta el nombre para crearlo'] });
        continue;
      }
      // Solo una fila que se aplica "ocupa" la clave: corregida más abajo en el mismo archivo, entra
      seen.set(identity, row.line);
      const newId = id ?? `cust_${randomUUID()}`;
      db.prepare(
        `INSERT INTO customers (id, name, document, phone, credit_limit, margin, balance, unrestricted, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(
        newId,
        data.name,
        data.document ?? null,
        data.phone ?? null,
        data.creditLimit ?? 0,
        data.margin ?? 0,
        data.unrestricted === true ? 1 : 0,
        data.blockedReason ?? null,
        now,
        now,
      );
      if (data.balance !== undefined && data.balance !== 0) {
        applyToBalance(db, newId, { type: 'opening', delta: data.balance, description: OPENING_IMPORTED }, now);
      }
      // Lo que una caja le vendió o cobró antes de que existiera queda aplicado (#2)
      applyPendingFor(db, newId, now);
      rememberName(data.name, newId);
      results.push({ line: row.line, key, action: 'create', messages: [] });
      continue;
    }

    seen.set(identity, row.line);
    const current = getCustomer.get(existingId) as CustomerRow;
    const messages: string[] = [];
    // Nombres de columna fijos del código, nunca del archivo
    const changes: [string, string | number][] = [];
    if (data.name !== undefined && data.name !== current.name) changes.push(['name', data.name]);
    // `20123456` no pisa `20.123.456`: es el mismo documento
    if (data.document !== undefined && normalizeDocument(data.document) !== normalizeDocument(current.document ?? '')) {
      changes.push(['document', data.document]);
    }
    if (data.phone !== undefined && data.phone !== current.phone) changes.push(['phone', data.phone]);
    if (data.creditLimit !== undefined && data.creditLimit !== (current.credit_limit ?? 0)) changes.push(['credit_limit', data.creditLimit]);
    if (data.margin !== undefined && data.margin !== (current.margin ?? 0)) changes.push(['margin', data.margin]);
    if (data.unrestricted !== undefined && (data.unrestricted ? 1 : 0) !== current.unrestricted) {
      changes.push(['unrestricted', data.unrestricted ? 1 : 0]);
    }
    if (data.blockedReason !== undefined && data.blockedReason !== current.blocked_reason) changes.push(['blocked_reason', data.blockedReason]);
    if (changes.length > 0) {
      const sets = changes.map(([col]) => `${col} = ?`).join(', ');
      db.prepare(`UPDATE customers SET ${sets}, updated_at = ? WHERE id = ?`).run(...changes.map(([, v]) => v), now, existingId);
      if (data.name !== undefined) rememberName(data.name, existingId);
    }
    let balanceChanged = false;
    if (data.balance !== undefined) {
      const diff = Math.round((data.balance - (current.balance ?? 0)) * 100) / 100;
      if (diff !== 0) {
        const { n } = foreignMovements.get(existingId) as { n: number };
        if (n === 0) {
          applyToBalance(db, existingId, { type: 'opening', delta: diff, description: OPENING_CORRECTION }, now);
          balanceChanged = true;
        } else {
          messages.push(BALANCE_KEPT);
        }
      }
    }
    const changed = changes.length > 0 || balanceChanged;
    results.push({ line: row.line, key, action: changed ? 'update' : 'unchanged', messages });
  }
  return results;
}
