import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { z } from '../../shared/zod.ts';
import { applyToBalance, type LedgerMovement } from '../customer/account-ledger.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { jsonValue } from '../db/pg/sql-helpers.ts';
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

/** `kind` y `ref_type` son `text` en la base: se estrechan al leer. */
const kindSchema = z.enum(['unknown-customer', 'void-unknown-payment', 'void-customer-mismatch', 'void-duplicate']);
const refTypeSchema = z.enum(['sale', 'customer-payment']);

const ledgerSchema = z.object({
  type: z.enum(['sale', 'payment', 'payment-void', 'adjustment', 'interest']),
  delta: z.number(),
  description: z.string(),
  saleId: z.string().optional(),
});

/** Registra una discrepancia del push. Devuelve su id. */
export async function recordDiscrepancy(
  db: Kysely<TenantDatabase>,
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
): Promise<string> {
  const id = `disc_${randomUUID()}`;
  const pending =
    input.pending !== undefined
      ? jsonValue(input.pending)
      : input.voidsPaymentId !== undefined
        ? jsonValue({ voidsPaymentId: input.voidsPaymentId })
        : null;
  await db
    .insertInto('discrepancies')
    .values({
      id,
      kind: input.kind,
      device_id: input.deviceId,
      origin_branch: input.originBranch,
      origin_pos: input.originPos,
      customer_id: input.customerId,
      ref_type: input.refType,
      ref_id: input.refId,
      amount: input.amount,
      pending,
      created_at: now,
    })
    .execute();
  return id;
}

/** Resuelve una discrepancia abierta. `false` si ya estaba resuelta (o no existe): no la pisa. */
async function resolve(
  db: Kysely<TenantDatabase>,
  id: string,
  resolution: 'applied' | 'dismissed',
  by: string,
  note: string | null,
  now: string,
): Promise<boolean> {
  const updated = await db
    .updateTable('discrepancies')
    .set({ resolved_at: now, resolution, resolved_by: by, note })
    .where('id', '=', id)
    .where('resolved_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return updated !== undefined;
}

/**
 * El cliente ya existe: aplica sus movimientos pendientes en orden de llegada. Devuelve cuántos.
 * Corre en la transacción de quien llama (el alta del admin, el evento `customer` del push, la
 * importación) o, si no hay una, en la suya: el saldo y la discrepancia resuelta van juntos. Las
 * filas quedan bloqueadas mientras tanto, así dos altas a la vez no aplican dos veces lo mismo.
 */
export async function applyPendingFor(db: Kysely<TenantDatabase>, customerId: string, now: string): Promise<number> {
  if (!db.isTransaction) {
    return await db.transaction().execute(async (trx) => await applyPendingFor(trx, customerId, now));
  }
  const rows = await db
    .selectFrom('discrepancies')
    .select(['id', 'pending'])
    .where('customer_id', '=', customerId)
    .where('kind', '=', 'unknown-customer')
    .where('resolved_at', 'is', null)
    .orderBy('created_at')
    .orderBy('seq')
    .forUpdate()
    .execute();
  let applied = 0;
  for (const row of rows) {
    const parsed = ledgerSchema.safeParse(row.pending ?? undefined);
    if (!parsed.success || !(await applyToBalance(db, customerId, parsed.data, now))) {
      continue;
    }
    await resolve(db, row.id, 'applied', 'system', null, now);
    applied++;
  }
  return applied;
}

/** Llegó la cobranza original: las anulaciones que la esperaban quedan resueltas. */
export async function resolveVoidUnknown(db: Kysely<TenantDatabase>, paymentId: string, now: string): Promise<void> {
  await db
    .updateTable('discrepancies')
    .set({ resolved_at: now, resolution: 'applied', resolved_by: 'system' })
    .where('kind', '=', 'void-unknown-payment')
    .where('resolved_at', 'is', null)
    .where((eb) => eb(sql<string | null>`${eb.ref('pending')}->>'voidsPaymentId'`, '=', paymentId))
    .execute();
}

export async function listOpenDiscrepancies(db: Kysely<TenantDatabase>, filter?: { deviceId?: string | undefined }): Promise<Discrepancy[]> {
  let query = db
    .selectFrom('discrepancies')
    .select(['id', 'kind', 'device_id', 'origin_branch', 'origin_pos', 'customer_id', 'ref_type', 'ref_id', 'amount', 'created_at'])
    .where('resolved_at', 'is', null);
  if (filter?.deviceId !== undefined) {
    query = query.where('device_id', '=', filter.deviceId);
  }
  const rows = await query.orderBy('created_at').orderBy('seq').execute();
  return rows.map((r) => {
    const kind = kindSchema.parse(r.kind);
    const refType = refTypeSchema.parse(r.ref_type);
    return {
      id: r.id,
      kind,
      deviceId: r.device_id,
      originBranch: r.origin_branch,
      originPos: r.origin_pos,
      customerId: r.customer_id,
      refType,
      refId: r.ref_id,
      amount: r.amount,
      createdAt: r.created_at,
      message: discrepancyMessage({ kind, refType, amount: r.amount }),
    };
  });
}

/** Owner o admin la descartan con un motivo: una `unknown-customer` descartada no se aplica nunca. */
export async function dismissDiscrepancy(db: Kysely<TenantDatabase>, id: string, userId: string, note: string, now: string): Promise<void> {
  if (await resolve(db, id, 'dismissed', userId, note, now)) {
    return;
  }
  // No actualizó nada: o no existe o alguien la resolvió antes
  const row = await db.selectFrom('discrepancies').select('id').where('id', '=', id).executeTakeFirst();
  throw row === undefined ? new DomainError(404, 'La discrepancia no existe') : new DomainError(409, 'La discrepancia ya está resuelta');
}
