import type { FunnelService } from './funnel-service.ts';

/** La retención del embudo (#25), al arrancar y cada `intervalMs`. Loguea solo cuando borra algo. */
export async function startFunnelSweeper(funnel: FunnelService, intervalMs: number): Promise<NodeJS.Timeout> {
  // Nunca rechaza: un error queda en el log, como cuando era síncrono
  const sweep = async (): Promise<void> => {
    try {
      const { events, contacts } = await funnel.sweep();
      if (events + contacts > 0) {
        console.log(`[embudo] barrido: ${String(events)} eventos viejos borrados, ${String(contacts)} contactos viejos anonimizados`);
      }
    } catch (err: unknown) {
      console.error('[embudo] barrido falló:', err);
    }
  };
  // El primero termina antes de seguir con el arranque
  await sweep();
  const timer = setInterval(() => {
    void sweep();
  }, intervalMs);
  timer.unref();
  return timer;
}
