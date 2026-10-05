import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

type Need = 'root' | 'staff';

/** Todas las rutas de /api/platform (#21, #23) con quién puede usarlas. Una ruta nueva va acá. */
const RUTAS: Record<string, Need> = {
  'POST /tenants/:tenantId/payments': 'staff',
  'POST /tenants/:tenantId/gift-credits': 'staff',
  'DELETE /tenants/:tenantId/gift-credits/:creditId': 'staff',
  'POST /tenants/:tenantId/grace': 'staff',
  'POST /tenants/:tenantId/refunds': 'root',
  'PUT /tenants/:tenantId/holder': 'staff',
  'POST /payments/import': 'staff',
  'GET /payments': 'staff',
  'GET /settings': 'staff',
  'PUT /settings': 'root',
  'GET /tenants': 'staff',
  'GET /tenants/by-slug/:slug': 'staff',
  'GET /tenants/:tenantId': 'staff',
  'POST /tenants/:tenantId/suspend': 'staff',
  'POST /tenants/:tenantId/reactivate': 'staff',
  'GET /users': 'staff',
  'POST /users/:userId/disable': 'staff',
  'POST /users/:userId/enable': 'staff',
  'POST /users/:userId/password-reset': 'staff',
  'GET /staff': 'root',
  'POST /staff/invitations': 'root',
  'DELETE /staff/invitations/:invitationId': 'root',
  'GET /audit': 'staff',
  'GET /help-requests': 'staff',
};

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: { platformRoles?: readonly string[] } }[] };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
};

/** Rutas de los routers montados en /api/platform, con los roles que exigen. */
function rutasDePlataforma(app: Express): Record<string, Need | 'ninguno'> {
  const raiz = (app as unknown as { _router: { stack: Layer[] } })._router.stack;
  const found: Record<string, Need | 'ninguno'> = {};
  for (const layer of raiz) {
    if (layer.name !== 'router' || !layer.regexp.test('/api/platform/x')) continue;
    for (const inner of layer.handle.stack ?? []) {
      if (inner.route === undefined) continue;
      const roles = inner.route.stack.find((s) => s.handle.platformRoles !== undefined)?.handle.platformRoles;
      const need = roles === undefined ? 'ninguno' : roles.includes('support') ? 'staff' : 'root';
      for (const method of Object.keys(inner.route.methods)) found[`${method.toUpperCase()} ${inner.route.path}`] = need;
    }
  }
  return found;
}

const sample = (path: string): string =>
  path.replace(':tenantId', 'kiosco').replace(':slug', 'kiosco').replace(':creditId', 'c1').replace(':userId', 'u1').replace(':invitationId', 'i1');

describe('permisos de la plataforma (#23)', () => {
  let app: Express;
  let tokens: { support: string; owner: string };

  beforeEach(() => {
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const support = bundle.authService.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Soporte' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco', ownerUserId: owner.user.id });
    tokens = { support: support.token, owner: owner.token };
  });

  it('cada ruta de la plataforma exige exactamente el rol de la tabla', () => {
    expect(rutasDePlataforma(app)).toEqual(RUTAS);
  });

  it('un owner recibe 403 en todas; soporte, en las de root', async () => {
    for (const [route, need] of Object.entries(RUTAS)) {
      const [method = 'GET', path = ''] = route.split(' ');
      const url = `/api/platform${sample(path)}`;
      const call = (token: string) =>
        request(app)[method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](url).set('Authorization', `Bearer ${token}`).send({});
      expect((await call(tokens.owner)).status, `${route} como owner`).toBe(403);
      if (need === 'root') expect((await call(tokens.support)).status, `${route} como soporte`).toBe(403);
    }
  });
});
