import type { DatabaseSync } from 'node:sqlite';

const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CurrentSuspension = { since: string; reason: string; byName: string };

/** El período abierto de suspensión del comercio, si lo hay (#23), con quién lo suspendió. */
export function currentSuspension(db: DatabaseSync, tenantId: string): CurrentSuspension | null {
  const row = db
    .prepare(
      `SELECT s.from_at, s.reason, COALESCE(u.name, 'Usuario borrado') AS by_name
       FROM tenant_suspensions s LEFT JOIN users u ON u.id = s.created_by
       WHERE s.tenant_id = ? AND s.to_at IS NULL ORDER BY s.from_at DESC LIMIT 1`,
    )
    .get(tenantId) as { from_at: string; reason: string; by_name: string } | undefined;
  return row === undefined ? null : { since: row.from_at, reason: row.reason, byName: row.by_name };
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
