import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { argentinaToday } from '../../shared/argentina-day.ts';
import type { FunnelContactSource, FunnelDailyKind, FunnelEventType } from '../../shared/funnel-types.ts';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { jsonValue } from '../db/pg/sql-helpers.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { isDemoTenant } from '../demo/demo-tenant-ids.ts';
import { DomainError } from '../errors.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Retención (#25): los eventos, 24 meses; nombre y WhatsApp de un contacto que no llegó a comercio, 12. */
export const EVENT_RETENTION_DAYS = 730;
export const CONTACT_RETENTION_DAYS = 365;

export type FunnelRef = { demoSessionId?: string | undefined; tenantId?: string | undefined; data?: Record<string, string> | undefined };

type Db = Kysely<SystemDatabase>;

/**
 * El embudo (M9, #25), de sistema: los eventos que se perderían (venta demo, mini desde el POS, alta
 * abierta, carga), los totales anónimos del landing y los contactos. Cada evento, a lo sumo una vez por
 * demo o por comercio (índices únicos parciales de `funnel_events`). Sin IP ni navegador.
 */
export class FunnelService {
  private db: Db;
  private now: () => Date;
  private audit: AuditLog;

  constructor(deps: { db: Db; now: () => Date; audit: AuditLog }) {
    this.db = deps.db;
    this.now = deps.now;
    this.audit = deps.audit;
  }

  async isDemoSession(id: string, db: Db = this.db): Promise<boolean> {
    return (await db.selectFrom('demo_sessions').select('id').where('id', '=', id).executeTakeFirst()) !== undefined;
  }

  async isDemoTenant(tenantId: string): Promise<boolean> {
    return await isDemoTenant(this.db, tenantId);
  }

  /** Registra el evento si es nuevo; una demo desconocida no cuenta. Devuelve si lo escribió. */
  async record(type: FunnelEventType, ref: FunnelRef): Promise<boolean> {
    const demo = ref.demoSessionId !== undefined && (await this.isDemoSession(ref.demoSessionId)) ? ref.demoSessionId : null;
    const tenant = ref.tenantId ?? null;
    if (demo === null && tenant === null) return false;
    const result = await this.db
      .insertInto('funnel_events')
      .values({
        id: randomUUID(),
        type,
        demo_session_id: demo,
        tenant_id: tenant,
        at: this.now().toISOString(),
        data: ref.data === undefined ? null : jsonValue(ref.data),
      })
      // Los índices únicos son parciales (por demo y por comercio): cualquiera de los dos frena el repetido
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0n) > 0;
  }

  /** `record` para los puntos de registro: un error queda en el log y no corta lo de fondo. */
  async tryRecord(type: FunnelEventType, ref: FunnelRef): Promise<void> {
    try {
      await this.record(type, ref);
    } catch (err: unknown) {
      console.error(`[embudo] no se pudo registrar ${type}:`, err);
    }
  }

  async bump(kind: FunnelDailyKind): Promise<void> {
    await this.db
      .insertInto('funnel_daily')
      .values({ day: argentinaToday(this.now()), kind, count: 1 })
      .onConflict((oc) => oc.columns(['day', 'kind']).doUpdateSet((eb) => ({ count: eb('funnel_daily.count', '+', 1) })))
      .execute();
  }

  /** Liga el comercio que nace de un alta a su demo (vigente o revocada). Devuelve si la demo existe. */
  async linkTenant(tenantId: string, demoSessionId: string, db: Db = this.db): Promise<boolean> {
    if (!(await this.isDemoSession(demoSessionId, db))) return false;
    await db.updateTable('tenants').set({ demo_session_id: demoSessionId }).where('id', '=', tenantId).execute();
    return true;
  }

  /** Un contacto por demo: si ya dejó uno, se actualiza y vuelve a "sin atender". Sin demo, uno nuevo. */
  async saveContact(input: { name: string; whatsapp: string; source: FunnelContactSource; demoSessionId?: string | undefined }): Promise<{ id: string }> {
    const at = this.now().toISOString();
    const demo = input.demoSessionId !== undefined && (await this.isDemoSession(input.demoSessionId)) ? input.demoSessionId : null;
    const id = randomUUID();
    if (demo === null) {
      await this.db
        .insertInto('funnel_contacts')
        .values({ id, demo_session_id: null, source: input.source, name: input.name, whatsapp: input.whatsapp, created_at: at, updated_at: at })
        .execute();
      return { id };
    }
    // Uno por demo (índice único parcial): el segundo pisa al primero en el mismo INSERT, sin carrera
    const row = await this.db
      .insertInto('funnel_contacts')
      .values({ id, demo_session_id: demo, source: input.source, name: input.name, whatsapp: input.whatsapp, created_at: at, updated_at: at })
      .onConflict((oc) =>
        oc
          .column('demo_session_id')
          .where('demo_session_id', 'is not', null)
          .doUpdateSet({
            name: input.name,
            whatsapp: input.whatsapp,
            source: input.source,
            updated_at: at,
            handled_at: null,
            handled_by: null,
            erased_at: null,
          }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id };
  }

  /** Marca el contacto como atendido (la primera vez cuenta) y lo audita en la misma transacción. */
  async markHandled(contactId: string, actor: { actorUserId: string; impersonatorUserId?: string | undefined }): Promise<void> {
    const at = this.now().toISOString();
    await this.db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('funnel_contacts')
        .set((eb) => ({
          handled_at: eb.fn.coalesce('handled_at', eb.val(at)),
          handled_by: eb.fn.coalesce('handled_by', eb.val(actor.actorUserId)),
        }))
        .where('id', '=', contactId)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) throw new DomainError(404, 'No existe ese contacto');
      await this.audit.record({ ...actor, tenantId: null, action: 'funnel.contact-handled', details: { contactId } }, trx);
    });
  }

  async pendingCount(): Promise<number> {
    const row = await this.db
      .selectFrom('funnel_contacts')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('handled_at', 'is', null)
      .where('erased_at', 'is', null)
      .executeTakeFirstOrThrow();
    return row.n;
  }

  /** Retención: borra eventos viejos y los datos personales de contactos viejos que no llegaron a comercio. */
  async sweep(): Promise<{ events: number; contacts: number }> {
    const now = this.now();
    const eventsCutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * DAY_MS).toISOString();
    const contactsCutoff = new Date(now.getTime() - CONTACT_RETENTION_DAYS * DAY_MS).toISOString();
    const events = await this.db.deleteFrom('funnel_events').where('at', '<', eventsCutoff).executeTakeFirst();
    const contacts = await this.db
      .updateTable('funnel_contacts as c')
      .set({ name: null, whatsapp: null, erased_at: now.toISOString() })
      .where('c.erased_at', 'is', null)
      .where('c.updated_at', '<', contactsCutoff)
      .where((eb) =>
        eb.or([
          eb('c.demo_session_id', 'is', null),
          eb.not(
            eb.exists(
              eb.selectFrom('tenants as t').select('t.id').whereRef('t.demo_session_id', '=', 'c.demo_session_id'),
            ),
          ),
        ]),
      )
      .executeTakeFirst();
    return { events: Number(events.numDeletedRows), contacts: Number(contacts.numUpdatedRows) };
  }
}
