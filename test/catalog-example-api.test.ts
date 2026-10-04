import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('catálogo de ejemplo del rubro (#22)', () => {
  let app: Express;
  let token: string;

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    const tenants = new TenantManager(systemDb, { inMemory: true });
    app = createApp({ systemDb, tenantManager: tenants }).app;
    const res = await request(app).post('/api/alta').send({
      name: 'Marta',
      email: 'm@x.com',
      password: 'clave-segura',
      whatsapp: '1155551234',
      businessName: 'Almacén Marta',
      businessType: 'almacen',
    });
    token = (res.body as { token: string }).token;
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const example = (id: string) => `/api/tenants/${id}/catalog/example`;

  it('disponible con rubro y sin productos; se aplica una vez y deja de estar disponible', async () => {
    expect((await request(app).get(example('almacen-marta')).set(auth())).body).toEqual({ businessType: 'almacen', available: true });
    const first = await request(app).post(example('almacen-marta')).set(auth());
    expect(first.status).toBe(200);
    expect((first.body as { productsCreated: number }).productsCreated).toBeGreaterThan(0);
    expect((await request(app).post(example('almacen-marta')).set(auth())).body).toEqual({ productsCreated: 0 });
    expect((await request(app).get(example('almacen-marta')).set(auth())).body).toEqual({ businessType: 'almacen', available: false });
  });

  it('con rubro "otro": no disponible y 409', async () => {
    const res = await request(app).post('/api/alta').set(auth()).send({ businessName: 'Otro Marta', businessType: 'otro' });
    const id = (res.body as { tenant: { id: string } }).tenant.id;
    expect((await request(app).get(example(id)).set(auth())).body).toEqual({ businessType: 'otro', available: false });
    const post = await request(app).post(example(id)).set(auth());
    expect(post.status).toBe(409);
    expect((post.body as { error: string }).error).toBe('Tu rubro no tiene catálogo de ejemplo');
  });
});
