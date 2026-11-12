import type { DatabaseSync } from 'node:sqlite';

/**
 * Lo que el sistema en PostgreSQL todavía lee de la base de sistema de SQLite, mientras dure la
 * fase 3: la marca de demo (`demo_tenants`). La usan el cobro (no avisa de un comercio demo sin
 * titular) y la plataforma (los comercios demo no aparecen en Comercios ni se suspenden). El dominio 7
 * migra `demo_tenants` a PostgreSQL, reemplaza esto por una consulta (o un JOIN) y borra el puente.
 */
export type LegacyDemoBridge = {
  isDemoTenant(tenantId: string): Promise<boolean>;
  /** Los ids de los comercios demo, para dejarlos afuera con un `where id not in`. */
  demoTenantIds(): Promise<string[]>;
};

export function sqliteDemoBridge(systemDb: DatabaseSync): LegacyDemoBridge {
  return {
    isDemoTenant: async (tenantId) => systemDb.prepare('SELECT 1 FROM demo_tenants WHERE tenant_id = ?').get(tenantId) !== undefined,
    demoTenantIds: async () => (systemDb.prepare('SELECT tenant_id FROM demo_tenants ORDER BY tenant_id').all() as { tenant_id: string }[]).map((r) => r.tenant_id),
  };
}
