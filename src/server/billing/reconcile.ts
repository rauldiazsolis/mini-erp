import { sql } from 'kysely';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { BillingService } from './billing-service.ts';

type Deps = { tenantManager: TenantManager; billing: BillingService };

/**
 * Crea los cargos que falten (#21): una caída entre el commit del lote y el cargo. Recorre las ventas
 * con caja (no anulaciones) de los comercios con titular. Devuelve cuántos creó.
 */
export async function reconcileCharges(deps: Deps): Promise<number> {
  let created = 0;
  for (const id of await deps.billing.billableTenantIds()) {
    // Las combinaciones distintas de caja, equipo y día (`date`, se lee `YYYY-MM-DD`); los días se agrupan acá
    const rows = await deps.tenantManager
      .forTenant(id)
      .selectFrom('sales')
      .select((eb) => ['register_id', eb.fn.coalesce('charge_device', sql.lit('')).as('device'), 'day'])
      .distinct()
      .where('register_id', 'is not', null)
      .where('voids_sale_id', 'is', null)
      .where('day', 'is not', null)
      .orderBy('register_id')
      .orderBy('device')
      .orderBy('day')
      .execute();
    const groups = new Map<string, { registerId: string; device: string; days: string[] }>();
    for (const row of rows) {
      if (row.register_id === null || row.day === null) {
        continue;
      }
      const key = JSON.stringify([row.register_id, row.device]);
      const group = groups.get(key) ?? { registerId: row.register_id, device: row.device, days: [] };
      group.days.push(row.day);
      groups.set(key, group);
    }
    for (const g of groups.values()) {
      created += await deps.billing.charge({ tenantId: id, registerId: g.registerId, chargeDevice: g.device, days: g.days });
    }
  }
  return created;
}

/** El barrido de cobro: al arrancar y cada `intervalMs`. Nunca tumba el proceso. */
export async function startBillingSweeper(deps: Deps, intervalMs: number): Promise<NodeJS.Timeout> {
  const sweep = async (): Promise<void> => {
    try {
      const created = await reconcileCharges(deps);
      if (created > 0) console.log(`[cobro] barrido: ${String(created)} cargos recuperados`);
    } catch (err: unknown) {
      console.error('[cobro] falló el barrido:', err);
    }
  };
  // El primero termina antes de seguir con el arranque, como cuando era síncrono
  await sweep();
  const timer = setInterval(() => {
    void sweep();
  }, intervalMs);
  timer.unref();
  return timer;
}
