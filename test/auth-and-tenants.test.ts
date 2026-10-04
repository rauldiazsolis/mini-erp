import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

describe('Auth & Multitenancy (Etapa 1.3)', () => {
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let authService: ReturnType<typeof createApp>['authService'];

  beforeEach(() => {
    systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);
    tenantManager = new TenantManager(systemDb, { inMemory: true });

    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    authService = bundle.authService;
  });

  it('el alta crea siempre con rol "user", aunque sea el primer usuario (#3)', async () => {
    const res1 = await request(app)
      .post('/api/alta')
      .send({ email: 'primero@sistema.com', password: 'password123', name: 'Primero', businessName: 'Primero', businessType: 'otro', whatsapp: '1155550000' });

    expect(res1.status).toBe(201);
    const body1 = res1.body as unknown as { user: { globalRole: string }; token: string };
    expect(body1.user.globalRole).toBe('user');
    expect(typeof body1.token).toBe('string');
  });

  it('permite login y consulta de perfil con /api/auth/me', async () => {
    authService.createUser({ email: 'juan@tienda.com', password: 'mypassword', name: 'Juan' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'juan@tienda.com', password: 'mypassword' });

    expect(loginRes.status).toBe(200);
    const loginBody = loginRes.body as unknown as { token: string };
    const token = loginBody.token;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    const meBody = meRes.body as unknown as { user: { email: string } };
    expect(meBody.user.email).toBe('juan@tienda.com');
  });

  it('permite crear un tenant y generar API Keys para el POS', async () => {
    // El alta crea el comercio con la key de Caja 1 (#19)
    const altaRes = await request(app)
      .post('/api/alta')
      .send({ email: 'owner@kiosco.com', password: 'password123', name: 'Dueño Kiosco', businessName: 'Kiosco San Martín', businessType: 'kiosco', whatsapp: '1155550000' });

    expect(altaRes.status).toBe(201);
    const altaBody = altaRes.body as unknown as { token: string; tenant: { id: string } };
    const token = altaBody.token;
    expect(altaBody.tenant.id).toBe('kiosco-san-martin');

    // Crear una caja con su key (#21)
    const keyRes = await request(app)
      .post('/api/tenants/kiosco-san-martin/pos-registers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1 Central', branch: 'CENTRAL', pointOfSale: 'Caja 1' });

    expect(keyRes.status).toBe(201);
    const keyBody = keyRes.body as unknown as { id: string; rawKey: string; keyPrefix: string };
    expect(keyBody.rawKey).toMatch(/^mpos_/);
    expect(keyBody.keyPrefix).toBeDefined();

    // Listar las cajas
    const listRes = await request(app)
      .get('/api/tenants/kiosco-san-martin/pos-registers')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const listBody = listRes.body as unknown as Array<{ id: string; active: boolean }>;
    expect(listBody.length).toBe(2);
    expect(listBody.find((k) => k.id === keyBody.id)?.active).toBe(true);

    // Desactivar la caja
    const revokeRes = await request(app)
      .delete(`/api/tenants/kiosco-san-martin/pos-registers/${keyBody.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(revokeRes.status).toBe(200);

    const listAfterRes = await request(app)
      .get('/api/tenants/kiosco-san-martin/pos-registers')
      .set('Authorization', `Bearer ${token}`);

    const listAfterBody = listAfterRes.body as unknown as Array<{ id: string; active: boolean }>;
    expect(listAfterBody.find((k) => k.id === keyBody.id)?.active).toBe(false);
  });

  it('el usuario root puede ver y acceder a todos los tenants (impersonación)', async () => {
    // 1. Root por ensureRoot (#3: el registro ya no da root) y login
    authService.ensureRoot({ email: 'root@sistema.com', password: 'password-root-123', name: 'Root' });
    const rootRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'root@sistema.com', password: 'password-root-123' });
    const rootBody = rootRes.body as unknown as { token: string };
    const rootToken = rootBody.token;

    // 2. Un comerciante se da de alta con su comercio
    await request(app)
      .post('/api/alta')
      .send({ email: 'comerciante@local.com', password: 'password123', name: 'Comerciante', businessName: 'Zapatería Real', businessType: 'otro', whatsapp: '1155550000' });

    // 3. Root consulta tenants disponibles
    const rootTenantsRes = await request(app)
      .get('/api/tenants')
      .set('Authorization', `Bearer ${rootToken}`);

    expect(rootTenantsRes.status).toBe(200);
    const rootTenantsBody = rootTenantsRes.body as unknown as Array<{ tenantId: string; role: string }>;
    expect(rootTenantsBody.length).toBe(1);
    expect(rootTenantsBody[0]?.tenantId).toBe('zapateria-real');
    expect(rootTenantsBody[0]?.role).toBe('root_impersonator');
  });
  it('changePassword cierra las otras sesiones y deja la actual (#19)', () => {
    const a = authService.createUser({ email: 'pepa@kiosco.com', password: 'clave-vieja', name: 'Pepa' });
    const otra = authService.createSession(a.user.id);
    authService.changePassword({ userId: a.user.id, currentPassword: 'clave-vieja', newPassword: 'clave-nueva', currentToken: a.token });
    expect(authService.validateSession(a.token)).toBeDefined();
    expect(authService.validateSession(otra)).toBeUndefined();
    expect(() => {
      authService.changePassword({ userId: a.user.id, currentPassword: 'mal', newPassword: 'otra-clave', currentToken: a.token });
    }).toThrow('La contraseña actual no es correcta');
  });

  it('una membresía desactivada no da acceso al comercio (#19)', () => {
    const a = authService.createUser({ email: 'ex@kiosco.com', password: 'password123', name: 'Ex' });
    tenantManager.createTenant({ id: 'kiosco-x', slug: 'kiosco-x', name: 'Kiosco X', ownerUserId: a.user.id });
    systemDb.prepare("UPDATE memberships SET status = 'disabled' WHERE user_id = ?").run(a.user.id);
    expect(authService.listUserTenants(a.user.id, 'user')).toEqual([]);
  });
});
