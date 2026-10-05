import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { FunnelQueryService } from '../src/server/funnel/funnel-query-service.ts';

const T0 = '2026-10-05T13:00:00.000Z'; // 10:00 en Argentina
const plus = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

describe('FunnelQueryService (#25)', () => {
  let db: DatabaseSync;
  let q: FunnelQueryService;

  beforeEach(() => {
    db = openSystemDb(':memory:');
    q = new FunnelQueryService({ db });
    db.prepare("INSERT INTO demo_tenants (tenant_id, template, last_full_reset_at) VALUES ('demo-kiosco', 'kiosco', ?)").run(T0);
    db.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES ('demo-kiosco', 'demo-kiosco', 'Kiosco Demo', ?)").run(T0);
    db.prepare(
      "INSERT INTO registers (id, tenant_id, name, branch, point_of_sale, active, created_at) VALUES ('reg_a', 'demo-kiosco', 'Demo AB12', 'CENTRAL', 'Demo AB12', 0, ?)",
    ).run(T0);
    db.prepare(
      "INSERT INTO demo_sessions (id, template, tenant_id, register_id, created_at, last_used_at, revoked_at, revoke_reason) VALUES ('demo_a', 'kiosco', 'demo-kiosco', 'reg_a', ?, ?, ?, 'idle')",
    ).run(T0, T0, plus(600));
    // Un visitante de antes del rango
    db.prepare(
      "INSERT INTO demo_sessions (id, template, tenant_id, register_id, created_at, last_used_at) VALUES ('demo_viejo', 'almacen', 'demo-almacen', 'reg_x', '2026-09-01T13:00:00.000Z', '2026-09-01T13:00:00.000Z')",
    ).run();
    const ev = db.prepare('INSERT INTO funnel_events (id, type, demo_session_id, tenant_id, at, data) VALUES (?, ?, ?, ?, ?, ?)');
    ev.run('e1', 'demo-sale', 'demo_a', null, plus(5), null);
    ev.run('e2', 'portal-opened', 'demo_a', null, plus(10), null);
    ev.run('e3', 'alta-opened', 'demo_a', null, plus(20), null);
    db.prepare(
      "INSERT INTO funnel_contacts (id, demo_session_id, source, name, whatsapp, created_at, updated_at) VALUES ('c_a', 'demo_a', 'demo', 'Ana', '1155550000', ?, ?)",
    ).run(plus(15), plus(15));
    db.prepare("INSERT INTO users (id, email, name, password_hash, global_role, created_at) VALUES ('u_ana', 'ana@x.com', 'Ana', 'h', 'user', ?)").run(plus(25));
    db.prepare(
      "INSERT INTO tenants (id, slug, name, created_at, holder_user_id, business_type, demo_session_id) VALUES ('kiosco-ana', 'kiosco-ana', 'Kiosco Ana', ?, 'u_ana', 'kiosco', 'demo_a')",
    ).run(plus(25));
    ev.run('e4', 'catalog-loaded', null, 'kiosco-ana', plus(30), '{"source":"example"}');
    db.prepare(
      "INSERT INTO charges (id, tenant_id, register_id, device_id, day, amount, paid_amount, gift_amount, debt_amount, rule, created_at) VALUES ('ch1', 'kiosco-ana', 'reg_ana', '', '2026-10-05', 1000, 0, 1000, 0, '{}', ?)",
    ).run(plus(40));
    // Un contacto del landing y un comercio sin demo
    db.prepare(
      "INSERT INTO funnel_contacts (id, demo_session_id, source, name, whatsapp, created_at, updated_at) VALUES ('c_b', NULL, 'landing', 'Beto', '1144440000', ?, ?)",
    ).run(plus(50), plus(50));
    db.prepare("INSERT INTO tenants (id, slug, name, created_at, business_type) VALUES ('ferre-caro', 'ferre-caro', 'Ferre Caro', ?, 'ferreteria')").run(plus(60));
    db.prepare(
      "INSERT INTO funnel_daily (day, kind, count) VALUES ('2026-10-05', 'landing', 7), ('2026-10-05', 'demo-click', 3), ('2026-09-01', 'landing', 99)",
    ).run();
  });

  it('el embudo cuenta la cohorte del rango por etapa y por rubro', () => {
    const r = q.report({ from: '2026-10-05', to: '2026-10-05' });
    expect(r.landing).toEqual({ landing: 7, 'demo-click': 3, 'alta-open': 0 });
    // El tamaño de la cohorte: la base de los porcentajes del panel
    expect(r.visitors).toEqual({ total: 3, byRubro: { kiosco: 1, almacen: 0, ferreteria: 1, otro: 1 } });
    const total = Object.fromEntries(r.stages.map((s) => [s.stage, s.total]));
    expect(total).toEqual({ demo: 1, 'demo-sale': 1, portal: 1, contact: 2, alta: 2, commerce: 2, load: 1, 'real-sale': 1, payment: 0 });
    const ferre = Object.fromEntries(r.stages.map((s) => [s.stage, s.byRubro.ferreteria]));
    expect(ferre).toMatchObject({ alta: 1, commerce: 1, demo: 0 });
    expect(r.stages.find((s) => s.stage === 'contact')?.byRubro.otro).toBe(1); // el contacto del landing
  });

  it('el filtro de rubro deja solo esa cohorte', () => {
    const r = q.report({ from: '2026-10-05', to: '2026-10-05', rubro: 'kiosco' });
    expect(r.stages.find((s) => s.stage === 'commerce')?.total).toBe(1);
    expect(r.stages.find((s) => s.stage === 'contact')?.total).toBe(1);
  });

  it('la lista trae cada visitante con su etapa más avanzada', () => {
    const items = q.visitors({ from: '2026-10-05', to: '2026-10-05' });
    expect(items.map((i) => [i.id, i.furthest, i.rubro])).toEqual([
      ['t-ferre-caro', 'commerce', 'ferreteria'],
      ['c-c_b', 'contact', 'otro'],
      ['demo_a', 'real-sale', 'kiosco'],
    ]);
    expect(items[2]).toMatchObject({ pointOfSale: 'Demo AB12', tenant: { slug: 'kiosco-ana' }, contact: { name: 'Ana', handledAt: null } });
  });

  it('filtra por etapa, contacto, alta y texto', () => {
    const range = { from: '2026-10-05', to: '2026-10-05' };
    expect(q.visitors({ ...range, stage: 'load' }).map((i) => i.id)).toEqual(['demo_a']);
    expect(q.visitors({ ...range, filter: 'contact' }).map((i) => i.id)).toEqual(['c-c_b', 'demo_a']);
    expect(q.visitors({ ...range, filter: 'alta' }).map((i) => i.id)).toEqual(['t-ferre-caro', 'demo_a']);
    expect(q.visitors({ ...range, q: 'ab12' }).map((i) => i.id)).toEqual(['demo_a']);
    expect(q.visitors({ ...range, q: '114444' }).map((i) => i.id)).toEqual(['c-c_b']);
  });

  it('los contactos sin atender son todos, sin rango', () => {
    db.prepare(
      "INSERT INTO funnel_contacts (id, source, name, whatsapp, created_at, updated_at) VALUES ('c_viejo', 'landing', 'Viejo', '1100000000', '2026-01-01T12:00:00.000Z', '2026-01-01T12:00:00.000Z')",
    ).run();
    db.prepare("UPDATE funnel_contacts SET handled_at = ?, handled_by = 'u_ana' WHERE id = 'c_b'").run(plus(70));
    expect(q.visitors({ from: '2026-10-05', to: '2026-10-05', filter: 'pending' }).map((i) => i.id)).toEqual(['demo_a', 'c-c_viejo']);
  });

  it('la historia trae cada etapa con su fecha, la demo, el titular y la carga', () => {
    const d = q.visitor('demo_a');
    expect(d?.stages.map((s) => [s.stage, s.at !== null])).toEqual([
      ['demo', true],
      ['demo-sale', true],
      ['portal', true],
      ['contact', true],
      ['alta', true],
      ['commerce', true],
      ['load', true],
      ['real-sale', true],
      ['payment', false],
    ]);
    expect(d?.demo).toMatchObject({ template: 'kiosco', pointOfSale: 'Demo AB12', revokeReason: 'idle' });
    expect(d?.holder).toEqual({ name: 'Ana', accountCreatedAt: '2026-10-05T13:25:00.000Z' });
    expect(d?.loadSource).toBe('example');
    expect(q.visitor('t-ferre-caro')?.stages.find((s) => s.stage === 'alta')?.at).toBe('2026-10-05T14:00:00.000Z');
    expect(q.visitor('c-c_b')?.contact).toMatchObject({ name: 'Beto', source: 'landing' });
    expect(q.visitor('nada')).toBeUndefined();
    expect(q.visitor('t-demo-kiosco')).toBeUndefined(); // un comercio demo nunca es visitante
    expect(q.visitor('t-kiosco-ana')).toBeUndefined(); // tiene demo: su historia es la de la demo
  });

  it('el pago es el primero del titular desde que nace el comercio', () => {
    const pm = db.prepare('INSERT INTO paid_movements (id, user_id, tenant_id, kind, amount, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    pm.run('pm0', 'u_ana', null, 'payment', 5000, '2026-10-04', '2026-10-04T12:00:00.000Z');
    pm.run('pm1', 'u_ana', 'kiosco-ana', 'payment', 5000, '2026-10-06', '2026-10-06T12:00:00.000Z');
    expect(q.visitor('demo_a')?.stages.find((s) => s.stage === 'payment')?.at).toBe('2026-10-06T12:00:00.000Z');
  });
});
