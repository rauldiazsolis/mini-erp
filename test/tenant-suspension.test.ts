import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { suspendedDays } from '../src/server/platform/suspensions.ts';

const origin = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };

function venta(eventId: string, createdAt: string) {
  return {
    id: eventId,
    type: 'sale',
    createdAt,
    origin,
    sale: { id: `s-${eventId}`, status: 'closed', total: 100, createdAt, lines: [], payments: [{ method: 'cash', amount: 100 }] },
  };
}

describe('suspender comercios (#23)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let tokens: { root: string; support: string; owner: string };
  let posKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => new Date('2026-10-05T15:00:00.000Z') });
    app = bundle.app;
    bundle.authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const support = bundle.authService.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Soporte' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    bundle.billing.grantSignupBonus(tenantId, owner.user.id);
    tokens = {
      root: bundle.authService.login({ email: 'root@x.com', password: 'password123' }).token,
      support: bundle.authService.login({ email: 'soporte@x.com', password: 'password123' }).token,
      owner: owner.token,
    };
    const caja = await request(app)
      .post(`/api/tenants/${tenantId}/pos-registers`)
      .set(as('owner'))
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    posKey = (caja.body as { rawKey: string }).rawKey;
  });

  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const audit = (action: string) =>
    systemDb.prepare('SELECT tenant_id, details FROM audit_log WHERE action = ?').all(action) as { tenant_id: string | null; details: string }[];
  const suspend = (who: keyof typeof tokens, body: unknown = { reason: 'Pedido del dueño' }) =>
    request(app).post(`/api/platform/tenants/${tenantId}/suspend`).set(as(who)).send(body as object);
  const reactivate = (who: keyof typeof tokens) => request(app).post(`/api/platform/tenants/${tenantId}/reactivate`).set(as(who)).send({});
  const push = (lotId: string, events: unknown[]) =>
    request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${posKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId: 'dev-1', events });
  const charges = () => systemDb.prepare('SELECT day FROM charges ORDER BY day').all() as { day: string }[];

  it('soporte suspende con motivo: el owner recibe 403 salvo Uso y pagos, billing-status y exportar', async () => {
    expect((await suspend('support')).status).toBe(200);
    const blocked = await request(app).get(`/api/tenants/${tenantId}/products`).set(as('owner'));
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ code: 'tenant-suspended', error: 'Este comercio está suspendido: escribile a soporte' });
    expect((await request(app).get(`/api/tenants/${tenantId}/credits`).set(as('owner'))).status).toBe(200);
    expect((await request(app).get(`/api/tenants/${tenantId}/billing-status`).set(as('owner'))).status).toBe(200);
    expect((await request(app).get(`/api/tenants/${tenantId}/export/products`).set(as('owner'))).status).toBe(200);
    // Sin membresía, soporte no entra (#16); impersonando al owner, sí (impersonation-rules.test.ts)
    expect((await request(app).get(`/api/tenants/${tenantId}/products`).set(as('support'))).status).toBe(403);
    expect(audit('tenant.suspended')).toEqual([{ tenant_id: tenantId, details: JSON.stringify({ reason: 'Pedido del dueño' }) }]);
  });

  it('/auth/me muestra el comercio suspendido y reactivar lo devuelve a la normalidad', async () => {
    await suspend('root');
    const me = await request(app).get('/api/auth/me').set(as('owner'));
    expect((me.body as { tenants: { status: string }[] }).tenants[0]?.status).toBe('suspended');
    expect((await suspend('root')).status).toBe(409);
    expect((await reactivate('root')).status).toBe(200);
    expect((await request(app).get(`/api/tenants/${tenantId}/products`).set(as('owner'))).status).toBe(200);
    expect((await reactivate('root')).status).toBe(409);
    expect(audit('tenant.reactivated')).toHaveLength(1);
  });

  it('el POS sigue sincronizando y los días suspendidos no se cobran', async () => {
    await push('l0', [venta('e0', '2026-10-04T13:00:00.000Z')]);
    expect(charges()).toEqual([{ day: '2026-10-04' }]);
    await suspend('root');
    const res = await push('l1', [venta('e1', '2026-10-05T13:00:00.000Z')]);
    expect(res.status).toBe(200);
    expect(charges()).toEqual([{ day: '2026-10-04' }]);
  });

  it('suspendedDays mira el día argentino', () => {
    systemDb
      .prepare(
        "INSERT INTO tenant_suspensions (id, tenant_id, from_at, to_at, reason, created_by) VALUES ('s', ?, '2026-10-03T02:00:00.000Z', '2026-10-04T04:00:00.000Z', 'x', 'u')",
      )
      .run(tenantId);
    // 02:00Z del 3 es el 2 argentino; 04:00Z del 4 es el 4 argentino
    expect([...suspendedDays(systemDb, tenantId, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'])].sort()).toEqual([
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('motivo obligatorio; un comercio inexistente no se suspende; un owner no entra', async () => {
    expect((await suspend('root', {})).status).toBe(400);
    expect((await request(app).post('/api/platform/tenants/nada/suspend').set(as('root')).send({ reason: 'x' })).status).toBe(404);
    expect((await suspend('owner')).status).toBe(403);
  });
});
