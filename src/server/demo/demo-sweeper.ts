import type { DemoSessionService } from './demo-session-service.ts';
import type { DemoResetService } from './demo-reset-service.ts';
import { SYSTEM_ACTOR, type AuditLog } from '../audit/audit-log.ts';
import { DEMO_COMMERCES } from '../seeds/index.ts';

/**
 * El barrido de demos (#24), al arrancar y cada `intervalMs`, sin mantener vivo el proceso: borra las
 * demos de antes de M8, hace el reinicio automático, revoca las cajas inactivas y repone stock.
 */
export async function startDemoSweeper(
  p: { sessions: DemoSessionService; resets: DemoResetService; audit?: AuditLog | undefined },
  intervalMs: number,
): Promise<NodeJS.Timeout> {
  const sweep = async (always: boolean): Promise<void> => {
    const legacy = await p.sessions.sweepLegacy();
    const reset = await p.resets.runDue();
    // El reinicio automático también queda en el registro, sin persona (#24)
    for (const template of reset) {
      await p.audit?.record({ actorUserId: SYSTEM_ACTOR, tenantId: DEMO_COMMERCES[template].tenantId, action: 'demo.reset', details: { template, kind: 'full', automatic: true } });
    }
    const idle = await p.sessions.revokeIdle();
    const restocked = await p.resets.restock();
    if (always || legacy + reset.length + idle + restocked > 0) {
      console.log(
        `[demos] barrido: ${String(legacy)} demos de antes borradas, reinicio automático: ${reset.length === 0 ? 'ninguno' : reset.join(', ')}, ` +
          `${String(idle)} cajas inactivas revocadas, ${String(restocked)} productos repuestos`,
      );
    }
  };
  // El primero termina antes de seguir con el arranque, como cuando era síncrono
  await sweep(true);
  const timer = setInterval(() => {
    void (async () => {
      try {
        await sweep(false);
      } catch (err: unknown) {
        console.error('[demos] falló el barrido:', err);
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}
