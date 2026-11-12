import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { impersonate } from './helpers/impersonate.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

const MSG = 'No disponible mientras ves como otro usuario';

describe('lo que no puede quien impersona (#23, M7b)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let imp: string;
  let ids: { owner: string; support: string; coOwner: string; admin: string };

  beforeEach(async () => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(db().system, { inMemory: true });
    const bundle = createApp({ database: db(), systemDb, tenantManager, now: () => new Date('2026-10-05T15:00:00.000Z') });
    app = bundle.app;
    const auth = bundle.authService;
    const support = await auth.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Ana' });
    await db().system.updateTable('users').set({ global_role: 'support' }).where('id', '=', support.user.id).execute();
    const owner = await auth.createUser({ email: 'juan@x.com', password: 'password123', name: 'Juan' });
    await tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco X', ownerUserId: owner.user.id });
    const coOwner = await auth.createUser({ email: 'co@x.com', password: 'password123', name: 'Co' });
    const admin = await auth.createUser({ email: 'adm@x.com', password: 'password123', name: 'Adm' });
    await db()
      .system.insertInto('memberships')
      .values([
        { user_id: coOwner.user.id, tenant_id: 'kiosco', role: 'owner', status: 'active', created_at: '2026-10-01T00:00:00.000Z' },
        { user_id: admin.user.id, tenant_id: 'kiosco', role: 'admin', status: 'active', created_at: '2026-10-01T00:00:00.000Z' },
      ])
      .execute();
    ids = { owner: owner.user.id, support: support.user.id, coOwner: coOwner.user.id, admin: admin.user.id };
    imp = await impersonate(app, support.token, owner.user.id, 'kiosco');
  });

  const as = () => ({ Authorization: `Bearer ${imp}` });
  const expect403 = (res: { status: number; body: unknown }) => {
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe(MSG);
  };

  it('no cambia la contraseña ni genera links de restablecimiento', async () => {
    expect403(await request(app).post('/api/auth/password').set(as()).send({ currentPassword: 'password123', newPassword: 'otra-clave-1' }));
    expect403(await request(app).post(`/api/tenants/kiosco/users/${ids.admin}/password-reset`).set(as()).send({}));
  });

  it('no nombra owners: ni invita como owner ni cambia el rol o el estado de un owner', async () => {
    expect403(await request(app).post('/api/tenants/kiosco/invitations').set(as()).send({ email: 'nuevo@x.com', role: 'owner' }));
    expect403(await request(app).patch(`/api/tenants/kiosco/users/${ids.admin}`).set(as()).send({ role: 'owner' }));
    expect403(await request(app).patch(`/api/tenants/kiosco/users/${ids.coOwner}`).set(as()).send({ status: 'disabled' }));
    // Lo demás de Usuarios, sí
    expect((await request(app).post('/api/tenants/kiosco/invitations').set(as()).send({ email: 'nuevo@x.com', role: 'member' })).status).toBe(201);
    expect((await request(app).patch(`/api/tenants/kiosco/users/${ids.admin}`).set(as()).send({ role: 'member' })).status).toBe(200);
  });

  it('no crea comercios, no acepta invitaciones ni usa la plataforma', async () => {
    expect403(await request(app).post('/api/alta').set(as()).send({ businessName: 'Otro', businessType: 'kiosco' }));
    expect403(await request(app).post('/api/invitations/accept').set(as()).send({ token: 'x', password: 'password123' }));
    expect403(await request(app).post('/api/staff-invitations/accept').set(as()).send({ token: 'x', password: 'password123' }));
    expect403(await request(app).get('/api/platform/tenants').set(as()));
    expect403(await request(app).post('/api/impersonations').set(as()).send({ userId: ids.admin }));
  });

  it('la auditoría guarda los dos y la lectura devuelve el nombre de quien impersona', async () => {
    await request(app).post('/api/tenants/kiosco/invitations').set(as()).send({ email: 'nuevo@x.com', role: 'member' });
    expect(systemDb.prepare("SELECT actor_user_id, impersonator_user_id FROM audit_log WHERE action = 'invitation.created'").all()).toEqual([
      { actor_user_id: ids.owner, impersonator_user_id: ids.support },
    ]);
    const activity = await request(app).get('/api/tenants/kiosco/audit').set(as());
    const created = (activity.body as { action: string; actorName: string; impersonatorName: string | null }[]).find(
      (e) => e.action === 'invitation.created',
    );
    expect(created).toMatchObject({ actorName: 'Juan', impersonatorName: 'Ana' });
  });

  it('un comercio suspendido no bloquea a quien impersona', async () => {
    systemDb
      .prepare("INSERT INTO tenant_suspensions (id, tenant_id, from_at, to_at, reason, created_by) VALUES ('s1', 'kiosco', '2026-10-05T14:00:00.000Z', NULL, 'Prueba', ?)")
      .run(ids.support);
    systemDb.prepare("UPDATE tenants SET status = 'suspended' WHERE id = 'kiosco'").run();
    expect((await request(app).get('/api/tenants/kiosco/products').set(as())).status).toBe(200);
  });
});
