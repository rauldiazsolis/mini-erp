import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { createTenantSchema } from '../src/server/db/pg/migrations/migrate.ts';
import { inSavepoint, isTransientError } from '../src/server/db/pg/sql-helpers.ts';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

describe('inSavepoint (fase 4)', () => {
  let t: Kysely<TenantDatabase>;
  const at = '2026-10-02T12:00:00.000Z';
  const branch = (id: string) => ({ id, name: id, code: id, created_at: at });

  beforeEach(async () => {
    await createTenantSchema(pgDb().root, 'kiosco');
    t = pgDb().forTenant('kiosco');
  });

  it('un error de PostgreSQL adentro se deshace solo y la transacción sigue sirviendo', async () => {
    await t.transaction().execute(async (trx) => {
      await trx.insertInto('branches').values(branch('a')).execute();
      await expect(
        inSavepoint(trx, 'paso', async () => {
          await trx.insertInto('branches').values(branch('b')).execute();
          // Código repetido: una violación de unicidad, que sin savepoint aborta la transacción
          await trx.insertInto('branches').values({ ...branch('c'), code: 'a' }).execute();
        }),
      ).rejects.toMatchObject({ code: '23505' });
      expect(await inSavepoint(trx, 'paso', async () => (await trx.insertInto('branches').values(branch('d')).returning('id').executeTakeFirstOrThrow()).id)).toBe('d');
    });

    expect((await t.selectFrom('branches').select('id').orderBy('seq').execute()).map((r) => r.id)).toEqual(['a', 'd']);
  });

  it('un error que no es de la base también deshace lo hecho adentro', async () => {
    await t.transaction().execute(async (trx) => {
      await expect(
        inSavepoint(trx, 'paso', async () => {
          await trx.insertInto('branches').values(branch('a')).execute();
          throw new Error('se rompió');
        }),
      ).rejects.toThrow('se rompió');
    });
    expect(await t.selectFrom('branches').select('id').execute()).toEqual([]);
  });
});

describe('isTransientError', () => {
  it('reconoce un deadlock y un fallo de serialización; lo demás no', () => {
    expect(isTransientError({ code: '40P01' })).toBe(true);
    expect(isTransientError({ code: '40001' })).toBe(true);
    expect(isTransientError({ code: '23505' })).toBe(false);
    expect(isTransientError(new Error('x'))).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});
