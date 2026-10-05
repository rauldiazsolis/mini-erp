import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuditLog } from '../audit/audit-log.ts';
import { DomainError } from '../errors.ts';
import { isSuspended } from './suspensions.ts';

/** Suspender y reactivar comercios (#23): corta el admin, el POS sigue y no se cobran esos días. */
export class SuspensionService {
  private db: DatabaseSync;
  private audit: AuditLog;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; audit: AuditLog; now: () => Date }) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  suspend(p: { tenantId: string; reason: string; actorUserId: string }): void {
    this.requireRealTenant(p.tenantId);
    if (isSuspended(this.db, p.tenantId)) throw new DomainError(409, 'El comercio ya está suspendido');
    this.inTransaction(() => {
      this.db
        .prepare('INSERT INTO tenant_suspensions (id, tenant_id, from_at, to_at, reason, created_by) VALUES (?, ?, ?, NULL, ?, ?)')
        .run(`sus_${randomUUID()}`, p.tenantId, this.now().toISOString(), p.reason, p.actorUserId);
      this.db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(p.tenantId);
      this.audit.record({ actorUserId: p.actorUserId, tenantId: p.tenantId, action: 'tenant.suspended', details: { reason: p.reason } });
    });
  }

  reactivate(p: { tenantId: string; actorUserId: string }): void {
    this.requireRealTenant(p.tenantId);
    if (!isSuspended(this.db, p.tenantId)) throw new DomainError(409, 'El comercio no está suspendido');
    this.inTransaction(() => {
      this.db.prepare('UPDATE tenant_suspensions SET to_at = ? WHERE tenant_id = ? AND to_at IS NULL').run(this.now().toISOString(), p.tenantId);
      this.db.prepare("UPDATE tenants SET status = 'active' WHERE id = ?").run(p.tenantId);
      this.audit.record({ actorUserId: p.actorUserId, tenantId: p.tenantId, action: 'tenant.reactivated' });
    });
  }

  private requireRealTenant(tenantId: string): void {
    const row = this.db.prepare('SELECT 1 FROM tenants WHERE id = ? AND id NOT IN (SELECT tenant_id FROM demo_sessions)').get(tenantId);
    if (row === undefined) throw new DomainError(404, 'Comercio no encontrado');
  }

  private inTransaction(run: () => void): void {
    this.db.exec('BEGIN');
    try {
      run();
      this.db.exec('COMMIT');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
