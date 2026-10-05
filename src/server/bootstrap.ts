import type { createApp } from './app.ts';
import { ensureDevData, type DevInfo } from './db/dev-seed.ts';
import { startDemoSweeper } from './demo/demo-session-service.ts';
import { startBillingSweeper } from './billing/reconcile.ts';

export type { DevInfo };

type Bundle = Pick<ReturnType<typeof createApp>, 'systemDb' | 'authService' | 'tenantManager' | 'demoSessions' | 'demoResets' | 'billing'>;

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Arranque del servidor: comercios y barrido de demos (#24), barrido de cobro (#21) y, solo fuera de producción,
 * los datos de desarrollo (#3: en la web serían un root y una key con valores que están en el repo).
 */
export function bootstrap(params: {
  env: NodeJS.ProcessEnv;
  bundle: Bundle;
  sweepIntervalMs?: number | undefined;
}): { devInfo?: DevInfo; sweeper: NodeJS.Timeout; billingSweeper: NodeJS.Timeout } {
  const { bundle } = params;
  const interval = params.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  // Los comercios demo (#24) son parte del producto: también en producción
  if (bundle.demoSessions.enabled()) {
    const created = bundle.demoSessions.ensureDemoTenants();
    if (created.length > 0) console.log(`[demos] comercios demo creados: ${created.join(', ')}`);
  }
  const sweeper = startDemoSweeper(bundle.demoSessions, interval);
  const billingSweeper = startBillingSweeper(
    { systemDb: bundle.systemDb, tenantManager: bundle.tenantManager, billing: bundle.billing },
    interval,
  );
  if (params.env['NODE_ENV'] === 'production') {
    return { sweeper, billingSweeper };
  }
  const devInfo = ensureDevData({
    systemDb: bundle.systemDb,
    authService: bundle.authService,
    tenantManager: bundle.tenantManager,
    billing: bundle.billing,
    demoSessions: bundle.demoSessions,
  });
  return { devInfo, sweeper, billingSweeper };
}
