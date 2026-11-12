import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { LegacyDemoBridge } from '../billing/legacy-bridge.ts';
import { DomainError } from '../errors.ts';
import { isSuspended } from './suspensions.ts';

/** Suspender y reactivar comercios (#23): corta el admin, el POS sigue y no se cobran esos días. */
export class SuspensionService {
  private db: Kysely<SystemDatabase>;
  private audit: AuditLog;
  private now: () => Date;
  private demos: LegacyDemoBridge;

  constructor(deps: { db: Kysely<SystemDatabase>; audit: AuditLog; now: () => Date; demos: LegacyDemoBridge }) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.now = deps.now;
    this.demos = deps.demos;
  }

  async suspend(p: { tenantId: string; reason: string; actorUserId: string }): Promise<void> {
    await this.requireRealTenant(p.tenantId);
    await this.db.transaction().execute(async (trx) => {
      if (await isSuspended(trx, p.tenantId)) throw new DomainError(409, 'El comercio ya está suspendido');
      await trx
        .insertInto('tenant_suspensions')
        .values({ id: `sus_${randomUUID()}`, tenant_id: p.tenantId, from_at: this.now().toISOString(), to_at: null, reason: p.reason, created_by: p.actorUserId })
        .execute();
      await trx.updateTable('tenants').set({ status: 'suspended' }).where('id', '=', p.tenantId).execute();
      await this.audit.record({ actorUserId: p.actorUserId, tenantId: p.tenantId, action: 'tenant.suspended', details: { reason: p.reason } }, trx);
    });
  }

  async reactivate(p: { tenantId: string; actorUserId: string }): Promise<void> {
    await this.requireRealTenant(p.tenantId);
    await this.db.transaction().execute(async (trx) => {
      const closed = await trx
        .updateTable('tenant_suspensions')
        .set({ to_at: this.now().toISOString() })
        .where('tenant_id', '=', p.tenantId)
        .where('to_at', 'is', null)
        .executeTakeFirst();
      if (Number(closed.numUpdatedRows) === 0) throw new DomainError(409, 'El comercio no está suspendido');
      await trx.updateTable('tenants').set({ status: 'active' }).where('id', '=', p.tenantId).execute();
      await this.audit.record({ actorUserId: p.actorUserId, tenantId: p.tenantId, action: 'tenant.reactivated' }, trx);
    });
  }

  private async requireRealTenant(tenantId: string): Promise<void> {
    const row = await this.db.selectFrom('tenants').select('id').where('id', '=', tenantId).executeTakeFirst();
    if (row === undefined || (await this.demos.isDemoTenant(tenantId))) throw new DomainError(404, 'Comercio no encontrado');
  }
}
