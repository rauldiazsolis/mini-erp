import type { DatabaseSync } from 'node:sqlite';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { BillingService } from './billing-service.ts';

type Deps = { systemDb: DatabaseSync; tenantManager: TenantManager; billing: BillingService };

/**
 * Crea los cargos que falten (#21): una caída entre el commit del lote y el cargo. Recorre las ventas
 * con caja (no anulaciones) de los comercios con titular. Devuelve cuántos creó.
 */
export function reconcileCharges(deps: Deps): number {
  const tenants = deps.systemDb.prepare('SELECT id FROM tenants WHERE holder_user_id IS NOT NULL').all() as { id: string }[];
  let created = 0;
  for (const { id } of tenants) {
    const groups = deps.tenantManager
      .getTenantDb(id)
      .prepare(
        `SELECT register_id, COALESCE(charge_device, '') AS device, group_concat(DISTINCT day) AS days
         FROM sales WHERE register_id IS NOT NULL AND voids_sale_id IS NULL AND day IS NOT NULL
         GROUP BY register_id, COALESCE(charge_device, '')`,
      )
      .all() as { register_id: string; device: string; days: string }[];
    for (const g of groups) {
      created += deps.billing.charge({ tenantId: id, registerId: g.register_id, chargeDevice: g.device, days: g.days.split(',') });
    }
  }
  return created;
}

/** El barrido de cobro: al arrancar y cada `intervalMs`. Nunca tumba el proceso. */
export function startBillingSweeper(deps: Deps, intervalMs: number): NodeJS.Timeout {
  const sweep = (): void => {
    try {
      const created = reconcileCharges(deps);
      if (created > 0) console.log(`[cobro] barrido: ${String(created)} cargos recuperados`);
    } catch (err: unknown) {
      console.error('[cobro] falló el barrido:', err);
    }
  };
  sweep();
  const timer = setInterval(sweep, intervalMs);
  timer.unref();
  return timer;
}
