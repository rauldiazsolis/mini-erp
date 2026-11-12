import type { DatabaseSync } from 'node:sqlite';
import { suspendedDays } from '../platform/suspensions.ts';

/**
 * Lo que el cobro todavía lee de la base de sistema de SQLite, mientras dure la fase 3 de
 * PostgreSQL: las suspensiones (`tenant_suspensions`, dominio 5) y la marca de demo (`demo_tenants`,
 * dominio 7). El dominio que migre cada tabla reemplaza su mitad por una consulta en PostgreSQL y,
 * con las dos, este puente se borra.
 */
export type BillingLegacyBridge = {
  isDemoTenant(tenantId: string): Promise<boolean>;
  /** Los días argentinos de `days` con el comercio suspendido: no se cobran (#23). */
  suspendedDays(tenantId: string, days: readonly string[]): Promise<Set<string>>;
};

export function sqliteBillingBridge(systemDb: DatabaseSync): BillingLegacyBridge {
  return {
    isDemoTenant: async (tenantId) => systemDb.prepare('SELECT 1 FROM demo_tenants WHERE tenant_id = ?').get(tenantId) !== undefined,
    suspendedDays: async (tenantId, days) => await suspendedDays(systemDb, tenantId, days),
  };
}
