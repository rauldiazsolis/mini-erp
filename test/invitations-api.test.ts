import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('invitaciones por link (#19)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let clock: Date;
  let owner: string;
  let tenantId: string;

  beforeEach(async () => {
    clock = new Date('2026-10-01T10:00:00Z');
    systemDb = openSystemDb(':memory:');
    app = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }), now: () => clock }).app;
    const res = await request(app)
      .post('/api/alta')
      .send({ name: 'Ana', email: 'ana@k.com', password: 'clave-ana-1', businessName: 'Kiosco Ana', template: 'empty' });
    const body = res.body as { token: string; tenant: { id: string } };
    owner = body.token;
    tenantId = body.tenant.id;
  });

  async function invitar(email: string, role: string, token = owner): Promise<request.Response> {
    return request(app).post(`/api/tenants/${tenantId}/invitations`).set('Authorization', `Bearer ${token}`).send({ email, role });
  }

  it('el owner invita; el link sirve una vez y crea la cuenta con la membresía', async () => {
    const created = await invitar('Juan@K.com', 'member');
    expect(created.status).toBe(201);
    const inv = created.body as { token: string; expiresAt: string };
    expect(inv.expiresAt).toBe('2026-10-03T10:00:00.000Z');
    const stored = systemDb.prepare('SELECT token_hash FROM invitations').get() as { token_hash: string };
    expect(stored.token_hash).not.toBe(inv.token);

    const info = await request(app).post('/api/invitations/lookup').send({ token: inv.token });
    expect(info.body).toMatchObject({ tenantName: 'Kiosco Ana', role: 'member', email: 'juan@k.com', invitedByName: 'Ana', accountExists: false });

    const acc = await request(app).post('/api/invitations/accept').send({ token: inv.token, name: 'Juan', password: 'clave-juan-1' });
    expect(acc.status).toBe(200);
    expect((acc.body as { tenantId: string }).tenantId).toBe(tenantId);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${(acc.body as { token: string }).token}`);
    expect((me.body as { tenants: { role: string }[] }).tenants[0]?.role).toBe('member');

    const again = await request(app).post('/api/invitations/accept').send({ token: inv.token, name: 'Juan', password: 'clave-juan-1' });
    expect(again.status).toBe(410);
    expect((again.body as { error: string }).error).toBe('Este link ya no sirve: pedile uno nuevo a quien te lo mandó');
  });

  it('una cuenta nueva necesita nombre y el mínimo de contraseña', async () => {
    const inv = (await invitar('juan@k.com', 'member')).body as { token: string };
    expect((await request(app).post('/api/invitations/accept').send({ token: inv.token, password: 'clave-juan-1' })).status).toBe(400);
    const corta = await request(app).post('/api/invitations/accept').send({ token: inv.token, name: 'Juan', password: '1234567' });
    expect(corta.status).toBe(400);
    expect((corta.body as { error: string }).error).toBe('La contraseña debe tener al menos 8 caracteres');
  });

  it('con cuenta existente pide su contraseña y suma la membresía', async () => {
    await request(app).post('/api/alta').send({ name: 'Bea', email: 'bea@k.com', password: 'clave-bea-1', businessName: 'Otro', template: 'empty' });
    const inv = (await invitar('bea@k.com', 'admin')).body as { token: string };
    expect(((await request(app).post('/api/invitations/lookup').send({ token: inv.token })).body as { accountExists: boolean }).accountExists).toBe(true);
    expect((await request(app).post('/api/invitations/accept').send({ token: inv.token, password: 'equivocada' })).status).toBe(401);
    const ok = await request(app).post('/api/invitations/accept').send({ token: inv.token, password: 'clave-bea-1' });
    expect(ok.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${(ok.body as { token: string }).token}`);
    expect((me.body as { tenants: unknown[] }).tenants).toHaveLength(2);
  });

  it('vence a las 48 h', async () => {
    const inv = (await invitar('juan@k.com', 'member')).body as { token: string };
    clock = new Date('2026-10-03T10:00:01Z');
    expect((await request(app).post('/api/invitations/lookup').send({ token: inv.token })).status).toBe(410);
  });

  it('una invitación nueva al mismo mail revoca la anterior; revocar corta el link', async () => {
    const a = (await invitar('juan@k.com', 'member')).body as { token: string };
    const b = (await invitar('juan@k.com', 'admin')).body as { id: string; token: string };
    expect((await request(app).post('/api/invitations/lookup').send({ token: a.token })).status).toBe(410);
    const del = await request(app).delete(`/api/tenants/${tenantId}/invitations/${b.id}`).set('Authorization', `Bearer ${owner}`);
    expect(del.status).toBe(200);
    expect((await request(app).post('/api/invitations/lookup').send({ token: b.token })).status).toBe(410);
    expect((await request(app).delete(`/api/tenants/${tenantId}/invitations/${b.id}`).set('Authorization', `Bearer ${owner}`)).status).toBe(404);
  });

  it('invitar a quien ya es miembro: 409; el admin no invita owners', async () => {
    expect((await invitar('ana@k.com', 'member')).status).toBe(409);
    const inv = (await invitar('adm@k.com', 'admin')).body as { token: string };
    const adm = (await request(app).post('/api/invitations/accept').send({ token: inv.token, name: 'Adm', password: 'clave-adm-1' })).body as { token: string };
    expect((await invitar('otro@k.com', 'owner', adm.token)).status).toBe(403);
    expect((await invitar('otro@k.com', 'member', adm.token)).status).toBe(201);
  });

  it('crear, revocar y aceptar quedan en la auditoría', async () => {
    const a = (await invitar('juan@k.com', 'member')).body as { id: string };
    await request(app).delete(`/api/tenants/${tenantId}/invitations/${a.id}`).set('Authorization', `Bearer ${owner}`);
    const b = (await invitar('juan@k.com', 'member')).body as { token: string };
    await request(app).post('/api/invitations/accept').send({ token: b.token, name: 'Juan', password: 'clave-juan-1' });
    const actions = (systemDb.prepare('SELECT action FROM audit_log ORDER BY at, rowid').all() as { action: string }[]).map((r) => r.action);
    expect(actions).toEqual(['tenant.created', 'invitation.created', 'invitation.revoked', 'invitation.created', 'invitation.accepted']);
  });
});
