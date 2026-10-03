import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

type AltaBody = {
  token?: string;
  user: { id: string; globalRole: string };
  tenant: { id: string; name: string };
  posKey: { key: string; branch: string; pointOfSale: string };
};

describe('alta atómica (#19)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    app = createApp({ systemDb, tenantManager }).app;
  });

  const alta = { name: 'Marta', email: 'marta@kiosco.com', password: 'clave-segura', businessName: 'Kiosco Marta', template: 'kiosco' };

  it('crea cuenta, comercio con catálogo, owner y key de Caja 1, y registra la auditoría', async () => {
    const res = await request(app).post('/api/alta').send(alta);
    expect(res.status).toBe(201);
    const body = res.body as AltaBody;
    expect(body.user.globalRole).toBe('user');
    expect(body.tenant).toEqual({ id: 'kiosco-marta', name: 'Kiosco Marta' });
    expect(body.posKey).toMatchObject({ branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    expect(body.posKey.key.startsWith('mpos_')).toBe(true);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.token ?? ''}`);
    expect((me.body as { tenants: { tenantId: string; role: string }[] }).tenants).toEqual([
      expect.objectContaining({ tenantId: 'kiosco-marta', role: 'owner' }),
    ]);
    const products = tenantManager.getTenantDb('kiosco-marta').prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
    expect(products.n).toBeGreaterThan(0);
    const audit = systemDb.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'tenant.created'").get() as { n: number };
    expect(audit.n).toBe(1);
  });

  it('el comercio nace con titular y el bono de alta de $50.000 (#21)', async () => {
    const body = (await request(app).post('/api/alta').send(alta)).body as AltaBody;
    expect(systemDb.prepare('SELECT holder_user_id FROM tenants WHERE id = ?').get(body.tenant.id)).toEqual({ holder_user_id: body.user.id });
    expect(systemDb.prepare('SELECT origin, amount, granted_by FROM gift_credits WHERE tenant_id = ?').all(body.tenant.id)).toEqual([
      { origin: 'signup', amount: 50000, granted_by: body.user.id },
    ]);
  });

  it('con el rubro "empty" el comercio arranca sin productos', async () => {
    const body = (await request(app).post('/api/alta').send({ ...alta, template: 'empty' })).body as AltaBody;
    const products = tenantManager.getTenantDb(body.tenant.id).prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
    expect(products.n).toBe(0);
  });

  it('con sesión crea otro comercio para la misma cuenta, sin token nuevo', async () => {
    const first = (await request(app).post('/api/alta').send(alta)).body as AltaBody;
    const res = await request(app)
      .post('/api/alta')
      .set('Authorization', `Bearer ${first.token ?? ''}`)
      .send({ businessName: 'Ferretería Marta', template: 'ferreteria' });
    expect(res.status).toBe(201);
    const body = res.body as AltaBody;
    expect(body.token).toBeUndefined();
    expect(body.user.id).toBe(first.user.id);
    expect(body.tenant.id).toBe('ferreteria-marta');
  });

  it('un nombre repetido desambigua el identificador', async () => {
    await request(app).post('/api/alta').send(alta);
    const body = (await request(app).post('/api/alta').send({ ...alta, email: 'otra@kiosco.com' })).body as AltaBody;
    expect(body.tenant.id).toBe('kiosco-marta-2');
  });

  it('un mail existente sin sesión: 409 y no crea nada', async () => {
    await request(app).post('/api/alta').send(alta);
    const res = await request(app).post('/api/alta').send({ ...alta, businessName: 'Otro' });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('Ya tenés una cuenta con ese correo: iniciá sesión');
    const tenants = systemDb.prepare('SELECT COUNT(*) AS n FROM tenants').get() as { n: number };
    expect(tenants.n).toBe(1);
  });

  it('pide 8 caracteres de contraseña', async () => {
    const res = await request(app).post('/api/alta').send({ ...alta, password: '1234567' });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('La contraseña debe tener al menos 8 caracteres');
  });

  it('una sesión inválida no cae en "crear cuenta": 401', async () => {
    const res = await request(app).post('/api/alta').set('Authorization', 'Bearer vencida').send(alta);
    expect(res.status).toBe(401);
  });

  it('ya no hay registro suelto ni creación de comercio por fuera del alta', async () => {
    expect((await request(app).post('/api/auth/register').send({ email: 'x@x.com', password: 'password123', name: 'X' })).status).toBe(404);
    const token = ((await request(app).post('/api/alta').send(alta)).body as AltaBody).token ?? '';
    const auth = { Authorization: `Bearer ${token}` };
    expect((await request(app).post('/api/tenants').set(auth).send({ id: 'abc', slug: 'abc', name: 'Abc' })).status).toBe(404);
    expect((await request(app).post('/api/tenants/kiosco-marta/seed-preset').set(auth).send({ preset: 'kiosco' })).status).toBe(404);
  });
});
