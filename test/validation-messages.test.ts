import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { WHATSAPP_MESSAGE } from '../src/shared/whatsapp.ts';

/**
 * Los textos propios de los esquemas de `/api` (#6): Zod 4 cambia cómo se declaran
 * (`errorMap`, `required_error` e `invalid_type_error` pasan a `error`), no lo que ve el usuario.
 */
describe('textos de validación de /api (#6)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let owner: string;
  let root: string;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const o = bundle.authService.createUser({ email: 'o@x.com', password: 'clave-segura', name: 'Owner' });
    owner = o.token;
    tenantManager.createTenant({ id: 't1', slug: 't1', name: 'T1', ownerUserId: o.user.id });
    bundle.authService.ensureRoot({ email: 'root@x.com', password: 'clave-segura', name: 'Root' });
    root = bundle.authService.login({ email: 'root@x.com', password: 'clave-segura' }).token;
  });

  const errorOf = (res: { body: unknown }): string => (res.body as { error: string }).error;
  const tenantPost = (path: string, body: object) =>
    request(app).post(`/api/tenants/t1${path}`).set('Authorization', `Bearer ${owner}`).send(body);

  describe('alta', () => {
    const alta = {
      name: 'Marta',
      email: 'marta@kiosco.com',
      password: 'clave-segura',
      whatsapp: '+54 9 11 5555-1234',
      businessName: 'Kiosco Marta',
      businessType: 'kiosco',
    };

    it('sin rubro pide el rubro', async () => {
      const res = await request(app).post('/api/alta').send({ ...alta, businessType: undefined });
      expect(res.status).toBe(400);
      expect(errorOf(res)).toBe('Elegí el rubro de tu comercio');
    });

    it('un nombre de comercio corto pide el nombre', async () => {
      const res = await request(app).post('/api/alta').send({ ...alta, businessName: 'A' });
      expect(errorOf(res)).toBe('Escribí el nombre de tu comercio');
    });

    it('un WhatsApp que no es texto da el mensaje del WhatsApp', async () => {
      const res = await request(app).post('/api/alta').send({ ...alta, whatsapp: 5491155551234 });
      expect(res.status).toBe(400);
      expect(errorOf(res)).toBe(WHATSAPP_MESSAGE);
    });

    it('un email inválido da "Email inválido"', async () => {
      const res = await request(app).post('/api/alta').send({ ...alta, email: 'no-es-email' });
      expect(errorOf(res)).toBe('Email inválido');
    });

    it('un email con espacios alrededor se recorta y se acepta', async () => {
      const res = await request(app).post('/api/alta').send({ ...alta, email: '  marta@kiosco.com  ' });
      expect(res.status).toBe(201);
      expect(systemDb.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('marta@kiosco.com')).toEqual({ n: 1 });
    });
  });

  it('login con un email inválido da "Email inválido"', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'no-es-email', password: 'clave-segura' });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe('Email inválido');
  });

  it('una invitación con un email inválido da "Email inválido" y una con espacios se acepta', async () => {
    const bad = await tenantPost('/invitations', { email: 'no-es-email', role: 'member' });
    expect(bad.status).toBe(400);
    expect(errorOf(bad)).toBe('Email inválido');
    const ok = await tenantPost('/invitations', { email: '  nueva@x.com  ', role: 'member' });
    expect(ok.status).toBe(201);
  });

  it('importación sin csv o sin dryRun dice qué falta', async () => {
    expect(errorOf(await tenantPost('/import/customers', { dryRun: true }))).toBe('Falta el contenido del archivo');
    expect(errorOf(await tenantPost('/import/customers', { csv: 'Nombre\nAna\n' }))).toBe('Falta indicar si es una vista previa');
  });

  it('bulk de precios con una acción desconocida', async () => {
    const res = await tenantPost('/bulk/prices', { action: 'duplicar' });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe("La acción debe ser 'percentage', 'fixed' o 'items'");
  });

  it('ajuste de cuenta corriente con un tipo desconocido', async () => {
    const res = await tenantPost('/customers/c1/adjustments', { type: 'regalo', amount: 10, reason: 'x' });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe("El tipo de ajuste debe ser 'credit', 'debit' o 'set'");
  });

  it('ajuste de stock con un tipo desconocido o una cantidad que no es número', async () => {
    const base = { productId: 'p1', branchId: 'b1', type: 'set', quantity: 3, reason: 'conteo' };
    expect(errorOf(await tenantPost('/stock/adjust', { ...base, type: 'sumar' }))).toBe("El tipo de ajuste debe ser 'set' o 'delta'");
    expect(errorOf(await tenantPost('/stock/adjust', { ...base, quantity: 'tres' }))).toBe('La cantidad debe ser numérica');
  });

  it('un dato sin texto propio da el mensaje de Zod en castellano', async () => {
    const res = await tenantPost('/customers/c1/payments', {});
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe('Entrada inválida: se esperaba número, recibido indefinido');
  });

  it('un pago de plataforma con un importe que no es número', async () => {
    const res = await request(app)
      .post('/api/platform/tenants/t1/payments')
      .set('Authorization', `Bearer ${root}`)
      .send({ day: '2026-10-05', amount: 'mil' });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toBe('Importe inválido');
  });
});
