import { sql } from 'kysely';
import type { Database } from '../../src/server/db/pg/database.ts';

/**
 * Espera a que alguna consulta de esta base quede esperando un bloqueo de otra transacción: para
 * armar una carrera a propósito (dos operaciones que escriben lo mismo) sin depender de un `sleep`.
 */
export async function waitForBlockedQuery(db: Database, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await sql<{ n: number }>`
      SELECT count(*) AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`.execute(db.root);
    if ((rows[0]?.n ?? 0) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Ninguna consulta quedó esperando un bloqueo');
}
