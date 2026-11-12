import type { BillingLegacyBridge } from '../../src/server/billing/legacy-bridge.ts';

/**
 * El puente del cobro a SQLite (suspensiones y demos) para los tests de `BillingService` sin la base
 * de sistema de SQLite: las demos y los días suspendidos se dan a mano.
 */
export function fakeBillingBridge(p: { demos?: readonly string[]; suspendedDays?: readonly string[] } = {}): BillingLegacyBridge {
  const demos = new Set(p.demos ?? []);
  const suspended = new Set(p.suspendedDays ?? []);
  return {
    isDemoTenant: async (tenantId) => demos.has(tenantId),
    suspendedDays: async (_tenantId, days) => new Set(days.filter((d) => suspended.has(d))),
  };
}
