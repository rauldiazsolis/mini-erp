import type { DemoSessionService } from './demo-session-service.ts';
import type { DemoResetService } from './demo-reset-service.ts';
import { SYSTEM_ACTOR, type AuditLog } from '../audit/audit-log.ts';
import { DEMO_COMMERCES } from '../seeds/index.ts';

/**
 * El barrido de demos (#24), al arrancar y cada `intervalMs`, sin mantener vivo el proceso: borra las
 * demos de antes de M8, hace el reinicio automático, revoca las cajas inactivas y repone stock.
 */
export function startDemoSweeper(
  p: { sessions: DemoSessionService; resets: DemoResetService; audit?: AuditLog | undefined },
  intervalMs: number,
): NodeJS.Timeout {
  const sweep = (always: boolean): void => {
    const legacy = p.sessions.sweepLegacy();
    const reset = p.resets.runDue();
    // El reinicio automático también queda en el registro, sin persona (#24)
    for (const template of reset) {
      p.audit?.record({ actorUserId: SYSTEM_ACTOR, tenantId: DEMO_COMMERCES[template].tenantId, action: 'demo.reset', details: { template, kind: 'full', automatic: true } });
    }
    const idle = p.sessions.revokeIdle();
    const restocked = p.resets.restock();
    if (always || legacy + reset.length + idle + restocked > 0) {
      console.log(
        `[demos] barrido: ${String(legacy)} demos de antes borradas, reinicio automático: ${reset.length === 0 ? 'ninguno' : reset.join(', ')}, ` +
          `${String(idle)} cajas inactivas revocadas, ${String(restocked)} productos repuestos`,
      );
    }
  };
  sweep(true);
  const timer = setInterval(() => {
    sweep(false);
  }, intervalMs);
  timer.unref();
  return timer;
}
