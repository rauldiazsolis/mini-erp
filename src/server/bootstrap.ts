import type { createApp } from './app.ts';
import { ensureDevData } from './db/dev-seed.ts';
import { startDemoSweeper } from './demo/demo-session-service.ts';

export type DevInfo = { email: string; rawKey: string };

type Bundle = Pick<ReturnType<typeof createApp>, 'systemDb' | 'authService' | 'tenantManager' | 'demoSessions'>;

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Arranque del servidor: barrido de demos (#9) y, solo fuera de producción, los datos de desarrollo
 * (#3: en la web serían un root y una key con valores que están en el repo).
 */
export function bootstrap(params: {
  env: NodeJS.ProcessEnv;
  bundle: Bundle;
  sweepIntervalMs?: number | undefined;
}): { devInfo?: DevInfo; sweeper: NodeJS.Timeout } {
  const { bundle } = params;
  const sweeper = startDemoSweeper(bundle.demoSessions, params.sweepIntervalMs ?? SWEEP_INTERVAL_MS);
  if (params.env['NODE_ENV'] === 'production') {
    return { sweeper };
  }
  const devInfo = ensureDevData({
    systemDb: bundle.systemDb,
    authService: bundle.authService,
    tenantManager: bundle.tenantManager,
  });
  return { devInfo, sweeper };
}
