import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { impersonate } from './helpers/impersonate.ts';
import { setupTestDb } from './helpers/test-db.ts';
import { jsonValue } from '../src/server/db/pg/sql-helpers.ts';

const pgDb = setupTestDb();

const V = { 'X-POS-Contract-Version': '4.6.0' };

type DemoStatus = {
  template: string;
  tenantId: string;
  name: string;
  activeRegisters: number;
  createdToday: number;
  salesToday: number;
  lastFullResetAt: string;
  lastPartialResetAt: string | null;
};

describe('demos en la plataforma (#24)', () => {
  let app: Express;
  let bundle: ReturnType<typeof createApp>;
  let tokens: { support: string; root: string; owner: string; ownerId: string };
  let clock: Date;

  beforeEach(async () => {
    const tenantManager = new TenantManager(pgDb(), { inMemory: true });
    clock = new Date('2026-10-05T15:00:00.000Z');
    bundle = createApp({ database: pgDb(),
      tenantManager,
      now: () => clock,
      demoConfig: { enabled: true, ttlHours: 24, maxActive: 50, resetHour: 4 },
    });
    app = bundle.app;
    await bundle.demoSessions.ensureDemoTenants();
    const support = await bundle.authService.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Ana' });
    await pgDb().system.updateTable('users').set({ global_role: 'support' }).where('id', '=', support.user.id).execute();
    await bundle.authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const rootToken = (await bundle.authService.login({ email: 'root@x.com', password: 'password123' })).token;
    const owner = await bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Juan' });
    await tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco', ownerUserId: owner.user.id });
    tokens = { support: support.token, root: rootToken, owner: owner.token, ownerId: owner.user.id };
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const demo = async (template = 'kiosco'): Promise<string> =>
    ((await request(app).post('/connector/demo-sessions').set(V).send({ template })).body as { apiKey: string }).apiKey;
  const pull = async (apiKey: string) =>
    request(app).post('/connector/sync/pull').set({ Authorization: `Bearer ${apiKey}`, ...V }).send({ cursors: {}, pendingLotIds: [] });

  it('lista los tres comercios demo con sus cajas activas y las ventas de hoy', async () => {
    await demo();
    await demo();
    await demo('almacen');
    const res = await request(app).get('/api/platform/demos').set(as(tokens.support));
    expect(res.status).toBe(200);
    const rows = res.body as DemoStatus[];
    expect(rows.map((r) => [r.template, r.name, r.activeRegisters, r.createdToday])).toEqual([
      ['kiosco', 'Kiosco Demo', 2, 2],
      ['almacen', 'Almacén Demo', 1, 1],
      ['ferreteria', 'Ferretería Demo', 0, 0],
    ]);
    const today = await bundle.tenantManager
      .forTenant('demo-kiosco')
      .selectFrom('sales')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('day', '=', '2026-10-05')
      .where('voids_sale_id', 'is', null)
      .executeTakeFirstOrThrow();
    expect(today.n).toBeGreaterThan(0);
    expect(rows[0]?.salesToday).toBe(today.n);
    expect(rows[0]?.lastFullResetAt).toBe(clock.toISOString());
    expect(rows[0]?.lastPartialResetAt).toBeNull();
  });

  it('soporte hace un reinicio parcial: la key sigue andando y queda auditado', async () => {
    const apiKey = await demo();
    const res = await request(app).post('/api/platform/demos/reset').set(as(tokens.support)).send({ template: 'kiosco', kind: 'partial' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: ['kiosco'], revoked: 0 });
    expect((await pull(apiKey)).status).toBe(200);
    const audit = await pgDb().system.selectFrom('audit_log').select(['tenant_id', 'details']).where('action', '=', 'demo.reset').execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.tenant_id).toBe('demo-kiosco');
    expect(audit[0]?.details).toEqual({ template: 'kiosco', kind: 'partial' });
  });

  it('el reinicio total sin rubro reinicia los tres y revoca todas las cajas', async () => {
    const a = await demo();
    const b = await demo('ferreteria');
    const res = await request(app).post('/api/platform/demos/reset').set(as(tokens.root)).send({ kind: 'full' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: ['kiosco', 'almacen', 'ferreteria'], revoked: 2 });
    expect((await pull(a)).status).toBe(401);
    expect((await pull(b)).status).toBe(401);
    const n = await pgDb().system.selectFrom('audit_log').select((eb) => eb.fn.countAll<number>().as('n')).where('action', '=', 'demo.reset').executeTakeFirst();
    expect(n).toEqual({ n: 3 });
  });

  it('400 con un rubro o un tipo desconocidos', async () => {
    expect((await request(app).post('/api/platform/demos/reset').set(as(tokens.support)).send({ template: 'otro', kind: 'full' })).status).toBe(400);
    expect((await request(app).post('/api/platform/demos/reset').set(as(tokens.support)).send({ kind: 'x' })).status).toBe(400);
  });

  it('ni un owner ni una impersonación', async () => {
    expect((await request(app).get('/api/platform/demos').set(as(tokens.owner))).status).toBe(403);
    const imp = await impersonate(app, tokens.support, tokens.ownerId);
    expect((await request(app).post('/api/platform/demos/reset').set(as(imp)).send({ kind: 'full' })).status).toBe(403);
  });

  it('el registro de la plataforma muestra el reinicio y el automático sale como "Automático"', async () => {
    await request(app).post('/api/platform/demos/reset').set(as(tokens.support)).send({ template: 'kiosco', kind: 'partial' });
    await pgDb()
      .system.insertInto('audit_log')
      .values({
        id: 'a-auto',
        at: new Date(clock.getTime() + 1000).toISOString(),
        actor_user_id: 'system',
        tenant_id: 'demo-almacen',
        action: 'demo.reset',
        details: jsonValue({}),
      })
      .execute();
    const res = await request(app).get('/api/platform/audit').set(as(tokens.support));
    const items = res.body as { action: string; actorName: string; tenantName: string | null }[];
    expect(items.filter((i) => i.action === 'demo.reset').map((i) => [i.actorName, i.tenantName])).toEqual([
      ['Automático', 'Almacén Demo'],
      ['Ana', 'Kiosco Demo'],
    ]);
  });
});
