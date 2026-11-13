import { sql, type Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { SchemaSpec } from '../src/server/db/pg/columns.ts';
import { createTenantSchema } from '../src/server/db/pg/migrations/migrate.ts';
import { SYSTEM_TABLES } from '../src/server/db/pg/system-schema.ts';
import { TENANT_TABLES } from '../src/server/db/pg/tenant-schema.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

const UDT_TO_TYPE: Record<string, string> = {
  text: 'text',
  int4: 'integer',
  int8: 'bigint',
  numeric: 'numeric',
  bool: 'boolean',
  date: 'date',
  timestamptz: 'timestamptz',
  jsonb: 'jsonb',
};

type Described = Record<string, Record<string, string>>;

/** El esquema real, escrito como el manifiesto: `tipo` más `?` (nullable), `=` (default) o `!` (generada). */
async function describeSchema(root: Kysely<unknown>, schemaName: string): Promise<Described> {
  const { rows } = await sql<{
    table_name: string;
    column_name: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    is_identity: string;
  }>`
    SELECT table_name, column_name, udt_name, is_nullable, column_default, is_identity
    FROM information_schema.columns
    WHERE table_schema = ${schemaName} AND table_name <> 'schema_migrations'
    ORDER BY table_name, ordinal_position`.execute(root);
  const described: Described = {};
  for (const row of rows) {
    const type = UDT_TO_TYPE[row.udt_name] ?? `¿${row.udt_name}?`;
    const suffix = row.is_identity === 'YES' ? '!' : row.is_nullable === 'YES' ? '?' : row.column_default !== null ? '=' : '';
    (described[row.table_name] ??= {})[row.column_name] = `${type}${suffix}`;
  }
  return described;
}

function sorted(spec: SchemaSpec | Described): Described {
  return Object.fromEntries(
    Object.entries(spec)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([table, columns]) => [table, Object.fromEntries(Object.entries(columns).sort(([a], [b]) => a.localeCompare(b)))]),
  );
}

describe('el manifiesto de columnas es el esquema real', () => {
  it('system', async () => {
    expect(sorted(await describeSchema(db().root, 'system'))).toEqual(sorted(SYSTEM_TABLES));
  });

  it('un comercio', async () => {
    await createTenantSchema(db().root, 'kiosco-a');
    expect(sorted(await describeSchema(db().root, 'tenant_kiosco-a'))).toEqual(sorted(TENANT_TABLES));
  });
});

describe('cómo llegan los valores a TypeScript', () => {
  it('numeric y bigint llegan como number; timestamptz, como ISO en UTC; date, como YYYY-MM-DD', async () => {
    const { rows } = await sql<Record<string, unknown>>`
      SELECT 1234.50::numeric(14,2) AS dinero,
             0.1250::numeric(14,4) AS cantidad,
             count(*) AS cuenta,
             sum(2.5::numeric) AS suma,
             '2026-11-11 09:30:00.123-03'::timestamptz AS instante,
             '2026-11-11'::date AS dia,
             true AS activo,
             '{"a":[1,2]}'::jsonb AS json`.execute(db().root);

    expect(rows[0]).toEqual({
      dinero: 1234.5,
      cantidad: 0.125,
      cuenta: 1,
      suma: 2.5,
      instante: '2026-11-11T12:30:00.123Z',
      dia: '2026-11-11',
      activo: true,
      json: { a: [1, 2] },
    });
  });

  it('una fila ida y vuelta: dinero con 2 decimales, cantidad con 4, fechas ISO y jsonb', async () => {
    await createTenantSchema(db().root, 'kiosco-a');
    const t = db().forTenant('kiosco-a');
    const now = '2026-11-11T12:30:00.123Z';
    await t.insertInto('branches').values({ id: 'central', name: 'Central', code: 'CENTRAL', created_at: now }).execute();
    await t
      .insertInto('products')
      .values({ id: 'p1', sku: 'P1', name: 'Queso', price: 1999.99, barcodes: JSON.stringify(['779', '780']), created_at: now, updated_at: new Date(now) })
      .execute();
    await t.insertInto('stock').values({ product_id: 'p1', branch_id: 'central', quantity: 1.2345, updated_at: now }).execute();

    const product = await t
      .selectFrom('products')
      .select(['price', 'tax_rate', 'barcodes', 'tracks_stock', 'blocked_reason', 'created_at', 'updated_at'])
      .executeTakeFirstOrThrow();
    const stock = await t.selectFrom('stock').select('quantity').executeTakeFirstOrThrow();

    expect(product).toEqual({
      price: 1999.99,
      tax_rate: 0,
      barcodes: ['779', '780'],
      tracks_stock: true,
      blocked_reason: null,
      created_at: now,
      updated_at: now,
    });
    expect(stock.quantity).toBe(1.2345);
  });

  it('las FK se aplican: stock de un producto que no existe falla', async () => {
    await createTenantSchema(db().root, 'kiosco-a');
    const t = db().forTenant('kiosco-a');
    await expect(
      t.insertInto('stock').values({ product_id: 'no-existe', branch_id: 'tampoco', quantity: 1, updated_at: new Date() }).execute(),
    ).rejects.toThrow(/foreign key/);
  });
});
