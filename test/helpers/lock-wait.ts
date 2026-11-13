import { sql, type Kysely } from 'kysely';

/**
 * Espera a que alguna conexión de esta base quede bloqueada esperando un candado de fila o de tabla
 * (`wait_event_type = 'Lock'`). Sirve para los tests de concurrencia: en vez de un timer a ojo, se
 * sabe que la otra transacción ya está esperando. Falla si no pasa en `timeoutMs`.
 */
export async function waitForLockWait(root: Kysely<unknown>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const waiting = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`.execute(root);
    if ((waiting.rows[0]?.n ?? 0) > 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error('waitForLockWait: ninguna conexión quedó esperando un candado');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
