import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import type { AuthService } from '../src/server/auth/auth-service.ts';

describe('invitaciones de soporte (#23)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let authService: AuthService;
  let now: Date;
  let tokens: { root: string; support: string };

  beforeEach(() => {
    now = new Date('2026-10-05T15:00:00.000Z');
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => now });
    app = bundle.app;
    authService = bundle.authService;
    authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const support = authService.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Soporte' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    const owner = authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco', ownerUserId: owner.user.id });
    tokens = {
      root: authService.login({ email: 'root@x.com', password: 'password123' }).token,
      support: authService.login({ email: 'soporte@x.com', password: 'password123' }).token,
    };
  });

  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const invite = async (email: string) => {
    const res = await request(app).post('/api/platform/staff/invitations').set(as('root')).send({ email });
    return res.body as { id: string; token: string; expiresAt: string };
  };
  const accept = (body: Record<string, unknown>) => request(app).post('/api/staff-invitations/accept').send(body);
  const actions = () =>
    (systemDb.prepare("SELECT action FROM audit_log WHERE action LIKE 'staff.%' ORDER BY at, rowid").all() as { action: string }[]).map((r) => r.action);

  it('root invita a soporte; con un mail nuevo nace una cuenta de soporte con sesión', async () => {
    const res = await request(app).post('/api/platform/staff/invitations').set(as('root')).send({ email: 'Nueva@X.com' });
    expect(res.status).toBe(201);
    const { token } = res.body as { token: string };
    const info = await request(app).post('/api/staff-invitations/lookup').send({ token });
    expect(info.body).toMatchObject({ email: 'nueva@x.com', invitedByName: 'Root', accountExists: false });
    expect((await accept({ token, password: 'corta', name: 'Ana' })).status).toBe(400);
    const acc = await accept({ token, password: 'clave-nueva-1', name: 'Ana' });
    expect(acc.status).toBe(200);
    expect((acc.body as { user: { globalRole: string; name: string } }).user).toMatchObject({ globalRole: 'support', name: 'Ana' });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${(acc.body as { token: string }).token}`);
    expect((me.body as { user: { globalRole: string } }).user.globalRole).toBe('support');
    expect((await accept({ token, password: 'clave-nueva-1', name: 'Ana' })).status).toBe(410);
    expect(actions()).toEqual(['staff.invited', 'staff.joined']);
  });

  it('una cuenta existente sin comercios se promueve con su contraseña; con comercios, 409', async () => {
    const libre = authService.createUser({ email: 'libre@x.com', password: 'password123', name: 'Libre' });
    const t1 = (await invite('libre@x.com')).token;
    expect((await request(app).post('/api/staff-invitations/lookup').send({ token: t1 })).body).toMatchObject({ accountExists: true });
    expect((await accept({ token: t1, password: 'mala' })).status).toBe(401);
    expect((await accept({ token: t1, password: 'password123' })).status).toBe(200);
    expect(systemDb.prepare('SELECT global_role FROM users WHERE id = ?').get(libre.user.id)).toEqual({ global_role: 'support' });

    const t2 = (await invite('owner@x.com')).token;
    const conComercio = await accept({ token: t2, password: 'password123' });
    expect(conComercio.status).toBe(409);
    expect(conComercio.body).toEqual({ error: 'Esa cuenta es de un comercio: usá otro mail' });
  });

  it('no se invita a quien ya es del equipo', async () => {
    const res = await request(app).post('/api/platform/staff/invitations').set(as('root')).send({ email: 'soporte@x.com' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Esa cuenta ya es del equipo' });
  });

  it('solo root invita, lista y revoca; una invitación nueva reemplaza a la pendiente', async () => {
    expect((await request(app).post('/api/platform/staff/invitations').set(as('support')).send({ email: 'a@x.com' })).status).toBe(403);
    expect((await request(app).get('/api/platform/staff').set(as('support'))).status).toBe(403);
    const first = await invite('a@x.com');
    const second = await invite('a@x.com');
    expect((await request(app).post('/api/staff-invitations/lookup').send({ token: first.token })).status).toBe(410);
    const list = await request(app).get('/api/platform/staff').set(as('root'));
    const body = list.body as { members: { email: string; globalRole: string }[]; invitations: { email: string; invitedByName: string }[] };
    expect(body.invitations).toEqual([expect.objectContaining({ email: 'a@x.com', invitedByName: 'Root' })]);
    expect(body.members.map((m) => [m.email, m.globalRole])).toEqual([
      ['root@x.com', 'root'],
      ['soporte@x.com', 'support'],
    ]);
    expect((await request(app).delete(`/api/platform/staff/invitations/${second.id}`).set(as('root'))).status).toBe(200);
    expect((await request(app).post('/api/staff-invitations/lookup').send({ token: second.token })).status).toBe(410);
    expect((await request(app).delete(`/api/platform/staff/invitations/${second.id}`).set(as('root'))).status).toBe(404);
    expect(actions()).toEqual(['staff.invited', 'staff.invited', 'staff.invitation_revoked']);
  });

  it('vence a las 48 h', async () => {
    const { token } = await invite('tarde@x.com');
    now = new Date(now.getTime() + 48 * 60 * 60 * 1000 + 1);
    expect((await request(app).post('/api/staff-invitations/lookup').send({ token })).status).toBe(410);
  });
});
