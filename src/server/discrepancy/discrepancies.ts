import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { applyToBalance, type LedgerMovement } from '../customer/account-ledger.ts';
import { DomainError } from '../errors.ts';
import { discrepancyMessage, type DiscrepancyKind, type DiscrepancyRefType } from './messages.ts';

export type { DiscrepancyKind, DiscrepancyRefType } from './messages.ts';

export type Discrepancy = {
  id: string;
  kind: DiscrepancyKind;
  deviceId: string | null;
  originBranch: string | null;
  originPos: string | null;
  customerId: string;
  refType: DiscrepancyRefType;
  refId: string;
  amount: number;
  createdAt: string;
  message: string;
};

type Row = {
  id: string; kind: DiscrepancyKind; device_id: string | null; origin_branch: string | null; origin_pos: string | null;
  customer_id: string; ref_type: DiscrepancyRefType; ref_id: string; amount: number; pending: string | null; created_at: string;
};

const ledgerSchema = z.object({
  type: z.enum(['sale', 'payment', 'payment-void', 'adjustment', 'interest']),
  delta: z.number(),
  description: z.string(),
  saleId: z.string().optional(),
});

/** Registra una discrepancia del push. Devuelve su id. */
export function recordDiscrepancy(
  db: DatabaseSync,
  input: {
    kind: DiscrepancyKind;
    deviceId: string | null;
    originBranch: string | null;
    originPos: string | null;
    customerId: string;
    refType: DiscrepancyRefType;
    refId: string;
    amount: number;
    pending?: LedgerMovement | undefined;
    voidsPaymentId?: string | undefined;
  },
  now: string,
): string {
  const id = `disc_${randomUUID()}`;
  const pending =
    input.pending !== undefined
      ? JSON.stringify(input.pending)
      : input.voidsPaymentId !== undefined
        ? JSON.stringify({ voidsPaymentId: input.voidsPaymentId })
        : null;
  db.prepare(
    `INSERT INTO discrepancies (id, kind, device_id, origin_branch, origin_pos, customer_id, ref_type, ref_id, amount, pending, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.kind, input.deviceId, input.originBranch, input.originPos, input.customerId, input.refType, input.refId, input.amount, pending, now);
  return id;
}

function resolve(db: DatabaseSync, id: string, resolution: 'applied' | 'dismissed', by: string, note: string | null, now: string): void {
  db.prepare('UPDATE discrepancies SET resolved_at = ?, resolution = ?, resolved_by = ?, note = ? WHERE id = ?')
    .run(now, resolution, by, note, id);
}

/** El cliente ya existe: aplica sus movimientos pendientes en orden de llegada. Devuelve cuántos. */
export function applyPendingFor(db: DatabaseSync, customerId: string, now: string): number {
  const rows = db
    .prepare("SELECT id, pending FROM discrepancies WHERE customer_id = ? AND kind = 'unknown-customer' AND resolved_at IS NULL ORDER BY created_at, rowid")
    .all(customerId) as { id: string; pending: string | null }[];
  let applied = 0;
  for (const row of rows) {
    const parsed = ledgerSchema.safeParse(row.pending === null ? undefined : JSON.parse(row.pending));
    if (!parsed.success || !applyToBalance(db, customerId, parsed.data, now)) {
      continue;
    }
    resolve(db, row.id, 'applied', 'system', null, now);
    applied++;
  }
  return applied;
}

/** Llegó la cobranza original: las anulaciones que la esperaban quedan resueltas. */
export function resolveVoidUnknown(db: DatabaseSync, paymentId: string, now: string): void {
  db.prepare(
    `UPDATE discrepancies SET resolved_at = ?, resolution = 'applied', resolved_by = 'system'
     WHERE kind = 'void-unknown-payment' AND resolved_at IS NULL AND json_extract(pending, '$.voidsPaymentId') = ?`,
  ).run(now, paymentId);
}

export function listOpenDiscrepancies(db: DatabaseSync, filter?: { deviceId?: string | undefined }): Discrepancy[] {
  const rows = (
    filter?.deviceId === undefined
      ? db.prepare('SELECT * FROM discrepancies WHERE resolved_at IS NULL ORDER BY created_at, rowid').all()
      : db.prepare('SELECT * FROM discrepancies WHERE resolved_at IS NULL AND device_id = ? ORDER BY created_at, rowid').all(filter.deviceId)
  ) as Row[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    deviceId: r.device_id,
    originBranch: r.origin_branch,
    originPos: r.origin_pos,
    customerId: r.customer_id,
    refType: r.ref_type,
    refId: r.ref_id,
    amount: r.amount,
    createdAt: r.created_at,
    message: discrepancyMessage({ kind: r.kind, refType: r.ref_type, amount: r.amount }),
  }));
}

/** Owner o admin la descartan con un motivo: una `unknown-customer` descartada no se aplica nunca. */
export function dismissDiscrepancy(db: DatabaseSync, id: string, userId: string, note: string, now: string): void {
  const row = db.prepare('SELECT resolved_at FROM discrepancies WHERE id = ?').get(id) as { resolved_at: string | null } | undefined;
  if (row === undefined) {
    throw new DomainError(404, 'La discrepancia no existe');
  }
  if (row.resolved_at !== null) {
    throw new DomainError(409, 'La discrepancia ya está resuelta');
  }
  resolve(db, id, 'dismissed', userId, note, now);
}
