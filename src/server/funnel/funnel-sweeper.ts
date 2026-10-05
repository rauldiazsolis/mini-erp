import type { FunnelService } from './funnel-service.ts';

/** La retención del embudo (#25), al arrancar y cada `intervalMs`. Loguea solo cuando borra algo. */
export function startFunnelSweeper(funnel: FunnelService, intervalMs: number): NodeJS.Timeout {
  const sweep = (): void => {
    try {
      const { events, contacts } = funnel.sweep();
      if (events + contacts > 0) {
        console.log(`[embudo] barrido: ${String(events)} eventos viejos borrados, ${String(contacts)} contactos viejos anonimizados`);
      }
    } catch (err: unknown) {
      console.error('[embudo] barrido falló:', err);
    }
  };
  sweep();
  const timer = setInterval(sweep, intervalMs);
  timer.unref();
  return timer;
}
