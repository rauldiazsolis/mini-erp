import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { impersonate } from './helpers/impersonate.ts';

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
  let systemDb: DatabaseSync;
  let tokens: { support: string; root: string; owner: string; ownerId: string };
  let clock: Date;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    clock = new Date('2026-10-05T15:00:00.000Z');
    bundle = createApp({
      systemDb,
      tenantManager,
      now: () => clock,
      demoConfig: { enabled: true, ttlHours: 24, maxActive: 50, resetHour: 4 },
    });
    app = bundle.app;
    bundle.demoSessions.ensureDemoTenants();
    const support = bundle.authService.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Ana' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    bundle.authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const rootToken = bundle.authService.login({ email: 'root@x.com', password: 'password123' }).token;
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Juan' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco', ownerUserId: owner.user.id });
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
    const db = bundle.tenantManager.getTenantDb('demo-kiosco');
    const today = db.prepare("SELECT COUNT(*) AS n FROM sales WHERE day = '2026-10-05' AND voids_sale_id IS NULL").get() as { n: number };
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
    const audit = systemDb.prepare("SELECT actor_user_id AS actor, tenant_id, details FROM audit_log WHERE action = 'demo.reset'").all() as {
      actor: string;
      tenant_id: string;
      details: string;
    }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]?.tenant_id).toBe('demo-kiosco');
    expect(JSON.parse(audit[0]?.details ?? '{}')).toEqual({ template: 'kiosco', kind: 'partial' });
  });

  it('el reinicio total sin rubro reinicia los tres y revoca todas las cajas', async () => {
    const a = await demo();
    const b = await demo('ferreteria');
    const res = await request(app).post('/api/platform/demos/reset').set(as(tokens.root)).send({ kind: 'full' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: ['kiosco', 'almacen', 'ferreteria'], revoked: 2 });
    expect((await pull(a)).status).toBe(401);
    expect((await pull(b)).status).toBe(401);
    expect(systemDb.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'demo.reset'").get()).toEqual({ n: 3 });
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
    systemDb
      .prepare(
        "INSERT INTO audit_log (id, at, actor_user_id, tenant_id, action, details) VALUES ('a-auto', ?, 'system', 'demo-almacen', 'demo.reset', '{}')",
      )
      .run(new Date(clock.getTime() + 1000).toISOString());
    const res = await request(app).get('/api/platform/audit').set(as(tokens.support));
    const items = res.body as { action: string; actorName: string; tenantName: string | null }[];
    expect(items.filter((i) => i.action === 'demo.reset').map((i) => [i.actorName, i.tenantName])).toEqual([
      ['Automático', 'Almacén Demo'],
      ['Ana', 'Kiosco Demo'],
    ]);
  });
});
