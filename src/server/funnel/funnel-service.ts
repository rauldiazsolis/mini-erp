import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { argentinaToday } from '../../shared/argentina-day.ts';
import type { FunnelContactSource, FunnelDailyKind, FunnelEventType } from '../../shared/funnel-types.ts';
import { DEMO_TENANT_IDS_SQL } from '../demo/demo-tenant-ids.ts';
import { DomainError } from '../errors.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Retención (#25): los eventos, 24 meses; nombre y WhatsApp de un contacto que no llegó a comercio, 12. */
export const EVENT_RETENTION_DAYS = 730;
export const CONTACT_RETENTION_DAYS = 365;

export type FunnelRef = { demoSessionId?: string | undefined; tenantId?: string | undefined; data?: Record<string, string> | undefined };

/**
 * El embudo (M9, #25), de sistema: los eventos que se perderían (venta demo, mini desde el POS, alta
 * abierta, carga), los totales anónimos del landing y los contactos. Cada evento, a lo sumo una vez por
 * demo o por comercio (índices únicos de la migración v11). Sin IP ni navegador.
 */
export class FunnelService {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; now: () => Date }) {
    this.db = deps.db;
    this.now = deps.now;
  }

  isDemoSession(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM demo_sessions WHERE id = ?').get(id) !== undefined;
  }

  isDemoTenant(tenantId: string): boolean {
    return this.db.prepare(`SELECT 1 WHERE ? IN ${DEMO_TENANT_IDS_SQL}`).get(tenantId) !== undefined;
  }

  /** Registra el evento si es nuevo; una demo desconocida no cuenta. Devuelve si lo escribió. */
  record(type: FunnelEventType, ref: FunnelRef): boolean {
    const demo = ref.demoSessionId !== undefined && this.isDemoSession(ref.demoSessionId) ? ref.demoSessionId : null;
    const tenant = ref.tenantId ?? null;
    if (demo === null && tenant === null) return false;
    const result = this.db
      .prepare('INSERT OR IGNORE INTO funnel_events (id, type, demo_session_id, tenant_id, at, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), type, demo, tenant, this.now().toISOString(), ref.data === undefined ? null : JSON.stringify(ref.data));
    return Number(result.changes) > 0;
  }

  /** `record` para los puntos de registro: un error queda en el log y no corta lo de fondo. */
  tryRecord(type: FunnelEventType, ref: FunnelRef): void {
    try {
      this.record(type, ref);
    } catch (err: unknown) {
      console.error(`[embudo] no se pudo registrar ${type}:`, err);
    }
  }

  bump(kind: FunnelDailyKind): void {
    this.db
      .prepare('INSERT INTO funnel_daily (day, kind, count) VALUES (?, ?, 1) ON CONFLICT (day, kind) DO UPDATE SET count = count + 1')
      .run(argentinaToday(this.now()), kind);
  }

  /** Liga el comercio que nace de un alta a su demo (vigente o revocada). Devuelve si la demo existe. */
  linkTenant(tenantId: string, demoSessionId: string): boolean {
    if (!this.isDemoSession(demoSessionId)) return false;
    this.db.prepare('UPDATE tenants SET demo_session_id = ? WHERE id = ?').run(demoSessionId, tenantId);
    return true;
  }

  /** Un contacto por demo: si ya dejó uno, se actualiza y vuelve a "sin atender". Sin demo, uno nuevo. */
  saveContact(input: { name: string; whatsapp: string; source: FunnelContactSource; demoSessionId?: string | undefined }): { id: string } {
    const at = this.now().toISOString();
    const demo = input.demoSessionId !== undefined && this.isDemoSession(input.demoSessionId) ? input.demoSessionId : null;
    if (demo !== null) {
      const existing = this.db.prepare('SELECT id FROM funnel_contacts WHERE demo_session_id = ?').get(demo) as { id: string } | undefined;
      if (existing !== undefined) {
        this.db
          .prepare(
            'UPDATE funnel_contacts SET name = ?, whatsapp = ?, source = ?, updated_at = ?, handled_at = NULL, handled_by = NULL, erased_at = NULL WHERE id = ?',
          )
          .run(input.name, input.whatsapp, input.source, at, existing.id);
        return { id: existing.id };
      }
    }
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO funnel_contacts (id, demo_session_id, source, name, whatsapp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, demo, input.source, input.name, input.whatsapp, at, at);
    return { id };
  }

  markHandled(contactId: string, userId: string): void {
    const result = this.db
      .prepare('UPDATE funnel_contacts SET handled_at = COALESCE(handled_at, ?), handled_by = COALESCE(handled_by, ?) WHERE id = ?')
      .run(this.now().toISOString(), userId, contactId);
    if (Number(result.changes) === 0) throw new DomainError(404, 'No existe ese contacto');
  }

  pendingCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM funnel_contacts WHERE handled_at IS NULL AND erased_at IS NULL').get() as { n: number };
    return row.n;
  }

  /** Retención: borra eventos viejos y los datos personales de contactos viejos que no llegaron a comercio. */
  sweep(): { events: number; contacts: number } {
    const now = this.now();
    const eventsCutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY_MS).toISOString();
    const contactsCutoff = new Date(now.getTime() - CONTACT_RETENTION_DAYS * DAY_MS).toISOString();
    const events = this.db.prepare('DELETE FROM funnel_events WHERE at < ?').run(eventsCutoff).changes;
    const contacts = this.db
      .prepare(
        `UPDATE funnel_contacts SET name = NULL, whatsapp = NULL, erased_at = ?
         WHERE erased_at IS NULL AND updated_at < ?
           AND (demo_session_id IS NULL OR demo_session_id NOT IN (SELECT demo_session_id FROM tenants WHERE demo_session_id IS NOT NULL))`,
      )
      .run(now.toISOString(), contactsCutoff).changes;
    return { events: Number(events), contacts: Number(contacts) };
  }
}
