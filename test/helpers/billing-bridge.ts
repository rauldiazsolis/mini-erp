import type { LegacyDemoBridge } from '../../src/server/billing/legacy-bridge.ts';

/**
 * El puente a la marca de demo de SQLite para los tests sin la base de sistema de SQLite: las demos
 * se dan a mano. Lo borra el dominio 7, con `demo_tenants` en PostgreSQL.
 */
export function fakeBillingBridge(p: { demos?: readonly string[] } = {}): LegacyDemoBridge {
  const demos = new Set(p.demos ?? []);
  return {
    isDemoTenant: async (tenantId) => demos.has(tenantId),
    demoTenantIds: async () => [...demos],
  };
}
