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

/**
 * La marca de demo en SQL de SQLite, para lo que todavía lee la base de sistema de SQLite (solo el
 * backup, dominio 9 de la fase 3). Ojo: `demo_tenants` ya está en PostgreSQL, así que en SQLite
 * esta subconsulta queda vacía. Se borra con el último que la use.
 */
export const DEMO_TENANT_IDS_SQL = '(SELECT tenant_id FROM demo_tenants)';
