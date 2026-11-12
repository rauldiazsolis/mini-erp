import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';

const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CurrentSuspension = { since: string; reason: string; byName: string };

/** El período abierto de suspensión del comercio, si lo hay (#23), con quién lo suspendió. */
export async function currentSuspension(db: Kysely<SystemDatabase>, tenantId: string): Promise<CurrentSuspension | null> {
  const row = await db
    .selectFrom('tenant_suspensions as s')
    .leftJoin('users as u', 'u.id', 's.created_by')
    .select(['s.from_at', 's.reason', 'u.name as by_name'])
    .where('s.tenant_id', '=', tenantId)
    .where('s.to_at', 'is', null)
    .orderBy('s.from_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row === undefined ? null : { since: row.from_at, reason: row.reason, byName: row.by_name ?? 'Usuario borrado' };
}

export async function isSuspended(db: Kysely<SystemDatabase>, tenantId: string): Promise<boolean> {
  const row = await db
    .selectFrom('tenant_suspensions')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('to_at', 'is', null)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** Los días argentinos de `days` que tocan algún período de suspensión: no se cobran (#23). */
export async function suspendedDays(db: Kysely<SystemDatabase>, tenantId: string, days: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (days.length === 0) return out;
  const periods = await db.selectFrom('tenant_suspensions').select(['from_at', 'to_at']).where('tenant_id', '=', tenantId).execute();
  for (const day of days) {
    const start = Date.parse(`${day}T00:00:00.000Z`) + OFFSET_MS;
    const end = start + DAY_MS;
    if (periods.some((p) => Date.parse(p.from_at) < end && (p.to_at === null || Date.parse(p.to_at) > start))) out.add(day);
  }
  return out;
}
