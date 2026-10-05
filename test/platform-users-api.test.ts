import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('usuarios desde la plataforma (#23)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let tokens: { root: string; support: string; owner: string };
  let ids: { root: string; support: string; support2: string; owner: string };

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => new Date('2026-10-05T15:00:00.000Z') });
    app = bundle.app;
    const root = bundle.authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const support = bundle.authService.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Soporte' });
    const support2 = bundle.authService.createUser({ email: 'soporte2@x.com', password: 'password123', name: 'Soporte 2' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id IN (?, ?)").run(support.user.id, support2.user.id);
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco', ownerUserId: owner.user.id });
    ids = { root: root.user.id, support: support.user.id, support2: support2.user.id, owner: owner.user.id };
    tokens = {
      root: bundle.authService.login({ email: 'root@x.com', password: 'password123' }).token,
      support: bundle.authService.login({ email: 'soporte@x.com', password: 'password123' }).token,
      owner: owner.token,
    };
  });

  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: keyof typeof tokens, path: string) => request(app).post(`/api/platform/users/${path}`).set(as(who)).send({});
  const actions = () => (systemDb.prepare('SELECT action FROM audit_log ORDER BY at, rowid').all() as { action: string }[]).map((r) => r.action);

  it('soporte desactiva a un usuario: no puede entrar, sus sesiones se cierran y reactivarlo lo deja entrar', async () => {
    expect((await post('support', `${ids.owner}/disable`)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(as('owner'))).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ email: 'owner@x.com', password: 'password123' });
    expect(login.status).toBe(401);
    expect(login.body).toEqual({ error: 'Cuenta desactivada: escribile a soporte' });
    expect((await post('support', `${ids.owner}/enable`)).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'owner@x.com', password: 'password123' })).status).toBe(200);
    expect(actions().filter((a) => a.startsWith('user.'))).toEqual(['user.disabled', 'user.enabled']);
  });

  it('nadie desactiva a root ni a sí mismo; soporte no toca a soporte; root sí', async () => {
    expect((await post('support', `${ids.root}/disable`)).status).toBe(403);
    expect((await post('support', `${ids.support}/disable`)).status).toBe(403);
    expect((await post('support', `${ids.support2}/disable`)).status).toBe(403);
    expect((await post('root', `${ids.support2}/disable`)).status).toBe(200);
    expect((await post('root', `${ids.root}/disable`)).status).toBe(403);
    expect((await post('root', 'nadie/disable')).status).toBe(404);
  });

  it('root y soporte generan un link de restablecimiento sin comercio para un usuario, no para el equipo', async () => {
    const res = await post('support', `${ids.owner}/password-reset`);
    expect(res.status).toBe(201);
    const { token } = res.body as { token: string };
    expect((await request(app).post('/api/password-resets/complete').send({ token, password: 'nueva-clave-1' })).status).toBe(200);
    expect(systemDb.prepare("SELECT tenant_id FROM audit_log WHERE action IN ('password.reset_link_created', 'password.reset')").all()).toEqual([
      { tenant_id: null },
      { tenant_id: null },
    ]);
    expect((await post('root', `${ids.support2}/password-reset`)).status).toBe(403);
    expect((await post('root', 'nadie/password-reset')).status).toBe(404);
  });

  it('un owner no usa estas rutas', async () => {
    expect((await post('owner', `${ids.support2}/disable`)).status).toBe(403);
    expect((await post('owner', `${ids.support2}/password-reset`)).status).toBe(403);
  });
});
