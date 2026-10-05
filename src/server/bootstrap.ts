import type { createApp } from './app.ts';
import { ensureDevData, type DevInfo } from './db/dev-seed.ts';
import { startDemoSweeper } from './demo/demo-sweeper.ts';
import { startBillingSweeper } from './billing/reconcile.ts';
import { startFunnelSweeper } from './funnel/funnel-sweeper.ts';

export type { DevInfo };

type Bundle = Pick<ReturnType<typeof createApp>, 'systemDb' | 'authService' | 'tenantManager' | 'demoSessions' | 'demoResets' | 'auditLog' | 'billing' | 'funnel'>;

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Arranque del servidor: comercios y barrido de demos (#24), barridos de cobro (#21) y del embudo (#25) y, solo fuera de producción,
 * los datos de desarrollo (#3: en la web serían un root y una key con valores que están en el repo).
 */
export function bootstrap(params: {
  env: NodeJS.ProcessEnv;
  bundle: Bundle;
  sweepIntervalMs?: number | undefined;
}): { devInfo?: DevInfo; sweeper: NodeJS.Timeout; billingSweeper: NodeJS.Timeout; funnelSweeper: NodeJS.Timeout } {
  const { bundle } = params;
  const interval = params.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
  // Los comercios demo (#24) son parte del producto: también en producción
  if (bundle.demoSessions.enabled()) {
    const created = bundle.demoSessions.ensureDemoTenants();
    if (created.length > 0) console.log(`[demos] comercios demo creados: ${created.join(', ')}`);
  }
  const sweeper = startDemoSweeper({ sessions: bundle.demoSessions, resets: bundle.demoResets, audit: bundle.auditLog }, interval);
  const billingSweeper = startBillingSweeper(
    { systemDb: bundle.systemDb, tenantManager: bundle.tenantManager, billing: bundle.billing },
    interval,
  );
  // La retención del embudo (#25), aunque las demos estén apagadas
  const funnelSweeper = startFunnelSweeper(bundle.funnel, interval);
  if (params.env['NODE_ENV'] === 'production') {
    return { sweeper, billingSweeper, funnelSweeper };
  }
  const devInfo = ensureDevData({
    systemDb: bundle.systemDb,
    authService: bundle.authService,
    tenantManager: bundle.tenantManager,
    billing: bundle.billing,
    demoSessions: bundle.demoSessions,
  });
  return { devInfo, sweeper, billingSweeper, funnelSweeper };
}
