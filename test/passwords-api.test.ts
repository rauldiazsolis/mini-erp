import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { setupTestDb } from './helpers/test-db.ts';
import { createOwnerAccount, type OwnerAccount } from './helpers/owner-account.ts';

const db = setupTestDb();

describe('contraseñas (#19)', () => {
  let app: Express;
  let bundle: ReturnType<typeof createApp>;
  let clock: Date;
  let owner: { token: string; id: string };
  let emp: { token: string; id: string };
  let tenantId: string;

  async function altaDe(email: string, business: string): Promise<OwnerAccount> {
    return await createOwnerAccount(bundle, { name: email, email, password: 'clave-inicial', businessName: business });
  }

  async function sumar(tenant: string, ownerToken: string, email: string): Promise<{ token: string; user: { id: string } }> {
    const inv = (await request(app)
      .post(`/api/tenants/${tenant}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email, role: 'member' })).body as { token: string };
    const lookup = (await request(app).post('/api/invitations/lookup').send({ token: inv.token })).body as { accountExists: boolean };
    return (await request(app)
      .post('/api/invitations/accept')
      .send({ token: inv.token, password: 'clave-inicial', ...(lookup.accountExists ? {} : { name: 'Emp' }) })).body as {
      token: string;
      user: { id: string };
    };
  }

  const resetLink = (token: string, userId: string) =>
    request(app).post(`/api/tenants/${tenantId}/users/${userId}/password-reset`).set('Authorization', `Bearer ${token}`);

  beforeEach(async () => {
    clock = new Date('2026-10-01T10:00:00Z');
    bundle = createApp({ database: db(), tenantManager: new TenantManager(db(), { inMemory: true }), now: () => clock });
    app = bundle.app;
    const a = await altaDe('ana@k.com', 'Kiosco Ana');
    owner = { token: a.token, id: a.user.id };
    tenantId = a.tenant.id;
    const e = await sumar(tenantId, owner.token, 'emp@k.com');
    emp = { token: e.token, id: e.user.id };
  });

  it('cambiar la propia contraseña cierra las otras sesiones y queda en la auditoría', async () => {
    const otra = ((await request(app).post('/api/auth/login').send({ email: 'emp@k.com', password: 'clave-inicial' })).body as { token: string }).token;
    const res = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${emp.token}`)
      .send({ currentPassword: 'clave-inicial', newPassword: 'clave-nueva-1' });
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${emp.token}`)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${otra}`)).status).toBe(401);
    const audit = await db().system.selectFrom('audit_log').select('id').where('action', '=', 'password.changed').execute();
    expect(audit).toHaveLength(1);
  });

  it('cambiar la contraseña exige la actual y el mínimo', async () => {
    const mal = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${emp.token}`)
      .send({ currentPassword: 'mal', newPassword: 'clave-nueva-2' });
    expect(mal.status).toBe(400);
    expect((mal.body as { error: string }).error).toBe('La contraseña actual no es correcta');
    const corta = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${emp.token}`)
      .send({ currentPassword: 'clave-inicial', newPassword: 'corta' });
    expect(corta.status).toBe(400);
    expect((await request(app).post('/api/auth/password').send({ currentPassword: 'x', newPassword: 'clave-nueva-3' })).status).toBe(401);
  });

  it('el owner genera un link; sirve una vez, cierra las sesiones y deja entrar con la nueva', async () => {
    const created = await resetLink(owner.token, emp.id);
    expect(created.status).toBe(201);
    const link = created.body as { token: string; expiresAt: string };
    expect(link.expiresAt).toBe('2026-10-03T10:00:00.000Z');
    expect(((await request(app).post('/api/password-resets/lookup').send({ token: link.token })).body as { email: string }).email).toBe('emp@k.com');

    const done = await request(app).post('/api/password-resets/complete').send({ token: link.token, password: 'restablecida-1' });
    expect(done.status).toBe(200);
    const nueva = (done.body as { token: string }).token;
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${nueva}`)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${emp.token}`)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'emp@k.com', password: 'restablecida-1' })).status).toBe(200);
    expect((await request(app).post('/api/password-resets/complete').send({ token: link.token, password: 'otra-clave-1' })).status).toBe(410);

    const actions = (await db().system.selectFrom('audit_log').select('action').where('action', 'like', 'password.%').orderBy('seq').execute()).map(
      (r) => r.action,
    );
    expect(actions).toEqual(['password.reset_link_created', 'password.reset']);
  });

  it('un link nuevo invalida el anterior, y vence a las 48 h', async () => {
    const a = (await resetLink(owner.token, emp.id)).body as { token: string };
    const b = (await resetLink(owner.token, emp.id)).body as { token: string };
    expect((await request(app).post('/api/password-resets/lookup').send({ token: a.token })).status).toBe(410);
    clock = new Date('2026-10-03T10:00:01Z');
    expect((await request(app).post('/api/password-resets/lookup').send({ token: b.token })).status).toBe(410);
  });

  it('completar pide el mínimo de contraseña', async () => {
    const link = (await resetLink(owner.token, emp.id)).body as { token: string };
    expect((await request(app).post('/api/password-resets/complete').send({ token: link.token, password: 'corta' })).status).toBe(400);
  });

  it('no se puede para uno mismo, ni para alguien que también está en un comercio ajeno', async () => {
    expect((await resetLink(owner.token, owner.id)).status).toBe(403);
    const b = await altaDe('bea@k.com', 'Kiosco Bea');
    await sumar(b.tenant.id, b.token, 'emp@k.com');
    const res = await resetLink(owner.token, emp.id);
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toMatch(/soporte/);
  });

  it('solo el owner genera links', async () => {
    expect((await resetLink(emp.token, owner.id)).status).toBe(403);
  });
});
