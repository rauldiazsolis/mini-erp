import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import type { PlatformAuditItem, PlatformTenantDetail, PlatformTenantItem, PlatformUserItem } from '../src/shared/platform-types.ts';

describe('listados del panel de plataforma (#23)', () => {
  let app: Express;
  let tokens: { root: string; support: string };
  let otherOwnerId: string;

  beforeEach(() => {
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    let tick = 0;
    // Cada lectura del reloj avanza un segundo: el orden por fecha es el de creación
    const bundle = createApp({ systemDb, tenantManager, now: () => new Date(Date.parse('2026-10-05T15:00:00.000Z') + 1000 * tick++) });
    app = bundle.app;
    bundle.authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const support = bundle.authService.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Soporte' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner', whatsapp: '1155550000' });
    const other = bundle.authService.createUser({ email: 'ferre@x.com', password: 'password123', name: 'Ferretero' });
    otherOwnerId = other.user.id;
    tenantManager.createTenant({ id: 'kiosco-id', slug: 'kiosco', name: 'Kiosco', ownerUserId: owner.user.id });
    tenantManager.createTenant({ id: 'ferre-id', slug: 'ferre', name: 'Ferretería', ownerUserId: other.user.id });
    bundle.billing.grantSignupBonus('kiosco-id', owner.user.id);
    bundle.billing.grantSignupBonus('ferre-id', other.user.id);
    bundle.demoSessions.create('kiosco');
    tokens = {
      root: bundle.authService.login({ email: 'root@x.com', password: 'password123' }).token,
      support: bundle.authService.login({ email: 'soporte@x.com', password: 'password123' }).token,
    };
  });

  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const get = (who: keyof typeof tokens, path: string) => request(app).get(`/api/platform${path}`).set(as(who));

  it('lista los comercios reales con titular, estado, estado de cobro y miembros, y filtra por texto', async () => {
    const res = await get('support', '/tenants');
    expect(res.status).toBe(200);
    const items = res.body as PlatformTenantItem[];
    expect(items.map((t) => t.slug).sort()).toEqual(['ferre', 'kiosco']);
    expect(items.find((t) => t.slug === 'kiosco')).toMatchObject({
      id: 'kiosco-id',
      name: 'Kiosco',
      holder: { name: 'Owner' },
      status: 'active',
      billingState: 'ok',
      members: 1,
    });
    const filtered = await get('support', '/tenants?q=FERR');
    expect((filtered.body as PlatformTenantItem[]).map((t) => t.slug)).toEqual(['ferre']);
  });

  it('el detalle, por id o por slug, trae suspensión, créditos, bonos y miembros', async () => {
    await request(app).post('/api/platform/tenants/kiosco-id/suspend').set(as('root')).send({ reason: 'Prueba' });
    const byId = await get('support', '/tenants/kiosco-id');
    expect(byId.status).toBe(200);
    expect(byId.body).toMatchObject({
      tenant: { slug: 'kiosco', status: 'suspended' },
      suspension: { reason: 'Prueba', byName: 'Root' },
      members: [{ name: 'Owner', email: 'owner@x.com', role: 'owner', status: 'active' }],
    });
    const detail = byId.body as PlatformTenantDetail;
    expect(detail.credits.giftBalance).toBeGreaterThan(0);
    expect(detail.gifts).toHaveLength(1);
    expect((await get('support', '/tenants/by-slug/kiosco')).body).toEqual(byId.body);
    expect((await get('support', '/tenants/nada')).status).toBe(404);
    expect((await get('support', '/tenants/by-slug/nada')).status).toBe(404);
  });

  it('lista usuarios con sus comercios y busca por nombre o mail', async () => {
    const res = await get('support', '/users?q=owner@x');
    expect(res.body).toEqual([
      expect.objectContaining({
        email: 'owner@x.com',
        name: 'Owner',
        whatsapp: '1155550000',
        globalRole: 'user',
        status: 'active',
        tenants: [{ id: 'kiosco-id', slug: 'kiosco', name: 'Kiosco', role: 'owner', status: 'active' }],
      }),
    ]);
    const all = (await get('support', '/users')).body as PlatformUserItem[];
    expect(all.map((u) => u.email).sort()).toEqual(['ferre@x.com', 'owner@x.com', 'root@x.com', 'soporte@x.com']);
  });

  it('el registro de plataforma muestra todo y filtra por comercio (id o slug)', async () => {
    await request(app).post('/api/platform/tenants/kiosco-id/suspend').set(as('root')).send({ reason: 'x' });
    await request(app).post(`/api/platform/users/${otherOwnerId}/disable`).set(as('root')).send({});
    const all = (await get('support', '/audit')).body as PlatformAuditItem[];
    expect(all.map((a) => a.action)).toEqual(expect.arrayContaining(['tenant.suspended', 'user.disabled']));
    expect(all[0]).toMatchObject({ action: 'user.disabled', actorName: 'Root', targetName: 'Ferretero', tenantId: null, tenantName: null });
    const kiosco = (await get('support', '/audit?tenantId=kiosco-id')).body as PlatformAuditItem[];
    expect(kiosco.length).toBeGreaterThan(0);
    expect(kiosco.every((a) => a.tenantId === 'kiosco-id')).toBe(true);
    expect(kiosco[0]).toMatchObject({ action: 'tenant.suspended', actorName: 'Root', tenantName: 'Kiosco', details: { reason: 'x' } });
    expect((await get('support', '/audit?tenantSlug=kiosco')).body).toEqual(kiosco);
  });
});
