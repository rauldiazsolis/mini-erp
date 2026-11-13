import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FunnelService } from '../src/server/funnel/funnel-service.ts';
import { AuditLog } from '../src/server/audit/audit-log.ts';
import { setupTestDb } from './helpers/test-db.ts';

const DAY = 24 * 60 * 60 * 1000;
const db = setupTestDb();

describe('FunnelService (#25)', () => {
  let clock: Date;
  let funnel: FunnelService;

  const demoSession = (id: string, at: string) =>
    db()
      .system.insertInto('demo_sessions')
      .values({ id, template: 'kiosco', tenant_id: 'demo-kiosco', register_id: `reg_${id}`, created_at: at, last_used_at: at })
      .execute();

  beforeEach(async () => {
    clock = new Date('2026-10-05T15:00:00.000Z');
    const now = () => clock;
    funnel = new FunnelService({ db: db().system, now, audit: new AuditLog(db().system, now) });
    await demoSession('demo_a', clock.toISOString());
    await db().system.insertInto('demo_tenants').values({ tenant_id: 'demo-kiosco', template: 'kiosco', last_full_reset_at: clock.toISOString() }).execute();
    await db().system.insertInto('tenants').values({ id: 'kiosco-ana', slug: 'kiosco-ana', name: 'Kiosco Ana', created_at: clock.toISOString() }).execute();
  });

  const events = () =>
    db()
      .system.selectFrom('funnel_events')
      .select(['type', 'demo_session_id as demo', 'tenant_id as tenant', 'data'])
      .orderBy('at')
      .orderBy('type')
      .execute();
  const contacts = () => db().system.selectFrom('funnel_contacts');

  it('registra cada tipo una sola vez por demo o por comercio', async () => {
    expect(await funnel.record('demo-sale', { demoSessionId: 'demo_a' })).toBe(true);
    expect(await funnel.record('demo-sale', { demoSessionId: 'demo_a' })).toBe(false);
    expect(await funnel.record('catalog-loaded', { tenantId: 'kiosco-ana', data: { source: 'example' } })).toBe(true);
    expect(await funnel.record('catalog-loaded', { tenantId: 'kiosco-ana', data: { source: 'import-products' } })).toBe(false);
    expect(await events()).toEqual([
      { type: 'catalog-loaded', demo: null, tenant: 'kiosco-ana', data: { source: 'example' } },
      { type: 'demo-sale', demo: 'demo_a', tenant: null, data: null },
    ]);
  });

  it('ignora una demo desconocida', async () => {
    expect(await funnel.record('portal-opened', { demoSessionId: 'otra' })).toBe(false);
    expect(await events()).toEqual([]);
  });

  it('tryRecord no tira aunque la base falle', async () => {
    vi.spyOn(funnel, 'record').mockRejectedValueOnce(new Error('se cayó la base'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(funnel.tryRecord('demo-sale', { demoSessionId: 'demo_a' })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('suma los totales del día argentino', async () => {
    await funnel.bump('landing');
    await funnel.bump('landing');
    clock = new Date('2026-10-06T02:59:00.000Z'); // sigue siendo el 5 en Argentina
    await funnel.bump('landing');
    clock = new Date('2026-10-06T03:00:00.000Z');
    await funnel.bump('demo-click');
    expect(await db().system.selectFrom('funnel_daily').select(['day', 'kind', 'count']).orderBy('day').orderBy('kind').execute()).toEqual([
      { day: '2026-10-05', kind: 'landing', count: 3 },
      { day: '2026-10-06', kind: 'demo-click', count: 1 },
    ]);
  });

  it('liga un comercio a una demo conocida, aunque esté revocada', async () => {
    await db().system.updateTable('demo_sessions').set({ revoked_at: clock.toISOString(), revoke_reason: 'idle' }).where('id', '=', 'demo_a').execute();
    expect(await funnel.linkTenant('kiosco-ana', 'demo_a')).toBe(true);
    expect(await funnel.linkTenant('kiosco-ana', 'otra')).toBe(false);
    expect(await db().system.selectFrom('tenants').select('demo_session_id').where('id', '=', 'kiosco-ana').executeTakeFirst()).toEqual({
      demo_session_id: 'demo_a',
    });
  });

  it('un contacto por demo: el segundo actualiza y vuelve a sin atender', async () => {
    const first = await funnel.saveContact({ name: 'Ana', whatsapp: '1155550000', source: 'demo', demoSessionId: 'demo_a' });
    await funnel.markHandled(first.id, { actorUserId: 'u_soporte' });
    clock = new Date(clock.getTime() + 60_000);
    const second = await funnel.saveContact({ name: 'Ana P.', whatsapp: '1155551111', source: 'demo-ended', demoSessionId: 'demo_a' });
    expect(second.id).toBe(first.id);
    expect(await contacts().select(['name', 'whatsapp', 'source', 'handled_at', 'handled_by']).execute()).toEqual([
      { name: 'Ana P.', whatsapp: '1155551111', source: 'demo-ended', handled_at: null, handled_by: null },
    ]);
    expect(await funnel.pendingCount()).toBe(1);
  });

  it('sin demo (o con una desconocida) cada contacto es una fila nueva sin demo', async () => {
    await funnel.saveContact({ name: 'Beto', whatsapp: '1144440000', source: 'landing' });
    await funnel.saveContact({ name: 'Caro', whatsapp: '1133330000', source: 'landing', demoSessionId: 'inventada' });
    expect(await contacts().select(['name', 'demo_session_id as demo']).orderBy('name').execute()).toEqual([
      { name: 'Beto', demo: null },
      { name: 'Caro', demo: null },
    ]);
  });

  it('marcar atendido guarda quién y cuándo, y lo audita; uno desconocido da 404', async () => {
    const { id } = await funnel.saveContact({ name: 'Ana', whatsapp: '1155550000', source: 'landing' });
    await funnel.markHandled(id, { actorUserId: 'u_soporte' });
    expect(await contacts().select(['handled_at', 'handled_by']).executeTakeFirst()).toEqual({ handled_at: clock.toISOString(), handled_by: 'u_soporte' });
    expect(await funnel.pendingCount()).toBe(0);
    expect(
      await db().system.selectFrom('audit_log').select(['actor_user_id', 'details']).where('action', '=', 'funnel.contact-handled').execute(),
    ).toEqual([{ actor_user_id: 'u_soporte', details: { contactId: id } }]);
    await expect(funnel.markHandled('nada', { actorUserId: 'u_soporte' })).rejects.toThrow('No existe ese contacto');
    expect(await db().system.selectFrom('audit_log').select('id').execute()).toHaveLength(1);
  });

  it('el barrido borra eventos viejos y los datos de contactos viejos sin comercio', async () => {
    const old = new Date(clock.getTime() - 731 * DAY).toISOString();
    await db().system.insertInto('funnel_events').values({ id: 'viejo', type: 'demo-sale', demo_session_id: 'demo_a', at: old }).execute();
    await demoSession('demo_b', old);
    const year = new Date(clock.getTime() - 366 * DAY).toISOString();
    await db()
      .system.insertInto('funnel_contacts')
      .values([
        { id: 'c_sin', demo_session_id: null, source: 'landing', name: 'Viejo', whatsapp: '1100000000', created_at: year, updated_at: year },
        { id: 'c_con', demo_session_id: 'demo_b', source: 'demo', name: 'Cliente', whatsapp: '1100000001', created_at: year, updated_at: year },
      ])
      .execute();
    await db().system.updateTable('tenants').set({ demo_session_id: 'demo_b' }).where('id', '=', 'kiosco-ana').execute();
    expect(await funnel.sweep()).toEqual({ events: 1, contacts: 1 });
    expect(await contacts().select(['id', 'name', 'whatsapp', 'erased_at']).orderBy('id').execute()).toEqual([
      { id: 'c_con', name: 'Cliente', whatsapp: '1100000001', erased_at: null },
      { id: 'c_sin', name: null, whatsapp: null, erased_at: clock.toISOString() },
    ]);
    expect(await funnel.sweep()).toEqual({ events: 0, contacts: 0 });
  });

  it('reconoce los comercios demo', async () => {
    expect(await funnel.isDemoTenant('demo-kiosco')).toBe(true);
    expect(await funnel.isDemoTenant('kiosco-ana')).toBe(false);
  });
});
