import { beforeEach, describe, expect, it } from 'vitest';
import { createTenantSchema } from '../src/server/db/pg/migrations/migrate.ts';
import { jsonValue, searchable, searchPattern } from '../src/server/db/pg/sql-helpers.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();
const NOW = '2026-11-11T12:00:00.000Z';

async function search(query: string): Promise<string[]> {
  const rows = await db()
    .forTenant('kiosco-a')
    .selectFrom('customers')
    .select('name')
    .where((eb) => eb(searchable(eb.ref('name')), 'like', searchPattern(query)))
    .orderBy('name')
    .execute();
  return rows.map((row) => row.name);
}

describe('búsqueda sin distinguir mayúsculas ni tildes', () => {
  beforeEach(async () => {
    await createTenantSchema(db().root, 'kiosco-a');
    const customers = ['José Núñez', 'JOSEFINA PEÑA', 'Ana 100% Real', 'Raúl_Díaz'];
    await db()
      .forTenant('kiosco-a')
      .insertInto('customers')
      .values(customers.map((name, i) => ({ id: `c${String(i)}`, name, created_at: NOW, updated_at: NOW })))
      .execute();
  });

  it('encuentra con o sin tildes y en cualquier caja', async () => {
    expect(await search('jose')).toEqual(['JOSEFINA PEÑA', 'José Núñez']);
    expect(await search('NÚÑEZ')).toEqual(['José Núñez']);
    expect(await search('nunez')).toEqual(['José Núñez']);
    expect(await search('pena')).toEqual(['JOSEFINA PEÑA']);
  });

  it('los comodines que escribe el usuario son texto, no comodines', async () => {
    expect(await search('100%')).toEqual(['Ana 100% Real']);
    expect(await search('%')).toEqual(['Ana 100% Real']);
    expect(await search('_')).toEqual(['Raúl_Díaz']);
  });
});

describe('jsonValue', () => {
  it('guarda un array de JavaScript como JSON, no como array de PostgreSQL', async () => {
    await createTenantSchema(db().root, 'kiosco-a');
    const t = db().forTenant('kiosco-a');
    await t
      .insertInto('products')
      .values({ id: 'p1', sku: 'P1', name: 'Alfajor', barcodes: jsonValue(['779', '780']), created_at: NOW, updated_at: NOW })
      .execute();
    expect(await t.selectFrom('products').select('barcodes').executeTakeFirstOrThrow()).toEqual({ barcodes: ['779', '780'] });
  });
});
