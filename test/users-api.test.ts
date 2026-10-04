import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

type Users = {
  members: { userId: string; email: string; role: string; status: string; canReset: boolean }[];
  invitations: { email: string; invitedByName: string }[];
};

describe('usuarios del comercio (#19)', () => {
  let app: Express;
  let tenantId: string;
  const t: Record<'owner' | 'admin' | 'member', string> = { owner: '', admin: '', member: '' };
  const ids: Record<'owner' | 'admin' | 'member', string> = { owner: '', admin: '', member: '' };

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    app = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }) }).app;
    const alta = (await request(app)
      .post('/api/alta')
      .send({ name: 'Ana', email: 'ana@k.com', password: 'clave-ana-1', businessName: 'Kiosco Ana', businessType: 'otro', whatsapp: '1155550000' })).body as {
      token: string;
      user: { id: string };
      tenant: { id: string };
    };
    t.owner = alta.token;
    ids.owner = alta.user.id;
    tenantId = alta.tenant.id;
    for (const role of ['admin', 'member'] as const) {
      const inv = (await request(app)
        .post(`/api/tenants/${tenantId}/invitations`)
        .set('Authorization', `Bearer ${t.owner}`)
        .send({ email: `${role}@k.com`, role })).body as { token: string };
      const acc = (await request(app)
        .post('/api/invitations/accept')
        .send({ token: inv.token, name: role, password: 'clave-larga-1' })).body as { token: string; user: { id: string } };
      t[role] = acc.token;
      ids[role] = acc.user.id;
    }
  });

  const patch = (token: string, userId: string, body: object) =>
    request(app).patch(`/api/tenants/${tenantId}/users/${userId}`).set('Authorization', `Bearer ${token}`).send(body);

  it('lista miembros e invitaciones pendientes', async () => {
    await request(app)
      .post(`/api/tenants/${tenantId}/invitations`)
      .set('Authorization', `Bearer ${t.owner}`)
      .send({ email: 'nuevo@k.com', role: 'member' });
    const res = (await request(app).get(`/api/tenants/${tenantId}/users`).set('Authorization', `Bearer ${t.owner}`)).body as Users;
    expect(res.members.map((m) => m.role)).toEqual(['owner', 'admin', 'member']);
    expect(res.members.map((m) => m.canReset)).toEqual([false, true, true]);
    expect(res.invitations).toEqual([expect.objectContaining({ email: 'nuevo@k.com', invitedByName: 'Ana' })]);
  });

  it('el admin ve los usuarios pero no puede restablecer', async () => {
    const res = (await request(app).get(`/api/tenants/${tenantId}/users`).set('Authorization', `Bearer ${t.admin}`)).body as Users;
    expect(res.members.every((m) => !m.canReset)).toBe(true);
    expect((await request(app).get(`/api/tenants/${tenantId}/users`).set('Authorization', `Bearer ${t.member}`)).status).toBe(403);
  });

  it('desactivar corta el acceso al instante; reactivar lo devuelve', async () => {
    const res = await patch(t.owner, ids.member, { status: 'disabled' });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('disabled');
    expect((await request(app).get(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${t.member}`)).status).toBe(403);
    await patch(t.owner, ids.member, { status: 'active' });
    expect((await request(app).get(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${t.member}`)).status).toBe(200);
  });

  it('nadie cambia su propia membresía; el admin no toca owners ni nombra owners', async () => {
    expect((await patch(t.owner, ids.owner, { role: 'admin' })).status).toBe(403);
    expect((await patch(t.admin, ids.owner, { status: 'disabled' })).status).toBe(403);
    expect((await patch(t.admin, ids.member, { role: 'owner' })).status).toBe(403);
    expect((await patch(t.admin, ids.member, { role: 'admin' })).status).toBe(200);
  });

  it('el owner nombra a otro owner, y entre owners se pueden bajar', async () => {
    expect((await patch(t.owner, ids.admin, { role: 'owner' })).status).toBe(200);
    expect((await patch(t.admin, ids.owner, { role: 'member' })).status).toBe(200);
    // Ahora el ex admin es el único owner y el ex owner es member: ya no puede tocar a nadie
    expect((await patch(t.owner, ids.admin, { role: 'member' })).status).toBe(403);
  });

  it('un usuario que no es del comercio: 404', async () => {
    expect((await patch(t.owner, 'usr_inexistente', { status: 'disabled' })).status).toBe(404);
  });

  it('el owner ve la auditoría; el admin no', async () => {
    await patch(t.owner, ids.member, { status: 'disabled' });
    const res = await request(app).get(`/api/tenants/${tenantId}/audit`).set('Authorization', `Bearer ${t.owner}`);
    expect(res.status).toBe(200);
    const entries = res.body as { action: string; actorName: string; targetName: string | null }[];
    expect(entries[0]).toMatchObject({ action: 'member.disabled', actorName: 'Ana', targetName: 'member' });
    expect((await request(app).get(`/api/tenants/${tenantId}/audit`).set('Authorization', `Bearer ${t.admin}`)).status).toBe(403);
  });
});
