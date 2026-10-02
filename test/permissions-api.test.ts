import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import type { Capability } from '../src/shared/permissions.ts';

/** Todas las rutas de la cadena del comercio, con su capacidad (#19). Una ruta nueva va acá. */
const RUTAS: Record<string, Capability> = {
  'GET /branches': 'tenant.use',
  'POST /branches': 'settings.manage',
  'GET /branches/:branchId': 'tenant.use',
  'PUT /branches/:branchId': 'settings.manage',
  'GET /products': 'tenant.use',
  'POST /products': 'tenant.use',
  'GET /products/:productId': 'tenant.use',
  'PUT /products/:productId': 'tenant.use',
  'DELETE /products/:productId': 'tenant.use',
  'GET /categories': 'tenant.use',
  'GET /stock': 'tenant.use',
  'POST /stock/adjust': 'tenant.use',
  'GET /stock/kardex': 'tenant.use',
  'GET /customers': 'tenant.use',
  'POST /customers': 'tenant.use',
  'GET /customers/:customerId': 'tenant.use',
  'PUT /customers/:customerId': 'tenant.use',
  'DELETE /customers/:customerId': 'tenant.use',
  'POST /customers/:customerId/payments': 'tenant.use',
  'POST /customers/:customerId/adjustments': 'tenant.use',
  'GET /customers/:customerId/movements': 'tenant.use',
  'GET /discrepancies': 'tenant.use',
  'GET /registers': 'tenant.use',
  'GET /sales': 'tenant.use',
  'GET /sales/:saleId': 'tenant.use',
  'GET /customer-payments': 'tenant.use',
  'GET /cash-movements': 'tenant.use',
  'GET /cash-summary': 'tenant.use',
  'GET /cash-summary/day': 'tenant.use',
  'POST /discrepancies/:discrepancyId/dismiss': 'settings.manage',
  'POST /bulk/prices': 'bulk',
  'POST /bulk/interests': 'bulk',
  'GET /export/:entity': 'bulk',
  'POST /import/:entity': 'bulk',
  'GET /dashboard/summary': 'tenant.use',
  'GET /api-keys': 'settings.manage',
  'POST /api-keys': 'settings.manage',
  'DELETE /api-keys/:keyId': 'settings.manage',
  'GET /users': 'users.manage',
  'POST /invitations': 'users.manage',
  'DELETE /invitations/:invitationId': 'users.manage',
  'PATCH /users/:userId': 'users.manage',
  'GET /audit': 'owners.manage',
  'POST /users/:userId/password-reset': 'owners.manage',
};

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: { capability?: Capability } }[] };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
};

/** Rutas declaradas en los routers montados en /api/tenants/:tenantId, con la capacidad que exigen. */
function rutasDelComercio(app: Express): Record<string, Capability | undefined> {
  const raiz = (app as unknown as { _router: { stack: Layer[] } })._router.stack;
  const found: Record<string, Capability | undefined> = {};
  for (const layer of raiz) {
    if (layer.name !== 'router' || !layer.regexp.test('/api/tenants/t1/products')) continue;
    for (const inner of layer.handle.stack ?? []) {
      if (inner.route === undefined) continue;
      for (const method of Object.keys(inner.route.methods)) {
        const cap = inner.route.stack.find((s) => s.handle.capability !== undefined)?.handle.capability;
        found[`${method.toUpperCase()} ${inner.route.path}`] = cap;
      }
    }
  }
  return found;
}

describe('permisos del comercio en la API (#19)', () => {
  let app: Express;
  let tokens: { owner: string; admin: string; member: string };
  const tenantId = 'kiosco-roles';

  beforeEach(() => {
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const members = new MembershipService(systemDb);
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    const admin = bundle.authService.createUser({ email: 'admin@x.com', password: 'password123', name: 'Admin' });
    const member = bundle.authService.createUser({ email: 'member@x.com', password: 'password123', name: 'Member' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco Roles', ownerUserId: owner.user.id });
    members.addMembership(tenantId, admin.user.id, 'admin');
    members.addMembership(tenantId, member.user.id, 'member');
    tokens = { owner: owner.token, admin: admin.token, member: member.token };
  });

  it('cada ruta del comercio exige exactamente la capacidad de la tabla', () => {
    expect(rutasDelComercio(app)).toEqual(RUTAS);
  });

  it('el member recibe 403 en operaciones masivas, export, sucursales y keys', async () => {
    const auth = { Authorization: `Bearer ${tokens.member}` };
    expect((await request(app).post(`/api/tenants/${tenantId}/bulk/prices`).set(auth).send({ action: 'percentage', value: 10 })).status).toBe(403);
    expect((await request(app).get(`/api/tenants/${tenantId}/export/products`).set(auth)).status).toBe(403);
    expect((await request(app).post(`/api/tenants/${tenantId}/branches`).set(auth).send({ name: 'Otra', code: 'OTRA' })).status).toBe(403);
    expect((await request(app).get(`/api/tenants/${tenantId}/api-keys`).set(auth)).status).toBe(403);
    const res = await request(app).post(`/api/tenants/${tenantId}/api-keys`).set(auth).send({ name: 'Caja 2', branch: 'CENTRAL', pointOfSale: 'Caja 2' });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe('No tenés permiso para esto');
  });

  it('el member opera el día a día: productos, stock, clientes y dashboard', async () => {
    const auth = { Authorization: `Bearer ${tokens.member}` };
    for (const path of ['products', 'stock', 'customers', 'branches', 'dashboard/summary']) {
      expect((await request(app).get(`/api/tenants/${tenantId}/${path}`).set(auth)).status).toBe(200);
    }
  });

  it('el admin maneja keys y masivas', async () => {
    const auth = { Authorization: `Bearer ${tokens.admin}` };
    expect((await request(app).get(`/api/tenants/${tenantId}/api-keys`).set(auth)).status).toBe(200);
    expect((await request(app).get(`/api/tenants/${tenantId}/export/products`).set(auth)).status).toBe(200);
  });

  it('sin membresía activa: 403 en todo el comercio', async () => {
    const res = await request(app).get('/api/tenants/otro-comercio/products').set({ Authorization: `Bearer ${tokens.owner}` });
    expect(res.status).toBe(403);
  });
});
