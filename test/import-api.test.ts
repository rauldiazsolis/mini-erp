import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import type { ImportPreview } from '../src/shared/import-fields.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

// Un CSV "de Excel": punto y coma, coma decimal, encabezados propios y una columna que no se importa
const EXCEL =
  'Apellido y Nombre;Nro Doc;Tel;Saldo CC;Vendedor\r\n' +
  'Pérez Juan;20.123.456;1155551234;12.345,50;Ana\r\n' +
  'Gómez Ana;27.999.888;;-1.000,00;Ana\r\n';

describe('POST /import/:entity (#22)', () => {
  let app: Express;
  let tenants: TenantManager;
  let owner: string;
  let admin: string;
  let member: string;

  beforeEach(async () => {
    tenants = new TenantManager(pgDb(), { inMemory: true });
    const created = createApp({ database: pgDb(), tenantManager: tenants });
    app = created.app;
    const o = await created.authService.createUser({ email: 'o@x.com', password: 'clave-segura', name: 'Owner' });
    const a = await created.authService.createUser({ email: 'a@x.com', password: 'clave-segura', name: 'Admin' });
    const m = await created.authService.createUser({ email: 'm@x.com', password: 'clave-segura', name: 'Member' });
    owner = o.token;
    admin = a.token;
    member = m.token;
    await tenants.createTenant({ id: 't1', slug: 't1', name: 'T1', ownerUserId: o.user.id, seedDemoData: false });
    const members = new MembershipService(pgDb().system);
    await members.addMembership('t1', a.user.id, 'admin');
    await members.addMembership('t1', m.user.id, 'member');
  });

  const post = (token: string, entity: string, body: object) =>
    request(app).post(`/api/tenants/t1/import/${entity}`).set('Authorization', `Bearer ${token}`).send(body);

  it('criterio de aceptación: mapea, importa con saldo inicial en el extracto y reimporta sin duplicar', async () => {
    const preview = (await post(owner, 'customers', { csv: EXCEL, dryRun: true })).body as ImportPreview;
    expect(preview.separator).toBe(';');
    expect(preview.mapping).toEqual({ '0': 'name', '1': 'document', '2': 'phone', '3': 'balance', '4': null });
    expect(preview.totals).toEqual({ create: 2, update: 0, unchanged: 0, error: 0 });

    const done = await post(owner, 'customers', { csv: EXCEL, mapping: preview.mapping, dryRun: false });
    expect(done.status).toBe(200);
    const db = pgDb().forTenant('t1');
    const juan = await db.selectFrom('customers').select(['id', 'balance']).where('document', '=', '20.123.456').executeTakeFirstOrThrow();
    expect(juan.balance).toBe(12345.5);
    const statement = await request(app).get(`/api/tenants/t1/customers/${juan.id}/movements`).set('Authorization', `Bearer ${owner}`);
    expect(statement.status).toBe(200);
    expect(JSON.stringify(statement.body)).toContain('Saldo inicial (importado)');

    const again = (await post(owner, 'customers', { csv: EXCEL, dryRun: false })).body as ImportPreview;
    expect(again.totals).toEqual({ create: 0, update: 0, unchanged: 2, error: 0 });
    expect(await db.selectFrom('customers').select('id').execute()).toHaveLength(2);
    expect(await db.selectFrom('account_movements').select('id').execute()).toHaveLength(2);
  });

  it('el admin importa productos; el member recibe 403', async () => {
    const res = await post(admin, 'products', { csv: 'Descripción;P. Venta\nYerba;3.500\n', dryRun: false });
    expect(res.status).toBe(200);
    expect((res.body as ImportPreview).totals.create).toBe(1);
    expect((await post(member, 'customers', { csv: EXCEL, dryRun: true })).status).toBe(403);
  });

  it('entidad desconocida, mapeo con un campo inválido y mapeo incompleto al confirmar: 400', async () => {
    expect((await post(owner, 'stock', { csv: EXCEL, dryRun: true })).status).toBe(400);
    expect((await post(owner, 'customers', { csv: EXCEL, dryRun: true, mapping: { '0': 'precio' } })).status).toBe(400);
    expect((await post(owner, 'customers', { csv: EXCEL, dryRun: true, mapping: { '0': 'price' } })).status).toBe(400);
    const incomplete = await post(owner, 'customers', { csv: 'Tel\n1\n', dryRun: false });
    expect(incomplete.status).toBe(400);
    expect((incomplete.body as { error: string }).error).toBe('Asigná las columnas que faltan antes de importar');
  });

  it('el cuerpo viejo (items, sin dryRun) ya no se acepta', async () => {
    expect((await post(owner, 'products', { items: [{ sku: 'A', name: 'A', price: 1 }] })).status).toBe(400);
  });
});
