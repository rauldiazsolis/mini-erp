import type { DatabaseSync } from 'node:sqlite';

const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** El período abierto de suspensión del comercio, si lo hay (#23). */
export function currentSuspension(db: DatabaseSync, tenantId: string): { since: string; reason: string } | null {
  const row = db
    .prepare('SELECT from_at, reason FROM tenant_suspensions WHERE tenant_id = ? AND to_at IS NULL ORDER BY from_at DESC LIMIT 1')
    .get(tenantId) as { from_at: string; reason: string } | undefined;
  return row === undefined ? null : { since: row.from_at, reason: row.reason };
}

export function isSuspended(db: DatabaseSync, tenantId: string): boolean {
  return currentSuspension(db, tenantId) !== null;
}

/** Los días argentinos de `days` que tocan algún período de suspensión: no se cobran (#23). */
export function suspendedDays(db: DatabaseSync, tenantId: string, days: readonly string[]): Set<string> {
  const periods = db.prepare('SELECT from_at, to_at FROM tenant_suspensions WHERE tenant_id = ?').all(tenantId) as {
    from_at: string;
    to_at: string | null;
  }[];
  const out = new Set<string>();
  for (const day of days) {
    const start = Date.parse(`${day}T00:00:00.000Z`) + OFFSET_MS;
    const end = start + DAY_MS;
    if (periods.some((p) => Date.parse(p.from_at) < end && (p.to_at === null || Date.parse(p.to_at) > start))) out.add(day);
  }
  return out;
}
