import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { impersonate } from './helpers/impersonate.ts';

const MIN = 60 * 1000;

describe('sesión de impersonación (#23, M7b)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let now: Date;
  let tokens: { root: string; support: string; owner: string; otherSupport: string };
  let ids: { owner: string; support: string; root: string; lonely: string; disabled: string; otherSupport: string };

  beforeEach(() => {
    now = new Date('2026-10-05T15:00:00.000Z');
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => now });
    app = bundle.app;
    const auth = bundle.authService;
    const root = auth.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' }).user;
    const support = auth.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Ana' });
    const otherSupport = auth.createUser({ email: 'soporte2@x.com', password: 'password123', name: 'Beto' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id IN (?, ?)").run(support.user.id, otherSupport.user.id);
    const owner = auth.createUser({ email: 'juan@x.com', password: 'password123', name: 'Juan' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco X', ownerUserId: owner.user.id });
    tenantManager.createTenant({ id: 'almacen', slug: 'almacen', name: 'Almacén Y', ownerUserId: owner.user.id });
    const lonely = auth.createUser({ email: 'solo@x.com', password: 'password123', name: 'Sin comercio' });
    const disabled = auth.createUser({ email: 'baja@x.com', password: 'password123', name: 'De baja' });
    tenantManager.createTenant({ id: 'otro', slug: 'otro', name: 'Otro', ownerUserId: disabled.user.id });
    systemDb.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(disabled.user.id);
    tokens = {
      root: auth.login({ email: 'root@x.com', password: 'password123' }).token,
      support: support.token,
      otherSupport: otherSupport.token,
      owner: owner.token,
    };
    ids = {
      owner: owner.user.id,
      support: support.user.id,
      root: root.id,
      lonely: lonely.user.id,
      disabled: disabled.user.id,
      otherSupport: otherSupport.user.id,
    };
  });

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const audit = () =>
    systemDb
      .prepare("SELECT action, actor_user_id, target_user_id, tenant_id, details FROM audit_log WHERE action LIKE 'impersonation.%' ORDER BY rowid")
      .all() as { action: string; actor_user_id: string; target_user_id: string; tenant_id: string; details: string }[];

  it('soporte entra como el usuario: su token, su rol y el impersonador en /auth/me', async () => {
    const res = await request(app).post('/api/impersonations').set(bearer(tokens.support)).send({ userId: ids.owner });
    expect(res.status).toBe(201);
    const body = res.body as { token: string; user: { id: string }; impersonator: unknown; tenantSlug: string; path: string };
    expect(body.user.id).toBe(ids.owner);
    expect(body.impersonator).toEqual({ id: ids.support, name: 'Ana', globalRole: 'support' });
    expect(body.tenantSlug).toBe('almacen'); // la membresía más reciente
    expect(body.path).toBe('/admin/almacen/dashboard');
    const me = await request(app).get('/api/auth/me').set(bearer(body.token));
    expect(me.status).toBe(200);
    const meBody = me.body as { user: { id: string }; impersonator: { id: string } };
    expect(meBody.user.id).toBe(ids.owner);
    expect(meBody.impersonator.id).toBe(ids.support);
    expect((await request(app).get('/api/tenants/kiosco/products').set(bearer(body.token))).status).toBe(200);
    expect(audit()).toEqual([
      { action: 'impersonation.started', actor_user_id: ids.support, target_user_id: ids.owner, tenant_id: 'almacen', details: '{}' },
    ]);
  });

  it('con tenantSlug entra a ese comercio; uno donde no es miembro activo da 409', async () => {
    const res = await request(app).post('/api/impersonations').set(bearer(tokens.root)).send({ userId: ids.owner, tenantSlug: 'kiosco' });
    expect((res.body as { path: string }).path).toBe('/admin/kiosco/dashboard');
    const ajeno = await request(app).post('/api/impersonations').set(bearer(tokens.root)).send({ userId: ids.owner, tenantSlug: 'otro' });
    expect(ajeno.status).toBe(409);
  });

  it('a quién no: root, soporte, desactivados, sin comercios o inexistentes; y solo root o soporte con sesión propia', async () => {
    const start = (token: string, userId: string) => request(app).post('/api/impersonations').set(bearer(token)).send({ userId });
    expect((await start(tokens.support, ids.root)).status).toBe(403);
    expect((await start(tokens.support, ids.otherSupport)).status).toBe(403);
    expect((await start(tokens.support, ids.disabled)).status).toBe(409);
    expect((await start(tokens.support, ids.lonely)).status).toBe(409);
    expect((await start(tokens.support, 'usr_no_existe')).status).toBe(404);
    expect((await start(tokens.owner, ids.owner)).status).toBe(403);
    const imp = await impersonate(app, tokens.support, ids.owner);
    expect((await start(imp, ids.owner)).status).toBe(403);
  });

  it('vence a las 2 h sin uso: cada uso la estira (a lo sumo una escritura por minuto)', async () => {
    const imp = await impersonate(app, tokens.support, ids.owner);
    const use = () => request(app).get('/api/auth/me').set(bearer(imp));
    const lastUsed = () => (systemDb.prepare('SELECT last_used_at FROM sessions WHERE token = ?').get(imp) as { last_used_at: string }).last_used_at;
    now = new Date(now.getTime() + 30 * MIN);
    expect((await use()).status).toBe(200);
    expect(lastUsed()).toBe('2026-10-05T15:30:00.000Z');
    now = new Date(now.getTime() + 30 * 1000); // medio minuto: no escribe
    expect((await use()).status).toBe(200);
    expect(lastUsed()).toBe('2026-10-05T15:30:00.000Z');
    now = new Date('2026-10-05T17:29:00.000Z'); // 1 h 59 desde el último uso
    expect((await use()).status).toBe(200);
    now = new Date('2026-10-05T19:30:00.000Z'); // 2 h 01 sin uso
    expect((await use()).status).toBe(401);
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(imp)).toEqual({ n: 0 });
    expect(audit().at(-1)).toMatchObject({ action: 'impersonation.ended', details: JSON.stringify({ reason: 'expired' }) });
  });

  it('"Salir" la termina; con una sesión propia es 400', async () => {
    const imp = await impersonate(app, tokens.support, ids.owner);
    expect((await request(app).delete('/api/impersonations/current').set(bearer(imp))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(imp))).status).toBe(401);
    expect(audit().at(-1)).toMatchObject({ action: 'impersonation.ended', actor_user_id: ids.support, details: JSON.stringify({ reason: 'exit' }) });
    expect((await request(app).delete('/api/impersonations/current').set(bearer(tokens.support))).status).toBe(400);
    // La sesión de soporte sigue
    expect((await request(app).get('/api/auth/me').set(bearer(tokens.support))).status).toBe(200);
  });

  it('muere con la sesión padre: el logout de soporte la corta', async () => {
    const imp = await impersonate(app, tokens.support, ids.owner);
    expect((await request(app).post('/api/auth/logout').set(bearer(tokens.support))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(tokens.support))).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(bearer(imp))).status).toBe(401);
    expect(audit().at(-1)).toMatchObject({ action: 'impersonation.ended', details: JSON.stringify({ reason: 'parent-ended' }) });
  });

  it('muere si soporte queda desactivado', async () => {
    const imp = await impersonate(app, tokens.otherSupport, ids.owner);
    expect((await request(app).post(`/api/platform/users/${ids.otherSupport}/disable`).set(bearer(tokens.root)).send({})).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(imp))).status).toBe(401);
  });
});
