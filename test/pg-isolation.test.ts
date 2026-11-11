import { sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantSchema } from '../src/server/db/pg/migrations/migrate.ts';
import { InvalidTenantIdError, isValidTenantId, tenantSchemaName } from '../src/server/db/pg/tenant-schema-name.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();
const NOW = '2026-11-11T12:00:00.000Z';

function branch(id: string, name: string) {
  return { id, name, code: id.toUpperCase(), created_at: NOW };
}

describe('tenantSchemaName', () => {
  it('arma tenant_<id> con los ids que usa el mini-erp', () => {
    expect(tenantSchemaName('demo-kiosco')).toBe('tenant_demo-kiosco');
    expect(tenantSchemaName('kiosco-don-pepe-2')).toBe('tenant_kiosco-don-pepe-2');
    expect(tenantSchemaName('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b')).toBe('tenant_3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b');
  });

  it.each(['', 'Kiosco', 'kiosco uno', 'a"b', 'a;drop', '../x', '-a', 'ñandú', 'a'.repeat(57)])('rechaza %j', (id) => {
    expect(isValidTenantId(id)).toBe(false);
    expect(() => tenantSchemaName(id)).toThrow(InvalidTenantIdError);
  });

  it('acepta hasta el largo que entra en un identificador de PostgreSQL (63 bytes)', () => {
    expect(tenantSchemaName('a'.repeat(56))).toHaveLength(63);
  });
});

describe('aislamiento entre comercios', () => {
  beforeEach(async () => {
    await createTenantSchema(db().root, 'kiosco-a');
    await createTenantSchema(db().root, 'kiosco-b');
  });

  it('lo que escribe un comercio no lo ve el otro', async () => {
    const a = db().forTenant('kiosco-a');
    const b = db().forTenant('kiosco-b');
    await a.insertInto('branches').values(branch('central', 'Central de A')).execute();

    expect(await a.selectFrom('branches').select(['id', 'name']).execute()).toEqual([{ id: 'central', name: 'Central de A' }]);
    expect(await b.selectFrom('branches').select(['id', 'name']).execute()).toEqual([]);
  });

  it('el mismo id en dos comercios son dos filas distintas', async () => {
    const a = db().forTenant('kiosco-a');
    const b = db().forTenant('kiosco-b');
    await a.insertInto('branches').values(branch('central', 'Central de A')).execute();
    await b.insertInto('branches').values(branch('central', 'Central de B')).execute();

    await b.updateTable('branches').set({ name: 'Cambiada' }).where('id', '=', 'central').execute();
    await b.deleteFrom('branches').where('id', '=', 'central').execute();

    expect(await a.selectFrom('branches').select('name').execute()).toEqual([{ name: 'Central de A' }]);
  });

  it('una transacción sigue acotada al esquema del comercio', async () => {
    const a = db().forTenant('kiosco-a');
    await a.transaction().execute(async (trx) => {
      await trx.insertInto('branches').values(branch('central', 'Central de A')).execute();
    });

    expect(await a.selectFrom('branches').select('id').execute()).toEqual([{ id: 'central' }]);
    expect(await db().forTenant('kiosco-b').selectFrom('branches').select('id').execute()).toEqual([]);
  });

  it('un join y una subconsulta quedan en el esquema del comercio', async () => {
    const a = db().forTenant('kiosco-a');
    await a.insertInto('branches').values(branch('central', 'Central de A')).execute();
    await a
      .insertInto('products')
      .values({ id: 'p1', sku: 'P1', name: 'Alfajor', created_at: NOW, updated_at: NOW })
      .execute();
    await a.insertInto('stock').values({ product_id: 'p1', branch_id: 'central', quantity: 3, updated_at: NOW }).execute();

    const query = a
      .selectFrom('stock')
      .innerJoin('products', 'products.id', 'stock.product_id')
      .select(['products.name', 'stock.quantity'])
      .where('stock.branch_id', 'in', (eb) => eb.selectFrom('branches').select('branches.id'));

    expect(await query.execute()).toEqual([{ name: 'Alfajor', quantity: 3 }]);
    // Ninguna de las tres tablas aparece sin su esquema adelante.
    expect(query.compile().sql).not.toMatch(/(?<!"tenant_kiosco-a"\.)"(stock|products|branches)"/);
  });

  it('en SQL crudo, sql.table() queda en el esquema del comercio', async () => {
    const a = db().forTenant('kiosco-a');
    await a.insertInto('branches').values(branch('central', 'Central de A')).execute();

    const conTabla = a.selectFrom('branches').select(sql<number>`(SELECT count(*) FROM ${sql.table('branches')})`.as('n'));

    expect(conTabla.compile().sql).toContain('FROM "tenant_kiosco-a"."branches")');
    expect(await conTabla.execute()).toEqual([{ n: 1 }]);
  });

  it('en SQL crudo, un nombre de tabla escrito a mano se escapa del esquema: por eso está prohibido', async () => {
    const a = db().forTenant('kiosco-a');
    await a.insertInto('branches').values(branch('central', 'Central de A')).execute();

    const aMano = a.selectFrom('branches').select(sql<number>`(SELECT count(*) FROM branches)`.as('n'));

    await expect(aMano.execute()).rejects.toThrow(/relation "branches" does not exist/);
  });

  it('el esquema system no ve las tablas de un comercio ni al revés', async () => {
    await db().system.insertInto('tenants').values({ id: 'kiosco-a', slug: 'kiosco-a', name: 'A', created_at: NOW }).execute();

    const { rows } = await sql<{ schemaname: string }>`
      SELECT schemaname FROM pg_tables WHERE tablename = 'tenants'`.execute(db().root);
    expect(rows).toEqual([{ schemaname: 'system' }]);
    expect(db().system.selectFrom('tenants').select('id').compile().sql).toContain('"system"."tenants"');
  });
});
