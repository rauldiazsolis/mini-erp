import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';

/**
 * Los comercios demo (#24), para excluirlos de cobro, plataforma e impersonación:
 * `.where('t.id', 'not in', demoTenantIds(db))`. Con el `trx` adentro de una transacción.
 */
export function demoTenantIds(db: Kysely<SystemDatabase>) {
  return db.selectFrom('demo_tenants').select('demo_tenants.tenant_id');
}

/** Si el comercio es uno de los demo (#24). */
export async function isDemoTenant(db: Kysely<SystemDatabase>, tenantId: string): Promise<boolean> {
  return (await db.selectFrom('demo_tenants').select('tenant_id').where('tenant_id', '=', tenantId).executeTakeFirst()) !== undefined;
}
