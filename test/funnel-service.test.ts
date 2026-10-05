import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { FunnelService } from '../src/server/funnel/funnel-service.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('FunnelService (#25)', () => {
  let db: DatabaseSync;
  let clock: Date;
  let funnel: FunnelService;

  beforeEach(() => {
    db = openSystemDb(':memory:');
    clock = new Date('2026-10-05T15:00:00.000Z');
    funnel = new FunnelService({ db, now: () => clock });
    db.prepare(
      "INSERT INTO demo_sessions (id, template, tenant_id, register_id, created_at, last_used_at) VALUES ('demo_a', 'kiosco', 'demo-kiosco', 'reg_a', ?, ?)",
    ).run(clock.toISOString(), clock.toISOString());
    db.prepare("INSERT INTO demo_tenants (tenant_id, template, last_full_reset_at) VALUES ('demo-kiosco', 'kiosco', ?)").run(clock.toISOString());
    db.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES ('kiosco-ana', 'kiosco-ana', 'Kiosco Ana', ?)").run(clock.toISOString());
  });

  const events = () => db.prepare('SELECT type, demo_session_id AS demo, tenant_id AS tenant, data FROM funnel_events ORDER BY at, type').all();

  it('registra cada tipo una sola vez por demo o por comercio', () => {
    expect(funnel.record('demo-sale', { demoSessionId: 'demo_a' })).toBe(true);
    expect(funnel.record('demo-sale', { demoSessionId: 'demo_a' })).toBe(false);
    expect(funnel.record('catalog-loaded', { tenantId: 'kiosco-ana', data: { source: 'example' } })).toBe(true);
    expect(funnel.record('catalog-loaded', { tenantId: 'kiosco-ana', data: { source: 'import-products' } })).toBe(false);
    expect(events()).toEqual([
      { type: 'catalog-loaded', demo: null, tenant: 'kiosco-ana', data: '{"source":"example"}' },
      { type: 'demo-sale', demo: 'demo_a', tenant: null, data: null },
    ]);
  });

  it('ignora una demo desconocida', () => {
    expect(funnel.record('portal-opened', { demoSessionId: 'otra' })).toBe(false);
    expect(events()).toEqual([]);
  });

  it('tryRecord no tira aunque la base falle', () => {
    db.exec('DROP TABLE funnel_events');
    expect(() => {
      funnel.tryRecord('demo-sale', { demoSessionId: 'demo_a' });
    }).not.toThrow();
  });

  it('suma los totales del día argentino', () => {
    funnel.bump('landing');
    funnel.bump('landing');
    clock = new Date('2026-10-06T02:59:00.000Z'); // sigue siendo el 5 en Argentina
    funnel.bump('landing');
    clock = new Date('2026-10-06T03:00:00.000Z');
    funnel.bump('demo-click');
    expect(db.prepare('SELECT day, kind, count FROM funnel_daily ORDER BY day, kind').all()).toEqual([
      { day: '2026-10-05', kind: 'landing', count: 3 },
      { day: '2026-10-06', kind: 'demo-click', count: 1 },
    ]);
  });

  it('liga un comercio a una demo conocida, aunque esté revocada', () => {
    db.prepare("UPDATE demo_sessions SET revoked_at = ?, revoke_reason = 'idle' WHERE id = 'demo_a'").run(clock.toISOString());
    expect(funnel.linkTenant('kiosco-ana', 'demo_a')).toBe(true);
    expect(funnel.linkTenant('kiosco-ana', 'otra')).toBe(false);
    expect(db.prepare("SELECT demo_session_id FROM tenants WHERE id = 'kiosco-ana'").get()).toEqual({ demo_session_id: 'demo_a' });
  });

  it('un contacto por demo: el segundo actualiza y vuelve a sin atender', () => {
    const first = funnel.saveContact({ name: 'Ana', whatsapp: '1155550000', source: 'demo', demoSessionId: 'demo_a' });
    funnel.markHandled(first.id, 'u_soporte');
    clock = new Date(clock.getTime() + 60_000);
    const second = funnel.saveContact({ name: 'Ana P.', whatsapp: '1155551111', source: 'demo-ended', demoSessionId: 'demo_a' });
    expect(second.id).toBe(first.id);
    expect(db.prepare('SELECT name, whatsapp, source, handled_at, handled_by FROM funnel_contacts').all()).toEqual([
      { name: 'Ana P.', whatsapp: '1155551111', source: 'demo-ended', handled_at: null, handled_by: null },
    ]);
    expect(funnel.pendingCount()).toBe(1);
  });

  it('sin demo (o con una desconocida) cada contacto es una fila nueva sin demo', () => {
    funnel.saveContact({ name: 'Beto', whatsapp: '1144440000', source: 'landing' });
    funnel.saveContact({ name: 'Caro', whatsapp: '1133330000', source: 'landing', demoSessionId: 'inventada' });
    expect(db.prepare('SELECT name, demo_session_id AS demo FROM funnel_contacts ORDER BY name').all()).toEqual([
      { name: 'Beto', demo: null },
      { name: 'Caro', demo: null },
    ]);
  });

  it('marcar atendido guarda quién y cuándo; uno desconocido da 404', () => {
    const { id } = funnel.saveContact({ name: 'Ana', whatsapp: '1155550000', source: 'landing' });
    funnel.markHandled(id, 'u_soporte');
    expect(db.prepare('SELECT handled_at, handled_by FROM funnel_contacts').get()).toEqual({ handled_at: clock.toISOString(), handled_by: 'u_soporte' });
    expect(funnel.pendingCount()).toBe(0);
    expect(() => {
      funnel.markHandled('nada', 'u_soporte');
    }).toThrow('No existe ese contacto');
  });

  it('el barrido borra eventos viejos y los datos de contactos viejos sin comercio', () => {
    const old = new Date(clock.getTime() - 731 * DAY).toISOString();
    db.prepare("INSERT INTO funnel_events (id, type, demo_session_id, at) VALUES ('viejo', 'demo-sale', 'demo_a', ?)").run(old);
    db.prepare(
      "INSERT INTO demo_sessions (id, template, tenant_id, register_id, created_at, last_used_at) VALUES ('demo_b', 'kiosco', 'demo-kiosco', 'reg_b', ?, ?)",
    ).run(old, old);
    const contact = db.prepare('INSERT INTO funnel_contacts (id, demo_session_id, source, name, whatsapp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const year = new Date(clock.getTime() - 366 * DAY).toISOString();
    contact.run('c_sin', null, 'landing', 'Viejo', '1100000000', year, year);
    contact.run('c_con', 'demo_b', 'demo', 'Cliente', '1100000001', year, year);
    db.prepare("UPDATE tenants SET demo_session_id = 'demo_b' WHERE id = 'kiosco-ana'").run();
    expect(funnel.sweep()).toEqual({ events: 1, contacts: 1 });
    expect(db.prepare('SELECT id, name, whatsapp, erased_at FROM funnel_contacts ORDER BY id').all()).toEqual([
      { id: 'c_con', name: 'Cliente', whatsapp: '1100000001', erased_at: null },
      { id: 'c_sin', name: null, whatsapp: null, erased_at: clock.toISOString() },
    ]);
    expect(funnel.sweep()).toEqual({ events: 0, contacts: 0 });
  });

  it('reconoce los comercios demo', () => {
    expect(funnel.isDemoTenant('demo-kiosco')).toBe(true);
    expect(funnel.isDemoTenant('kiosco-ana')).toBe(false);
  });
});
