import { describe, it, expect, beforeEach } from 'vitest';
import { FunnelQueryService } from '../src/server/funnel/funnel-query-service.ts';
import { jsonValue } from '../src/server/db/pg/sql-helpers.ts';
import { setupTestDb } from './helpers/test-db.ts';

const T0 = '2026-10-05T13:00:00.000Z'; // 10:00 en Argentina
const plus = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

const db = setupTestDb();

describe('FunnelQueryService (#25)', () => {
  let q: FunnelQueryService;

  beforeEach(async () => {
    const sys = db().system;
    q = new FunnelQueryService({ db: sys });
    await sys.insertInto('demo_tenants').values({ tenant_id: 'demo-kiosco', template: 'kiosco', last_full_reset_at: T0 }).execute();
    await sys.insertInto('tenants').values({ id: 'demo-kiosco', slug: 'demo-kiosco', name: 'Kiosco Demo', created_at: T0 }).execute();
    await sys
      .insertInto('registers')
      .values({ id: 'reg_a', tenant_id: 'demo-kiosco', name: 'Demo AB12', branch: 'CENTRAL', point_of_sale: 'Demo AB12', active: false, created_at: T0 })
      .execute();
    await sys
      .insertInto('demo_sessions')
      .values([
        { id: 'demo_a', template: 'kiosco', tenant_id: 'demo-kiosco', register_id: 'reg_a', created_at: T0, last_used_at: T0, revoked_at: plus(600), revoke_reason: 'idle' },
        // Un visitante de antes del rango
        {
          id: 'demo_viejo',
          template: 'almacen',
          tenant_id: 'demo-almacen',
          register_id: 'reg_x',
          created_at: '2026-09-01T13:00:00.000Z',
          last_used_at: '2026-09-01T13:00:00.000Z',
        },
      ])
      .execute();
    await sys
      .insertInto('funnel_events')
      .values([
        { id: 'e1', type: 'demo-sale', demo_session_id: 'demo_a', at: plus(5) },
        { id: 'e2', type: 'portal-opened', demo_session_id: 'demo_a', at: plus(10) },
        { id: 'e3', type: 'alta-opened', demo_session_id: 'demo_a', at: plus(20) },
      ])
      .execute();
    await sys
      .insertInto('funnel_contacts')
      .values({ id: 'c_a', demo_session_id: 'demo_a', source: 'demo', name: 'Ana', whatsapp: '1155550000', created_at: plus(15), updated_at: plus(15) })
      .execute();
    await sys.insertInto('users').values({ id: 'u_ana', email: 'ana@x.com', name: 'Ana', password_hash: 'h', global_role: 'user', created_at: plus(25) }).execute();
    await sys
      .insertInto('tenants')
      .values({ id: 'kiosco-ana', slug: 'kiosco-ana', name: 'Kiosco Ana', created_at: plus(25), holder_user_id: 'u_ana', business_type: 'kiosco', demo_session_id: 'demo_a' })
      .execute();
    await sys.insertInto('funnel_events').values({ id: 'e4', type: 'catalog-loaded', tenant_id: 'kiosco-ana', at: plus(30), data: jsonValue({ source: 'example' }) }).execute();
    await sys
      .insertInto('charges')
      .values({
        id: 'ch1',
        tenant_id: 'kiosco-ana',
        register_id: 'reg_ana',
        device_id: '',
        day: '2026-10-05',
        amount: 1000,
        paid_amount: 0,
        gift_amount: 1000,
        debt_amount: 0,
        rule: '{}',
        created_at: plus(40),
      })
      .execute();
    // Un contacto del landing y un comercio sin demo
    await sys
      .insertInto('funnel_contacts')
      .values({ id: 'c_b', demo_session_id: null, source: 'landing', name: 'Beto', whatsapp: '1144440000', created_at: plus(50), updated_at: plus(50) })
      .execute();
    await sys.insertInto('tenants').values({ id: 'ferre-caro', slug: 'ferre-caro', name: 'Ferre Caro', created_at: plus(60), business_type: 'ferreteria' }).execute();
    await sys
      .insertInto('funnel_daily')
      .values([
        { day: '2026-10-05', kind: 'landing', count: 7 },
        { day: '2026-10-05', kind: 'demo-click', count: 3 },
        { day: '2026-09-01', kind: 'landing', count: 99 },
      ])
      .execute();
  });

  it('el embudo cuenta la cohorte del rango por etapa y por rubro', async () => {
    const r = await q.report({ from: '2026-10-05', to: '2026-10-05' });
    expect(r.landing).toEqual({ landing: 7, 'demo-click': 3, 'alta-open': 0 });
    // El tamaño de la cohorte: la base de los porcentajes del panel
    expect(r.visitors).toEqual({ total: 3, byRubro: { kiosco: 1, almacen: 0, ferreteria: 1, otro: 1 } });
    const total = Object.fromEntries(r.stages.map((s) => [s.stage, s.total]));
    expect(total).toEqual({ demo: 1, 'demo-sale': 1, portal: 1, contact: 2, alta: 2, commerce: 2, load: 1, 'real-sale': 1, payment: 0 });
    const ferre = Object.fromEntries(r.stages.map((s) => [s.stage, s.byRubro.ferreteria]));
    expect(ferre).toMatchObject({ alta: 1, commerce: 1, demo: 0 });
    expect(r.stages.find((s) => s.stage === 'contact')?.byRubro.otro).toBe(1); // el contacto del landing
  });

  it('el filtro de rubro deja solo esa cohorte', async () => {
    const r = await q.report({ from: '2026-10-05', to: '2026-10-05', rubro: 'kiosco' });
    expect(r.stages.find((s) => s.stage === 'commerce')?.total).toBe(1);
    expect(r.stages.find((s) => s.stage === 'contact')?.total).toBe(1);
  });

  it('la lista trae cada visitante con su etapa más avanzada', async () => {
    const items = await q.visitors({ from: '2026-10-05', to: '2026-10-05' });
    expect(items.map((i) => [i.id, i.furthest, i.rubro])).toEqual([
      ['t-ferre-caro', 'commerce', 'ferreteria'],
      ['c-c_b', 'contact', 'otro'],
      ['demo_a', 'real-sale', 'kiosco'],
    ]);
    expect(items[2]).toMatchObject({ pointOfSale: 'Demo AB12', tenant: { slug: 'kiosco-ana' }, contact: { name: 'Ana', handledAt: null } });
  });

  it('filtra por etapa, contacto, alta y texto', async () => {
    const range = { from: '2026-10-05', to: '2026-10-05' };
    expect((await q.visitors({ ...range, stage: 'load' })).map((i) => i.id)).toEqual(['demo_a']);
    expect((await q.visitors({ ...range, filter: 'contact' })).map((i) => i.id)).toEqual(['c-c_b', 'demo_a']);
    expect((await q.visitors({ ...range, filter: 'alta' })).map((i) => i.id)).toEqual(['t-ferre-caro', 'demo_a']);
    expect((await q.visitors({ ...range, q: 'ab12' })).map((i) => i.id)).toEqual(['demo_a']);
    expect((await q.visitors({ ...range, q: '114444' })).map((i) => i.id)).toEqual(['c-c_b']);
  });

  it('los contactos sin atender son todos, sin rango', async () => {
    await db()
      .system.insertInto('funnel_contacts')
      .values({ id: 'c_viejo', source: 'landing', name: 'Viejo', whatsapp: '1100000000', created_at: '2026-01-01T12:00:00.000Z', updated_at: '2026-01-01T12:00:00.000Z' })
      .execute();
    await db().system.updateTable('funnel_contacts').set({ handled_at: plus(70), handled_by: 'u_ana' }).where('id', '=', 'c_b').execute();
    expect((await q.visitors({ from: '2026-10-05', to: '2026-10-05', filter: 'pending' })).map((i) => i.id)).toEqual(['demo_a', 'c-c_viejo']);
  });

  it('la historia trae cada etapa con su fecha, la demo, el titular y la carga', async () => {
    const d = await q.visitor('demo_a');
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
    expect((await q.visitor('t-ferre-caro'))?.stages.find((s) => s.stage === 'alta')?.at).toBe('2026-10-05T14:00:00.000Z');
    expect((await q.visitor('c-c_b'))?.contact).toMatchObject({ name: 'Beto', source: 'landing' });
    expect(await q.visitor('nada')).toBeUndefined();
    expect(await q.visitor('t-demo-kiosco')).toBeUndefined(); // un comercio demo nunca es visitante
    expect(await q.visitor('t-kiosco-ana')).toBeUndefined(); // tiene demo: su historia es la de la demo
  });

  it('el pago es el primero del titular desde que nace el comercio', async () => {
    await db()
      .system.insertInto('paid_movements')
      .values([
        { id: 'pm0', user_id: 'u_ana', tenant_id: null, kind: 'payment', amount: 5000, day: '2026-10-04', created_at: '2026-10-04T12:00:00.000Z' },
        { id: 'pm1', user_id: 'u_ana', tenant_id: 'kiosco-ana', kind: 'payment', amount: 5000, day: '2026-10-06', created_at: '2026-10-06T12:00:00.000Z' },
      ])
      .execute();
    expect((await q.visitor('demo_a'))?.stages.find((s) => s.stage === 'payment')?.at).toBe('2026-10-06T12:00:00.000Z');
  });
});
