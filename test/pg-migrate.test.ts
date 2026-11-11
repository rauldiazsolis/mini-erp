import { sql, type Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import {
  createTenantSchema,
  dropTenantSchema,
  migrateAll,
  MigrationError,
  migrateSchema,
  SchemaError,
} from '../src/server/db/pg/migrations/migrate.ts';
import { SYSTEM_MIGRATIONS } from '../src/server/db/pg/migrations/system.ts';
import { TENANT_MIGRATIONS } from '../src/server/db/pg/migrations/tenant.ts';
import type { Migration, SchemaMigrations } from '../src/server/db/pg/migrations/types.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

const v1: Migration = {
  version: 1,
  name: 'cosas',
  up: async (conn) => {
    await sql`CREATE TABLE cosas (id text PRIMARY KEY, nombre text NOT NULL)`.execute(conn);
  },
};
const v2: Migration = {
  version: 2,
  name: 'color',
  up: async (conn) => {
    await sql`ALTER TABLE cosas ADD COLUMN color text NOT NULL DEFAULT 'gris'`.execute(conn);
  },
};
const v3Concurrently: Migration = {
  version: 3,
  name: 'indice-nombre',
  transactional: false,
  up: async (conn) => {
    await sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cosas_nombre ON cosas (nombre)`.execute(conn);
  },
};

function schemaOf(...migrations: Migration[]): SchemaMigrations {
  return { kind: 'tenant', migrations };
}

async function versions(root: Kysely<unknown>, schemaName: string): Promise<number[]> {
  const { rows } = await sql<{ version: number }>`
    SELECT version FROM ${sql.id(schemaName, 'schema_migrations')} ORDER BY version`.execute(root);
  return rows.map((row) => row.version);
}

async function searchPath(root: Kysely<unknown>): Promise<string> {
  const { rows } = await sql<{ search_path: string }>`SHOW search_path`.execute(root);
  return rows[0]?.search_path ?? '';
}

describe('las listas de migraciones', () => {
  it.each([SYSTEM_MIGRATIONS, TENANT_MIGRATIONS])('$kind: versiones consecutivas desde la 1', (schema) => {
    expect(schema.migrations.map((migration) => migration.version)).toEqual(schema.migrations.map((_, i) => i + 1));
  });
});

describe('migrateSchema', () => {
  it('crea el esquema, aplica todo en orden y anota cada versión', async () => {
    const result = await migrateSchema(db().root, 'tenant_prueba', schemaOf(v1, v2));
    expect(result).toEqual({ schemaName: 'tenant_prueba', from: 0, to: 2, applied: ['v1 cosas', 'v2 color'] });
    expect(await versions(db().root, 'tenant_prueba')).toEqual([1, 2]);
  });

  it('aplica solo lo pendiente y conserva los datos', async () => {
    await migrateSchema(db().root, 'tenant_prueba', schemaOf(v1));
    await sql`INSERT INTO tenant_prueba.cosas (id, nombre) VALUES ('a', 'Mesa')`.execute(db().root);

    const result = await migrateSchema(db().root, 'tenant_prueba', schemaOf(v1, v2));

    expect(result.applied).toEqual(['v2 color']);
    const { rows } = await sql`SELECT id, nombre, color FROM tenant_prueba.cosas`.execute(db().root);
    expect(rows).toEqual([{ id: 'a', nombre: 'Mesa', color: 'gris' }]);
  });

  it('al día, no hace nada', async () => {
    await migrateSchema(db().root, 'tenant_prueba', schemaOf(v1, v2));
    const result = await migrateSchema(db().root, 'tenant_prueba', schemaOf(v1, v2));
    expect(result).toEqual({ schemaName: 'tenant_prueba', from: 2, to: 2, applied: [] });
  });

  it('una migración que falla deja el esquema como estaba y las anteriores, aplicadas', async () => {
    const rota: Migration = {
      version: 2,
      name: 'rota',
      up: async (conn) => {
        await sql`ALTER TABLE cosas ADD COLUMN color text`.execute(conn);
        await sql`SELECT * FROM no_existe`.execute(conn);
      },
    };

    const error: unknown = await migrateSchema(db().root, 'tenant_prueba', schemaOf(v1, rota)).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).message).toContain('v2 rota en tenant_prueba');
    expect(await versions(db().root, 'tenant_prueba')).toEqual([1]);
    const { rows } = await sql`
      SELECT column_name FROM information_schema.columns WHERE table_schema = 'tenant_prueba' AND table_name = 'cosas' AND column_name = 'color'`.execute(db().root);
    expect(rows).toEqual([]);
  });

  it('corre fuera de una transacción lo marcado transactional: false (CREATE INDEX CONCURRENTLY)', async () => {
    const result = await migrateSchema(db().root, 'tenant_prueba', schemaOf(v1, v2, v3Concurrently));

    expect(result.applied).toEqual(['v1 cosas', 'v2 color', 'v3 indice-nombre']);
    const { rows } = await sql`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'tenant_prueba' AND indexname = 'idx_cosas_nombre'`.execute(db().root);
    expect(rows).toHaveLength(1);
  });

  it('CREATE INDEX CONCURRENTLY falla en una migración transaccional: por eso existe la marca', async () => {
    const sinMarca: Migration = { version: 3, name: 'indice-nombre', up: v3Concurrently.up };
    await expect(migrateSchema(db().root, 'tenant_prueba', schemaOf(v1, v2, sinMarca))).rejects.toThrow(
      /cannot run inside a transaction block/,
    );
  });

  it('no deja el search_path cambiado en la conexión que devuelve al pool', async () => {
    const antes = await searchPath(db().root);
    await migrateSchema(db().root, 'tenant_prueba', schemaOf(v1, v2, v3Concurrently));
    // El pool tiene pocas conexiones: varias consultas seguidas pasan por la que migró.
    for (let i = 0; i < 10; i++) {
      expect(await searchPath(db().root)).toBe(antes);
    }
  });

  it('no abre un esquema más nuevo que el código (un rollback)', async () => {
    await migrateSchema(db().root, 'tenant_prueba', schemaOf(v1, v2));
    await expect(migrateSchema(db().root, 'tenant_prueba', schemaOf(v1))).rejects.toThrow(SchemaError);
  });

  it('dos procesos que migran a la vez no aplican dos veces la misma migración', async () => {
    const schema = schemaOf(v1, v2, v3Concurrently);
    const results = await Promise.all([
      migrateSchema(db().root, 'tenant_prueba', schema),
      migrateSchema(db().root, 'tenant_prueba', schema),
    ]);
    expect(results.map((result) => result.applied.length).sort()).toEqual([0, 3]);
  });
});

describe('los esquemas reales', () => {
  it('createTenantSchema crea el esquema del comercio en la versión del código', async () => {
    const result = await createTenantSchema(db().root, 'kiosco-uno');
    expect(result.schemaName).toBe('tenant_kiosco-uno');
    expect(result.to).toBe(TENANT_MIGRATIONS.migrations.length);
    expect(await db().forTenant('kiosco-uno').selectFrom('branches').select('id').execute()).toEqual([]);
  });

  it('createTenantSchema no pisa un esquema que ya existe', async () => {
    await createTenantSchema(db().root, 'kiosco-uno');
    await expect(createTenantSchema(db().root, 'kiosco-uno')).rejects.toThrow(SchemaError);
  });

  it('dropTenantSchema borra el esquema con sus datos', async () => {
    await createTenantSchema(db().root, 'kiosco-uno');
    await dropTenantSchema(db().root, 'kiosco-uno');
    const { rows } = await sql`SELECT 1 FROM pg_namespace WHERE nspname = 'tenant_kiosco-uno'`.execute(db().root);
    expect(rows).toEqual([]);
  });

  it('migrateAll migra system y el esquema de cada comercio de system.tenants', async () => {
    const now = new Date().toISOString();
    for (const id of ['kiosco-uno', 'almacen-dos']) {
      await db().system.insertInto('tenants').values({ id, slug: id, name: id, created_at: now }).execute();
    }
    const progress: string[] = [];

    const results = await migrateAll(db().root, (result, done, total) => {
      progress.push(`${result.schemaName} ${String(done)}/${String(total)}`);
    });

    expect(results.map((result) => result.schemaName)).toEqual(['system', 'tenant_kiosco-uno', 'tenant_almacen-dos']);
    expect(progress).toEqual(['system 1/3', 'tenant_kiosco-uno 2/3', 'tenant_almacen-dos 3/3']);
    expect(await versions(db().root, 'tenant_almacen-dos')).toEqual(TENANT_MIGRATIONS.migrations.map((m) => m.version));
    expect((await migrateAll(db().root)).every((result) => result.applied.length === 0)).toBe(true);
  });
});
