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

  beforeEach(() => {
    systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);
    tenantManager = new TenantManager(systemDb, { inMemory: true });

    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
  });

  it('asigna rol "root" al primer usuario registrado y "user" a los subsiguientes', async () => {
    // 1. Primer usuario
    const res1 = await request(app)
      .post('/api/auth/register')
      .send({ email: 'admin@sistema.com', password: 'password123', name: 'Super Admin' });

    expect(res1.status).toBe(201);
    expect(res1.body.user.globalRole).toBe('root');
    expect(typeof res1.body.token).toBe('string');

    // 2. Segundo usuario
    const res2 = await request(app)
      .post('/api/auth/register')
      .send({ email: 'empleado@tienda.com', password: 'password123', name: 'Empleado 1' });

    expect(res2.status).toBe(201);
    expect(res2.body.user.globalRole).toBe('user');
  });

  it('permite login y consulta de perfil con /api/auth/me', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'juan@tienda.com', password: 'mypassword', name: 'Juan' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'juan@tienda.com', password: 'mypassword' });

    expect(loginRes.status).toBe(200);
    const token = loginRes.body.token;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe('juan@tienda.com');
  });

  it('permite crear un tenant y generar API Keys para el POS', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'owner@kiosco.com', password: 'password123', name: 'Dueño Kiosco' });
    const token = regRes.body.token;

    // Crear tenant
    const createTenantRes = await request(app)
      .post('/api/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ id: 'kiosco-san-martin', slug: 'kiosco-san-martin', name: 'Kiosco San Martín', seedDemoData: true });

    expect(createTenantRes.status).toBe(201);
    expect(createTenantRes.body.id).toBe('kiosco-san-martin');

    // Generar API Key para terminal POS
    const keyRes = await request(app)
      .post('/api/tenants/kiosco-san-martin/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1 Central', branch: 'CENTRAL', pointOfSale: 'Caja 1' });

    expect(keyRes.status).toBe(201);
    expect(keyRes.body.rawKey).toMatch(/^mpos_/);
    expect(keyRes.body.keyPrefix).toBeDefined();

    // Listar keys
    const listRes = await request(app)
      .get('/api/tenants/kiosco-san-martin/api-keys')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].active).toBe(true);

    // Revocar key
    const revokeRes = await request(app)
      .delete(`/api/tenants/kiosco-san-martin/api-keys/${keyRes.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(revokeRes.status).toBe(200);

    const listAfterRes = await request(app)
      .get('/api/tenants/kiosco-san-martin/api-keys')
      .set('Authorization', `Bearer ${token}`);

    expect(listAfterRes.body[0].active).toBe(false);
  });

  it('el usuario root puede ver y acceder a todos los tenants (impersonación)', async () => {
    // 1. Registrar Root
    const rootRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'root@sistema.com', password: 'password123', name: 'Root' });
    const rootToken = rootRes.body.token;

    // 2. Registrar usuario común y que cree un tenant
    const userRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'comerciante@local.com', password: 'password123', name: 'Comerciante' });
    const userToken = userRes.body.token;

    await request(app)
      .post('/api/tenants')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ id: 'zapateria-real', slug: 'zapateria-real', name: 'Zapatería Real' });

    // 3. Root consulta tenants disponibles
    const rootTenantsRes = await request(app)
      .get('/api/tenants')
      .set('Authorization', `Bearer ${rootToken}`);

    expect(rootTenantsRes.status).toBe(200);
    expect(rootTenantsRes.body.length).toBe(1);
    expect(rootTenantsRes.body[0].tenantId).toBe('zapateria-real');
    expect(rootTenantsRes.body[0].role).toBe('root_impersonator');
  });
});
