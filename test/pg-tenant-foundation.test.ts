import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { MAX_SLUG_LENGTH, slugify } from '../src/server/alta/slug.ts';
import { argentinaDay, jsonValue, stripNul } from '../src/server/db/pg/sql-helpers.ts';
import { isValidTenantId, tenantSchemaName } from '../src/server/db/pg/tenant-schema-name.ts';
import { DEFAULT_BRANCH_ID, TenantManager } from '../src/server/db/tenant-manager.ts';
import { argentinaDay as argentinaDayTs } from '../src/shared/argentina-day.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();
const NOW = '2026-11-11T12:00:00.000Z';

async function schemaExists(tenantId: string): Promise<boolean> {
  const { rows } = await sql`SELECT 1 FROM pg_namespace WHERE nspname = ${tenantSchemaName(tenantId)}`.execute(db().root);
  return rows.length > 0;
}

describe('cimientos de comercio en PostgreSQL (fase 4)', () => {
  it('slugify corta el slug para que el id entre en un esquema, con lugar para el sufijo', () => {
    const slug = slugify('Kiosco '.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
    expect(isValidTenantId(`${slug}-9999999`)).toBe(true);
    // Un nombre corto no cambia
    expect(slugify('Almacén Doña Rosa')).toBe('almacen-dona-rosa');
  });

  it('un comercio de nombre larguísimo se crea, y el segundo con el mismo nombre también', async () => {
    const manager = new TenantManager(db());
    const slug = slugify('La Gran Ferretería Industrial y Corralón de Materiales del Barrio Norte');
    const first = await manager.createTenant({ id: slug, slug, name: 'Uno' });
    const second = await manager.createTenant({ id: slug, slug, name: 'Dos' });
    expect(first.id).toBe(slug);
    expect(second.id).toBe(`${slug}-2`);
    expect(await schemaExists(second.id)).toBe(true);
  });

  it('createTenant crea el esquema del comercio con su sucursal por defecto', async () => {
    const manager = new TenantManager(db());
    await manager.createTenant({ id: 'kiosco-a', slug: 'kiosco-a', name: 'Kiosco A' });
    const branches = await manager.forTenant('kiosco-a').selectFrom('branches').select(['id', 'code', 'name']).execute();
    expect(branches).toEqual([{ id: DEFAULT_BRANCH_ID, code: 'CENTRAL', name: 'Sucursal Central' }]);
  });

  it('deleteTenant borra la fila y el esquema; el bono del comercio se va con él', async () => {
    const manager = new TenantManager(db());
    await manager.createTenant({ id: 'kiosco-a', slug: 'kiosco-a', name: 'Kiosco A' });
    await db()
      .system.insertInto('gift_credits')
      .values({ id: 'g1', tenant_id: 'kiosco-a', amount: 100, expires_at: NOW, origin: 'signup', created_at: NOW })
      .execute();

    await manager.deleteTenant('kiosco-a');

    expect(await schemaExists('kiosco-a')).toBe(false);
    expect(await db().system.selectFrom('tenants').select('id').execute()).toEqual([]);
    expect(await db().system.selectFrom('gift_credits').select('id').execute()).toEqual([]);
  });

  it('si el esquema no se puede crear, createTenant no deja el comercio a medias', async () => {
    const manager = new TenantManager(db());
    // Un esquema que ya existe con ese nombre: createTenantSchema falla
    await sql`CREATE SCHEMA ${sql.id(tenantSchemaName('ocupado'))}`.execute(db().root);
    await expect(manager.createTenant({ id: 'ocupado', slug: 'ocupado', name: 'Ocupado' })).rejects.toThrow(/ya existe/);
    expect(await db().system.selectFrom('tenants').select('id').execute()).toEqual([]);
  });

  it('un bono no puede nombrar a un comercio que no existe', async () => {
    await expect(
      db()
        .system.insertInto('gift_credits')
        .values({ id: 'g1', tenant_id: 'fantasma', amount: 100, expires_at: NOW, origin: 'signup', created_at: NOW })
        .execute(),
    ).rejects.toThrow(/foreign key/);
  });

  it('stripNul y jsonValue quitan el carácter nulo de claves y valores', async () => {
    const dirty = { 'cla\u0000ve': 'va\u0000lor', lista: ['a\u0000', { n: 1, t: '\u0000' }], barra: 'C:\\u0000' };
    expect(stripNul(dirty)).toEqual({ clave: 'valor', lista: ['a', { n: 1, t: '' }], barra: 'C:\\u0000' });
    expect(jsonValue({ t: 'a\u0000b' })).toBe('{"t":"ab"}');

    // Lo que sale de jsonValue entra en jsonb
    const { rows } = await sql<{ value: unknown }>`SELECT ${jsonValue(['x\u0000y'])}::jsonb AS value`.execute(db().root);
    expect(rows[0]?.value).toEqual(['xy']);
  });

  it('el día argentino en SQL es el mismo que en TypeScript', async () => {
    for (const instant of ['2026-11-11T02:59:59.999Z', '2026-11-11T03:00:00.000Z', '2026-12-31T23:30:00.000Z', '2027-01-01T02:00:00.000Z']) {
      const { rows } = await sql<{ day: string }>`SELECT ${argentinaDay(sql<string>`${instant}::timestamptz`)} AS day`.execute(db().root);
      expect(rows[0]?.day).toBe(argentinaDayTs(instant));
    }
  });
});
