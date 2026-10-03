import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import type { RegisterItem } from '../src/shared/register-types.ts';

describe('rutas de cajas del POS (#21)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let tokens: { owner: string; member: string };
  const tenantId = 'kiosco-cajas';

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    const member = bundle.authService.createUser({ email: 'member@x.com', password: 'password123', name: 'Member' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco Cajas', ownerUserId: owner.user.id });
    new MembershipService(systemDb).addMembership(tenantId, member.user.id, 'member');
    tokens = { owner: owner.token, member: member.token };
  });

  const auth = () => ({ Authorization: `Bearer ${tokens.owner}` });
  const pull = (key: string, deviceId: string) =>
    request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${key}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .send({ deviceId, cursors: {}, pendingLotIds: [] });
  const crear = async () => {
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/pos-registers`)
      .set(auth())
      .send({ name: 'Caja 2', branch: 'CENTRAL', pointOfSale: 'Caja 2' });
    return { status: res.status, body: res.body as { id: string; rawKey: string; key: string; keyPrefix: string } };
  };

  it('el owner crea una caja, ve el equipo y el otro equipo, se la pasa, rota, desliga y desactiva', async () => {
    const created = await crear();
    expect(created.status).toBe(201);
    expect(created.body.key).toBe(created.body.rawKey);
    expect(created.body.id).toMatch(/^reg_/);
    expect((await pull(created.body.rawKey, 'dev-a')).status).toBe(200);
    expect((await pull(created.body.rawKey, 'dev-b')).status).toBe(200);

    const list = await request(app).get(`/api/tenants/${tenantId}/pos-registers`).set(auth());
    const caja = (list.body as RegisterItem[]).find((r) => r.id === created.body.id);
    expect(caja?.deviceId).toBe('dev-a');
    expect(caja?.otherDevices.map((d) => d.deviceId)).toEqual(['dev-b']);

    const base = `/api/tenants/${tenantId}/pos-registers/${created.body.id}`;
    expect((await request(app).post(`${base}/transfer`).set(auth()).send({ deviceId: 'dev-b' })).status).toBe(200);
    const rotated = await request(app).post(`${base}/rotate-key`).set(auth());
    expect(rotated.status).toBe(200);
    expect((rotated.body as { rawKey: string }).rawKey).not.toBe(created.body.rawKey);
    expect((await pull(created.body.rawKey, 'dev-b')).status).toBe(401);
    expect((await pull((rotated.body as { rawKey: string }).rawKey, 'dev-b')).status).toBe(200);
    expect((await request(app).post(`${base}/unbind`).set(auth())).status).toBe(200);
    expect((await request(app).delete(base).set(auth())).status).toBe(200);
  });

  it('cada acción queda en la auditoría', async () => {
    const { body } = await crear();
    await pull(body.rawKey, 'dev-a');
    await pull(body.rawKey, 'dev-b');
    const base = `/api/tenants/${tenantId}/pos-registers/${body.id}`;
    await request(app).post(`${base}/rotate-key`).set(auth());
    await request(app).post(`${base}/transfer`).set(auth()).send({ deviceId: 'dev-b' });
    await request(app).post(`${base}/unbind`).set(auth());
    await request(app).delete(base).set(auth());
    const actions = systemDb
      .prepare("SELECT action FROM audit_log WHERE tenant_id = ? AND action LIKE 'register.%' ORDER BY at, rowid")
      .all(tenantId) as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual([
      'register.created',
      'register.key_rotated',
      'register.transferred',
      'register.unbound',
      'register.deactivated',
    ]);
  });

  it('errores: datos inválidos 400, equipo que no la usó 400, caja ajena 404', async () => {
    const bad = await request(app).post(`/api/tenants/${tenantId}/pos-registers`).set(auth()).send({ name: 'C', branch: '', pointOfSale: '' });
    expect(bad.status).toBe(400);
    const { body } = await crear();
    const transfer = await request(app).post(`/api/tenants/${tenantId}/pos-registers/${body.id}/transfer`).set(auth()).send({ deviceId: 'dev-x' });
    expect(transfer.status).toBe(400);
    expect((transfer.body as { error: string }).error).toBe('Ese equipo no usó esta caja');
    expect((await request(app).post(`/api/tenants/${tenantId}/pos-registers/reg_nada/unbind`).set(auth())).status).toBe(404);
  });

  it('el member recibe 403', async () => {
    const res = await request(app).get(`/api/tenants/${tenantId}/pos-registers`).set({ Authorization: `Bearer ${tokens.member}` });
    expect(res.status).toBe(403);
  });
});
