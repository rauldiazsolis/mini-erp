import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { impersonate } from './helpers/impersonate.ts';
import type { HelpRequestItem, SupportAccess } from '../src/shared/help-types.ts';

const HOUR = 60 * 60 * 1000;

describe('pedidos de ayuda (#23, M7b)', () => {
  let app: Express;
  let now: Date;
  let tokens: { owner: string; support: string; root: string };
  let ownerId: string;

  beforeEach(async () => {
    now = new Date('2026-10-05T15:00:00.000Z');
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => now });
    app = bundle.app;
    const auth = bundle.authService;
    auth.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const support = auth.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Ana' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    const owner = auth.createUser({ email: 'juan@x.com', password: 'password123', name: 'Juan' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco X', ownerUserId: owner.user.id });
    ownerId = owner.user.id;
    tokens = { owner: owner.token, support: support.token, root: auth.login({ email: 'root@x.com', password: 'password123' }).token };
    await request(app).put('/api/platform/settings').set(bearer(tokens.root)).send({ supportWhatsapp: '5491155551234' });
  });

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ask = (body: object, token = tokens.owner) => request(app).post('/api/tenants/kiosco/help-requests').set(bearer(token)).send(body);
  const access = async () => (await request(app).get('/api/me/support-access').set(bearer(tokens.owner))).body as SupportAccess;
  const take = (id: string, token = tokens.support) => request(app).post('/api/impersonations').set(bearer(token)).send({ helpRequestId: id });
  const panel = async () => (await request(app).get('/api/platform/help-requests').set(bearer(tokens.support))).body as HelpRequestItem[];

  it('el usuario pide ayuda desde una pantalla: link al pedido y el WhatsApp de soporte', async () => {
    const res = await ask({ path: '/admin/kiosco/clientes?deudores=1', message: 'No veo un cliente' });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; url: string; expiresAt: string };
    expect(body.url).toMatch(new RegExp(`/ayuda/${body.id}$`));
    expect(body.expiresAt).toBe('2026-10-06T15:00:00.000Z');
    const a = await access();
    expect(a.supportWhatsapp).toBe('5491155551234');
    expect(a.openRequest).toMatchObject({ id: body.id, message: 'No veo un cliente' });
  });

  it('la pantalla tiene que ser del admin de ese comercio y el texto, de hasta 500', async () => {
    expect((await ask({ path: '/admin/otro/clientes' })).status).toBe(400);
    expect((await ask({ path: 'https://malo.com/admin/kiosco' })).status).toBe(400);
    expect((await ask({ path: '/admin/kiosco/dashboard', message: 'x'.repeat(501) })).status).toBe(400);
    const imp = await impersonate(app, tokens.support, ownerId);
    expect((await ask({ path: '/admin/kiosco/dashboard' }, imp)).status).toBe(403);
  });

  it('soporte toma el pedido: entra en esa pantalla, queda la toma y el usuario ve el acceso', async () => {
    const id = ((await ask({ path: '/admin/kiosco/clientes', message: '' })).body as { id: string }).id;
    const res = await take(id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tenantSlug: 'kiosco', path: '/admin/kiosco/clientes', user: { id: ownerId } });
    now = new Date(now.getTime() + 60 * 1000);
    expect((await take(id, tokens.root)).status).toBe(201); // dos tomas
    const a = await access();
    expect(a.activeNow).toBe(true);
    expect(a.accesses.map((x) => [x.staffName, x.byRequest])).toEqual([
      ['Root', true],
      ['Ana', true],
    ]);
    const list = await panel();
    expect(list[0]).toMatchObject({ id, status: 'open', userName: 'Juan', tenantName: 'Kiosco X' });
    expect(list[0]?.takes.map((t) => t.staffName)).toEqual(['Ana', 'Root']);
  });

  it('un acceso libre también se ve, sin "por tu pedido"; los de más de 7 días no', async () => {
    const imp = await impersonate(app, tokens.support, ownerId);
    expect((await access()).accesses).toEqual([{ at: '2026-10-05T15:00:00.000Z', staffName: 'Ana', byRequest: false }]);
    await request(app).delete('/api/impersonations/current').set(bearer(imp));
    expect((await access()).activeNow).toBe(false);
    now = new Date(now.getTime() + 8 * 24 * HOUR);
    expect((await access()).accesses).toEqual([]);
  });

  it('vencido a las 24 h o cerrado por uno nuevo: 410 "Este pedido venció"', async () => {
    const first = ((await ask({ path: '/admin/kiosco/dashboard' })).body as { id: string }).id;
    now = new Date(now.getTime() + 1000);
    const second = ((await ask({ path: '/admin/kiosco/dashboard' })).body as { id: string }).id;
    const closed = await take(first);
    expect(closed.status).toBe(410);
    expect((closed.body as { error: string }).error).toBe('Este pedido venció');
    now = new Date(now.getTime() + 25 * HOUR);
    expect((await take(second)).status).toBe(410);
    expect((await panel()).map((r) => [r.id, r.status])).toEqual([
      [second, 'expired'],
      [first, 'closed'],
    ]);
  });

  it('el panel muestra las últimas 48 h', async () => {
    await ask({ path: '/admin/kiosco/dashboard' });
    now = new Date(now.getTime() + 49 * HOUR);
    expect(await panel()).toEqual([]);
  });
});
