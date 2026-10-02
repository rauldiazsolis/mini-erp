# Migraciones de esquema con modo mantenimiento: plan de implementación

> **Para agentes:** se ejecuta con `superpowers:executing-plans`, **tarea por tarea en esta misma
> conversación** (AGENTS.md: nunca un subagente por tarea). Al terminar cada tarea: verificar, commitear
> y frenar para que el usuario la revise. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** migraciones numeradas para la base de sistema y la de cada comercio, que corren al
arrancar en un worker mientras el servidor atiende en modo mantenimiento. Además, el admin, el POS y el
deploy saben qué pasa durante la migración.

**Arquitectura:**
- `migrateDb` y `checkDb`, puros y síncronos, sobre un `Schema` (línea de base más migraciones) con
  `PRAGMA user_version`.
- `runMigrations` hace la copia con `VACUUM INTO`, migra todas las bases y restaura si algo falla. Corre
  en un `worker_thread`.
- `startServer` escucha con un handler intercambiable: primero el app de mantenimiento (sin bases),
  después el app completo.

**Stack:** Node 24 (strip de tipos), `node:sqlite`, `node:worker_threads`, Express 4, Preact y signals,
Vitest y supertest. Sin dependencias nuevas.

**Spec:** [`docs/superpowers/specs/2026-10-02-migraciones-mantenimiento-design.md`](../specs/2026-10-02-migraciones-mantenimiento-design.md)

## Restricciones globales

- Todo en español: código, comentarios, commits y mensajes de log.
- TypeScript estricto:
  - sin `any`, sin `!`, sin `as` para callar errores (`as` solo para filas de SQLite, como el resto del
    repo);
  - `unknown` solo en fronteras externas, validado con Zod;
  - sin parameter properties, `enum` ni `namespace`.
- Imports relativos con extensión `.ts` o `.tsx`.
- Opcionales con `exactOptionalPropertyTypes`: las entradas son `x?: T | undefined`; en los resultados
  propios, la propiedad se omite (`...(x === undefined ? {} : { x })`).
- Cliente: solo signals, sin hooks de React ni `preact/hooks`.
- TDD: el test primero, se ve fallar, después el código mínimo.
- Antes de cada commit, en PowerShell: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }`.
  Si se toca el cliente, también `pnpm build`.
- Commits convencionales en español, que terminan con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Línea de base: **sistema 4**, **comercio 1**. Primera migración: **comercio v2 `indices`**.
- `MAINTENANCE_MESSAGE` = `mini contax se está actualizando, vuelve en unos minutos`.
- `Retry-After: 30`. `MIGRATION_TIMEOUT` = 900 s. Se dejan 3 corridas en `pre-migracion/`.
- Producción tiene datos: nada en este plan borra ni reinicia bases.

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `src/server/db/migrations/types.ts` (nuevo) | `Migration`, `Schema`, `currentVersion` |
| `src/server/db/migrations/migrate.ts` (nuevo) | `assessDb`, `migrateDb`, `checkDb`, `SchemaError`, `MigrationError`, `readVersion` |
| `src/server/db/migrations/system.ts` (nuevo) | `SYSTEM_SCHEMA` (línea de base 4) |
| `src/server/db/migrations/tenant.ts` (nuevo) | `TENANT_SCHEMA` (línea de base 1 más v2) |
| `src/server/db/migrations/tenant/v2-indices.ts` (nuevo) | La migración v2 |
| `src/server/db/migrations/run-migrations.ts` (nuevo) | `runMigrations`, `restoreRun`, `MigrationRunError` y los tipos de progreso y resultado |
| `src/server/db/migrations/migrate-worker.ts` (nuevo) | El worker |
| `src/server/db/migrations/worker-runner.ts` (nuevo) | `MigrationRunner`, `runMigrationsInWorker` |
| `src/server/db/system-db.ts`, `tenant-db.ts` | Usan `checkDb`; se va el SQL inline y el `ALTER` suelto |
| `src/server/di/container.ts` | Se va `SYSTEM_DB_PATH` |
| `src/server/connector/backend-info.ts` (nuevo) | `CONTRACT_VERSION`, `MAINTENANCE_MESSAGE`, `backendInfo()` |
| `src/server/routes/connector-routes.ts` | Usa `backendInfo` |
| `src/server/maintenance/maintenance-app.ts` (nuevo) | El app de mantenimiento |
| `src/server/maintenance/maintenance-page.ts` (nuevo) | La página HTML |
| `src/server/startup.ts` (nuevo) | `startServer` |
| `src/server/server.ts` | Usa `startServer` |
| `src/client/state/maintenance-state.ts` (nuevo) | Signal, detección y vuelta |
| `src/client/components/maintenance/MaintenanceView.tsx` (nuevo) | La pantalla |
| `src/client/api/client.ts`, `state/bulk-state.ts`, `state/auth-state.ts`, `App.tsx` | Integración y arreglo de `fetchProfile` |
| `deploy/deploy.sh`, `deploy/README.md`, `AGENTS.md`, `package.json` | Deploy, docs y versión |
| `test/helpers/db-at-version.ts` (nuevo) | `createDbAtVersion` |
| `test/migrations.test.ts`, `tenant-migration-v2.test.ts`, `run-migrations.test.ts`, `worker-runner.test.ts`, `maintenance-app.test.ts`, `startup.test.ts`, `maintenance-client.test.ts` (nuevos) | Tests |

---

### Tarea 1: `migrateDb` y `checkDb` con la línea de base

**Archivos:**
- Crear: `src/server/db/migrations/types.ts`, `migrate.ts`, `system.ts`, `tenant.ts` (por ahora con
  `migrations: []`).
- Modificar: `src/server/db/system-db.ts`, `src/server/db/tenant-db.ts`, `test/db.test.ts:37-41`.
- Test: `test/migrations.test.ts`.

**Interfaces:**
- Produce:
  - `type Migration = { version: number; name: string; up: (db: DatabaseSync) => void }`;
  - `type Schema = { kind: 'system' | 'tenant'; baselineVersion: number; baselineSql: string; migrations: readonly Migration[] }`;
  - `currentVersion(schema): number`, `readVersion(db): number`;
  - `assessDb(db, schema): { kind: 'new' } | { kind: 'current' } | { kind: 'behind'; from: number; to: number }`;
  - `migrateDb(db, schema): { from: number; to: number; applied: string[] }`;
  - `checkDb(db, schema): void`;
  - `class SchemaError`, `class MigrationError { version; migration }`;
  - `SYSTEM_SCHEMA`, `TENANT_SCHEMA`;
  - `SYSTEM_SCHEMA_VERSION` y `TENANT_SCHEMA_VERSION`, que siguen exportados desde `system-db.ts` y
    `tenant-db.ts`.

- [ ] **Paso 1: escribir el test que falla** (`test/migrations.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { assessDb, checkDb, migrateDb, readVersion, MigrationError, SchemaError } from '../src/server/db/migrations/migrate.ts';
import { currentVersion, type Schema } from '../src/server/db/migrations/types.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';

/** Schema de prueba: línea de base 1 con una tabla, v2 agrega una columna y v3 falla si se lo piden. */
const PRUEBA: Schema = {
  kind: 'tenant',
  baselineVersion: 1,
  baselineSql: 'CREATE TABLE cosas (id TEXT PRIMARY KEY, nombre TEXT NOT NULL);',
  migrations: [
    { version: 2, name: 'color', up: (db) => { db.exec("ALTER TABLE cosas ADD COLUMN color TEXT NOT NULL DEFAULT 'gris'"); } },
    {
      version: 3,
      name: 'rompe',
      up: (db) => {
        db.exec('CREATE TABLE a_medias (id TEXT)');
        const romper = db.prepare("SELECT 1 FROM cosas WHERE id = 'romper'").get();
        if (romper !== undefined) {
          throw new Error('pedido de romper');
        }
      },
    },
  ],
};

function baseEn(version: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(PRUEBA.baselineSql);
  for (const m of PRUEBA.migrations) {
    if (m.version <= version) m.up(db);
  }
  db.exec(`PRAGMA user_version = ${String(version)}`);
  return db;
}

const tablas = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe('migraciones de esquema (#47)', () => {
  it('las migraciones de cada schema son consecutivas desde la línea de base', () => {
    for (const schema of [SYSTEM_SCHEMA, TENANT_SCHEMA]) {
      schema.migrations.forEach((m, i) => {
        expect(m.version).toBe(schema.baselineVersion + i + 1);
      });
    }
    expect(SYSTEM_SCHEMA.baselineVersion).toBe(4);
    expect(TENANT_SCHEMA.baselineVersion).toBe(1);
  });

  it('una base nueva queda en la versión actual con todas las migraciones', () => {
    const db = new DatabaseSync(':memory:');
    expect(assessDb(db, PRUEBA)).toEqual({ kind: 'new' });
    expect(migrateDb(db, PRUEBA)).toEqual({ from: 0, to: 3, applied: [] });
    expect(readVersion(db)).toBe(3);
    expect(tablas(db)).toEqual(['a_medias', 'cosas']);
  });

  it('aplica las pendientes en orden y conserva los datos', () => {
    const db = baseEn(1);
    db.prepare('INSERT INTO cosas (id, nombre) VALUES (?, ?)').run('c1', 'Martillo');
    expect(assessDb(db, PRUEBA)).toEqual({ kind: 'behind', from: 1, to: 3 });
    expect(migrateDb(db, PRUEBA)).toEqual({ from: 1, to: 3, applied: ['v2 color', 'v3 rompe'] });
    expect(readVersion(db)).toBe(3);
    expect(db.prepare('SELECT nombre, color FROM cosas').all()).toEqual([{ nombre: 'Martillo', color: 'gris' }]);
  });

  it('una migración que falla deja la versión y los datos como estaban', () => {
    const db = baseEn(2);
    db.prepare('INSERT INTO cosas (id, nombre) VALUES (?, ?)').run('romper', 'x');
    expect(() => migrateDb(db, PRUEBA)).toThrow(MigrationError);
    expect(() => migrateDb(db, PRUEBA)).toThrow(/v3 rompe: pedido de romper/);
    expect(readVersion(db)).toBe(2);
    expect(tablas(db)).toEqual(['cosas']);
  });

  it('frena con una base anterior a la línea de base', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE vieja (id TEXT); PRAGMA user_version = 3');
    expect(() => assessDb(db, SYSTEM_SCHEMA)).toThrow(SchemaError);
    expect(() => assessDb(db, SYSTEM_SCHEMA)).toThrow(/anterior a la línea de base/);
  });

  it('frena con una base con tablas y sin versión', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE suelta (id TEXT)');
    expect(() => assessDb(db, PRUEBA)).toThrow(/sin versión/);
  });

  it('frena con una base más nueva que el código', () => {
    const db = baseEn(3);
    db.exec('PRAGMA user_version = 9');
    expect(() => migrateDb(db, PRUEBA)).toThrow(/más nueva \(v9\) que este código \(v3\)/);
  });

  it('checkDb crea una base nueva pero no migra una atrasada', () => {
    const nueva = new DatabaseSync(':memory:');
    checkDb(nueva, PRUEBA);
    expect(readVersion(nueva)).toBe(currentVersion(PRUEBA));

    const atrasada = baseEn(1);
    expect(() => { checkDb(atrasada, PRUEBA); }).toThrow(/migraciones pendientes \(v1 → v3\)/);
    expect(readVersion(atrasada)).toBe(1);
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/migrations.test.ts`. Esperado: FAIL, porque no existe
`src/server/db/migrations/migrate.ts`.

- [ ] **Paso 3: implementar**

`src/server/db/migrations/types.ts`:

```typescript
import type { DatabaseSync } from 'node:sqlite';

/** Un cambio de esquema (#47). `up` corre dentro de una transacción que abre `migrateDb`: no abre otra. */
export type Migration = { version: number; name: string; up: (db: DatabaseSync) => void };

/** Línea de base más migraciones de un tipo de base. La línea de base no se toca nunca más. */
export type Schema = {
  kind: 'system' | 'tenant';
  baselineVersion: number;
  baselineSql: string;
  migrations: readonly Migration[];
};

export function currentVersion(schema: Schema): number {
  const last = schema.migrations.at(-1);
  return last === undefined ? schema.baselineVersion : last.version;
}
```

`src/server/db/migrations/migrate.ts`:

```typescript
import type { DatabaseSync } from 'node:sqlite';
import { currentVersion, type Schema } from './types.ts';

/** Una base que este código no puede abrir ni migrar (anterior a la línea de base, más nueva, atrasada). */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

/** Una migración que falló: su transacción ya dejó la base como estaba. */
export class MigrationError extends Error {
  version: number;
  migration: string;
  constructor(version: number, migration: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`migración v${String(version)} ${migration}: ${detail}`, { cause });
    this.name = 'MigrationError';
    this.version = version;
    this.migration = migration;
  }
}

const LABEL: Record<Schema['kind'], string> = { system: 'de sistema', tenant: 'del comercio' };

export function readVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function hasTables(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get() !== undefined;
}

export type DbState = { kind: 'new' } | { kind: 'current' } | { kind: 'behind'; from: number; to: number };

/** Dónde está una base frente al código. Tira `SchemaError` si está fuera de rango. */
export function assessDb(db: DatabaseSync, schema: Schema): DbState {
  const version = readVersion(db);
  const target = currentVersion(schema);
  const label = LABEL[schema.kind];
  if (version === 0) {
    if (hasTables(db)) {
      throw new SchemaError(`La base ${label} tiene tablas sin versión: no se puede migrar`);
    }
    return { kind: 'new' };
  }
  if (version < schema.baselineVersion) {
    throw new SchemaError(
      `La base ${label} es anterior a la línea de base (v${String(version)} < v${String(schema.baselineVersion)}): no se puede migrar`,
    );
  }
  if (version > target) {
    throw new SchemaError(
      `La base ${label} es más nueva (v${String(version)}) que este código (v${String(target)}): ¿un rollback?`,
    );
  }
  return version === target ? { kind: 'current' } : { kind: 'behind', from: version, to: target };
}

/** Una base vacía: línea de base y todas las migraciones, en una sola transacción. */
function createAtCurrent(db: DatabaseSync, schema: Schema): void {
  db.exec('BEGIN');
  try {
    db.exec(schema.baselineSql);
    for (const migration of schema.migrations) {
      migration.up(db);
    }
    db.exec(`PRAGMA user_version = ${String(currentVersion(schema))}`);
    db.exec('COMMIT');
  } catch (err: unknown) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Lleva una base a la versión del código (#47): una transacción por migración, con `user_version`
 * adentro. Si una falla, esa queda como estaba y se corta acá.
 */
export function migrateDb(db: DatabaseSync, schema: Schema): { from: number; to: number; applied: string[] } {
  const state = assessDb(db, schema);
  const to = currentVersion(schema);
  if (state.kind === 'new') {
    createAtCurrent(db, schema);
    return { from: 0, to, applied: [] };
  }
  if (state.kind === 'current') {
    return { from: to, to, applied: [] };
  }
  const applied: string[] = [];
  for (const migration of schema.migrations) {
    if (migration.version <= state.from) {
      continue;
    }
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${String(migration.version)}`);
      db.exec('COMMIT');
    } catch (err: unknown) {
      db.exec('ROLLBACK');
      throw new MigrationError(migration.version, migration.name, err);
    }
    applied.push(`v${String(migration.version)} ${migration.name}`);
  }
  return { from: state.from, to, applied };
}

/**
 * Para abrir una base fuera del arranque: crea una nueva en la versión actual y verifica que una
 * existente esté al día. Nunca migra datos (eso es del arranque, con copia previa).
 */
export function checkDb(db: DatabaseSync, schema: Schema): void {
  const state = assessDb(db, schema);
  if (state.kind === 'new') {
    createAtCurrent(db, schema);
    return;
  }
  if (state.kind === 'behind') {
    throw new SchemaError(
      `La base ${LABEL[schema.kind]} tiene migraciones pendientes (v${String(state.from)} → v${String(state.to)}): se migran al arrancar el servidor`,
    );
  }
}
```

`src/server/db/migrations/system.ts`: mover el template literal `SYSTEM_SCHEMA` de `system-db.ts`
tal cual (líneas 7 a 112):

```typescript
import type { Schema } from './types.ts';

/** Base de sistema (#47): línea de base 4 (la de M2). Desde acá, todo cambio es una migración. */
export const SYSTEM_SCHEMA: Schema = {
  kind: 'system',
  baselineVersion: 4,
  baselineSql: `
CREATE TABLE IF NOT EXISTS users (
  -- … el SQL de hoy, sin cambios, hasta el índice idx_audit_tenant …
`,
  migrations: [],
};
```

`src/server/db/migrations/tenant.ts`: mover `TENANT_SCHEMA` de `tenant-db.ts` (líneas 7 a 154)
tal cual. `stock_movements` ya trae `notes`, así que el `ALTER` suelto desaparece:

```typescript
import type { Schema } from './types.ts';

/** Base de cada comercio (#47): línea de base 1 (con `notes`, que antes era un ALTER suelto). */
export const TENANT_SCHEMA: Schema = {
  kind: 'tenant',
  baselineVersion: 1,
  baselineSql: `
CREATE TABLE IF NOT EXISTS branches (
  -- … el SQL de hoy, sin cambios, hasta tenant_settings …
`,
  migrations: [],
};
```

> El SQL se copia entero, sin cambiar ni un carácter: la línea de base tiene que ser igual a lo que
> crearon las bases de producción.

`src/server/db/system-db.ts`, después del cambio:

```typescript
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkDb } from './migrations/migrate.ts';
import { SYSTEM_SCHEMA } from './migrations/system.ts';
import { currentVersion } from './migrations/types.ts';

export const SYSTEM_SCHEMA_VERSION = currentVersion(SYSTEM_SCHEMA);

/** Crea una base nueva en la versión actual o verifica que esté al día (#47): nunca migra datos. */
export function initSystemDb(db: DatabaseSync): void {
  checkDb(db, SYSTEM_SCHEMA);
}

export function openSystemDb(path: string): DatabaseSync {
  // … igual que hoy …
}
```

`src/server/db/tenant-db.ts`: lo mismo con `TENANT_SCHEMA`, `TENANT_SCHEMA_VERSION` e
`initTenantDb`. Se borra el `try { ALTER … } catch`.

`test/db.test.ts:37-41`: el test "frena con una base de sistema de un esquema anterior (#19)" pasa
a:

```typescript
    it('frena con una base de sistema anterior a la línea de base (#47)', () => {
      const db = new DatabaseSync(':memory:');
      db.exec('CREATE TABLE vieja (id TEXT); PRAGMA user_version = 3');
      expect(() => { initSystemDb(db); }).toThrow(/anterior a la línea de base/);
    });
```

- [ ] **Paso 4: correr los tests**

Correr `pnpm vitest run test/migrations.test.ts test/db.test.ts`. Esperado: PASS. Después, la suite
entera con `pnpm test`: todos en verde, porque las bases nuevas se crean igual que antes.

- [ ] **Paso 5: verificar y commitear**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/server/db test/migrations.test.ts test/db.test.ts
git commit -m "feat: migraciones de esquema con línea de base (#47)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar: el usuario revisa.

---

### Tarea 2: migración del comercio v2 `indices`

**Archivos:**
- Crear: `src/server/db/migrations/tenant/v2-indices.ts`, `test/helpers/db-at-version.ts`.
- Modificar: `src/server/db/migrations/tenant.ts` (`migrations: [v2Indices]`).
- Test: `test/tenant-migration-v2.test.ts`.

**Interfaces:**
- Consume `Migration`, `Schema`, `migrateDb` y `readVersion` (tarea 1).
- Produce:
  - `v2Indices: Migration`;
  - `createDbAtVersion(schema: Schema, version: number, path?: string): DatabaseSync`, que usan las
    tareas 3 y 4 y todas las migraciones que vengan.

- [ ] **Paso 1: escribir el helper y el test que falla**

`test/helpers/db-at-version.ts`:

```typescript
import { DatabaseSync } from 'node:sqlite';
import type { Schema } from '../../src/server/db/migrations/types.ts';

/** Una base como la dejaba la versión `version` del código (#47): línea de base y migraciones hasta ahí. */
export function createDbAtVersion(schema: Schema, version: number, path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(schema.baselineSql);
  for (const migration of schema.migrations) {
    if (migration.version <= version) {
      migration.up(db);
    }
  }
  db.exec(`PRAGMA user_version = ${String(version)}`);
  return db;
}
```

`test/tenant-migration-v2.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { migrateDb, readVersion } from '../src/server/db/migrations/migrate.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { createDbAtVersion } from './helpers/db-at-version.ts';

const TABLAS = [
  'branches', 'products', 'stock', 'customers', 'account_holds', 'account_movements', 'sales',
  'stock_movements', 'cash_movements', 'customer_payments', 'push_lots', 'idempotency_keys', 'tenant_settings',
];

function sembrarV1(db: DatabaseSync): void {
  const at = '2026-10-01T12:00:00.000Z';
  db.prepare('INSERT INTO branches (id, name, code, created_at) VALUES (?, ?, ?, ?)').run('b1', 'Central', 'CENTRAL', at);
  db.prepare('INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'SKU1', 'Yerba', at, at);
  db.prepare('INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'b1', 7, at);
  db.prepare('INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('c1', 'Ana', at, at);
  db.prepare('INSERT INTO account_holds (id, customer_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)').run('h1', 'c1', 100, 'pending', at);
  db.prepare('INSERT INTO account_movements (id, customer_id, type, amount, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('m1', 'c1', 'sale', 100, 100, at);
  db.prepare('INSERT INTO sales (id, payload, total, created_at) VALUES (?, ?, ?, ?)').run('s1', '{}', 100, at);
  db.prepare('INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('sm1', 'p1', 'b1', -1, 'sale', 'nota', at);
  db.prepare('INSERT INTO cash_movements (id, payload, created_at) VALUES (?, ?, ?)').run('cm1', '{}', at);
  db.prepare('INSERT INTO customer_payments (id, customer_id, payload, created_at) VALUES (?, ?, ?, ?)').run('cp1', 'c1', '{}', at);
  db.prepare('INSERT INTO push_lots (id, device_id, status, events, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('l1', 'd1', 'ok', '[]', at, at);
  db.prepare('INSERT INTO idempotency_keys (key, status, body, created_at) VALUES (?, ?, ?, ?)').run('k1', 200, '{}', at);
  db.prepare('INSERT INTO tenant_settings (key, value) VALUES (?, ?)').run('ticket', '1');
}

const contar = (db: DatabaseSync): Record<string, number> =>
  Object.fromEntries(TABLAS.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));

describe('comercio v2 indices (#47)', () => {
  it('una base v1 con datos pasa a v2 sin perder nada', () => {
    const db = createDbAtVersion(TENANT_SCHEMA, 1);
    sembrarV1(db);
    const antes = contar(db);
    expect(Object.values(antes).every((n) => n === 1)).toBe(true);

    expect(migrateDb(db, TENANT_SCHEMA)).toEqual({ from: 1, to: 2, applied: ['v2 indices'] });
    expect(readVersion(db)).toBe(2);
    expect(contar(db)).toEqual(antes);
    expect(db.prepare('SELECT notes FROM stock_movements').get()).toEqual({ notes: 'nota' });
  });

  it('crea los índices y las consultas los usan', () => {
    const db = createDbAtVersion(TENANT_SCHEMA, 1);
    migrateDb(db, TENANT_SCHEMA);
    const indices = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(indices).toEqual([
      'idx_account_holds_customer',
      'idx_account_movements_customer',
      'idx_sales_created_at',
      'idx_sales_voids_sale_id',
      'idx_stock_movements_created_at',
      'idx_stock_movements_product',
    ]);
    const plan = (db.prepare('EXPLAIN QUERY PLAN SELECT * FROM account_movements WHERE customer_id = ?').all('c1') as { detail: string }[])
      .map((r) => r.detail).join(' ');
    expect(plan).toContain('idx_account_movements_customer');
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/tenant-migration-v2.test.ts`. Esperado: FAIL, porque `migrateDb`
devuelve `{ from: 1, to: 1, … }` y no hay índices.

- [ ] **Paso 3: implementar**

`src/server/db/migrations/tenant/v2-indices.ts`:

```typescript
import type { Migration } from '../types.ts';

/** Índices para el dashboard, el Kardex, el extracto de cuenta corriente y los holds (#47). */
export const v2Indices: Migration = {
  version: 2,
  name: 'indices',
  up: (db) => {
    db.exec(`
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at);
CREATE INDEX IF NOT EXISTS idx_sales_voids_sale_id ON sales (voids_sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements (created_at);
CREATE INDEX IF NOT EXISTS idx_account_movements_customer ON account_movements (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_account_holds_customer ON account_holds (customer_id, status);
`);
  },
};
```

En `tenant.ts`: `import { v2Indices } from './tenant/v2-indices.ts';` y `migrations: [v2Indices]`.

- [ ] **Paso 4: correr los tests**

Correr `pnpm vitest run test/tenant-migration-v2.test.ts test/migrations.test.ts test/db.test.ts`.
Esperado: PASS. En `db.test.ts`, `TENANT_SCHEMA_VERSION` ahora es 2 y el test lo compara contra la
constante, así que pasa igual.

- [ ] **Paso 5: verificar y commitear**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/server/db/migrations test/helpers test/tenant-migration-v2.test.ts
git commit -m "feat: migración del comercio v2 con índices (#47)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar: el usuario revisa.

---

### Tarea 3: `runMigrations` con copia previa y restauración

**Archivos:**
- Crear: `src/server/db/migrations/run-migrations.ts`.
- Modificar: `src/server/di/container.ts:27-33` (se va `SYSTEM_DB_PATH`).
- Test: `test/run-migrations.test.ts`.

**Interfaces:**
- Consume `assessDb`, `migrateDb`, `SchemaError`, `SYSTEM_SCHEMA`, `TENANT_SCHEMA` y
  `createDbAtVersion`.
- Produce:
  - `type MigrationProgress = { file: string; done: number; total: number }`;
  - `type MigratedFile = { file: string; from: number; to: number }`;
  - `type MigrationRunResult = { runDir?: string; migrated: MigratedFile[] }`;
  - `runMigrations(params: { dataDir: string; now: Date; keepRuns?: number | undefined; onProgress?: ((p: MigrationProgress) => void) | undefined; schemas?: { system: Schema; tenant: Schema } | undefined }): MigrationRunResult`;
  - `restoreRun(runDir: string, dataDir: string, files: readonly string[]): void`;
  - `class MigrationRunError { file: string }`;
  - `PRE_MIGRATION_DIR = 'pre-migracion'`.

`file` siempre es relativo a `dataDir` y usa `/` (`system.sqlite`, `tenants/<id>.sqlite`).

- [ ] **Paso 1: escribir el test que falla** (`test/run-migrations.test.ts`)

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { readVersion } from '../src/server/db/migrations/migrate.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import type { Schema } from '../src/server/db/migrations/types.ts';
import { MigrationRunError, PRE_MIGRATION_DIR, restoreRun, runMigrations, type MigrationProgress } from '../src/server/db/migrations/run-migrations.ts';

let root = '';
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Schemas de prueba: sistema v5 y comercio v3 sobre lo que crea el código de hoy. */
function schemasDePrueba(tenantUp?: (db: DatabaseSync) => void): { system: Schema; tenant: Schema } {
  return {
    system: { ...SYSTEM_SCHEMA, migrations: [...SYSTEM_SCHEMA.migrations, { version: 5, name: 'prueba', up: (db) => { db.exec('CREATE TABLE prueba (id TEXT)'); } }] },
    tenant: {
      ...TENANT_SCHEMA,
      migrations: [
        ...TENANT_SCHEMA.migrations,
        { version: 3, name: 'columna', up: tenantUp ?? ((db) => { db.exec('ALTER TABLE products ADD COLUMN prueba TEXT'); }) },
      ],
    },
  };
}

/** Un directorio de datos con el código de hoy: sistema v4, comercios v2 y una demo. */
function sembrar(ids: string[] = ['kiosco-real']): string {
  root = mkdtempSync(join(tmpdir(), 'mini-erp-migr-'));
  const dataDir = join(root, 'data');
  const systemDb = openSystemDb(join(dataDir, 'system.sqlite'));
  const tenants = new TenantManager(systemDb, { baseDir: join(dataDir, 'tenants') });
  for (const id of ids) {
    tenants.createTenant({ id, slug: id, name: id });
  }
  tenants.createTenant({ id: 'demo-abc', slug: 'demo-abc', name: 'Demo' });
  const at = new Date().toISOString();
  systemDb.prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)').run('demo-abc', 'kiosco', at, at);
  const kiosco = tenants.getTenantDb(ids[0] ?? 'kiosco-real');
  kiosco.prepare('INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'SKU1', 'Yerba', at, at);
  tenants.closeAll();
  systemDb.close();
  return dataDir;
}

function versionDe(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return readVersion(db);
  } finally {
    db.close();
  }
}

const NOW = new Date('2026-10-02T14:30:00Z');

describe('runMigrations (#47)', () => {
  it('sin base de sistema no hace nada', () => {
    root = mkdtempSync(join(tmpdir(), 'mini-erp-migr-'));
    expect(runMigrations({ dataDir: join(root, 'vacio'), now: NOW })).toEqual({ migrated: [] });
  });

  it('sin nada pendiente no copia nada', () => {
    const dataDir = sembrar();
    expect(runMigrations({ dataDir, now: NOW })).toEqual({ migrated: [] });
    expect(existsSync(join(dataDir, PRE_MIGRATION_DIR))).toBe(false);
  });

  it('migra sistema, comercios y demos, conserva los datos y avisa el progreso', () => {
    const dataDir = sembrar();
    const progreso: MigrationProgress[] = [];
    const result = runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba(), onProgress: (p) => progreso.push(p) });

    expect(result.migrated).toEqual([
      { file: 'system.sqlite', from: 4, to: 5 },
      { file: 'tenants/demo-abc.sqlite', from: 2, to: 3 },
      { file: 'tenants/kiosco-real.sqlite', from: 2, to: 3 },
    ]);
    expect(progreso.map((p) => `${p.file} ${String(p.done)}/${String(p.total)}`)).toEqual([
      'system.sqlite 1/3', 'tenants/demo-abc.sqlite 2/3', 'tenants/kiosco-real.sqlite 3/3',
    ]);
    expect(versionDe(join(dataDir, 'system.sqlite'))).toBe(5);
    const kiosco = new DatabaseSync(join(dataDir, 'tenants', 'kiosco-real.sqlite'));
    expect(kiosco.prepare('SELECT name, prueba FROM products').all()).toEqual([{ name: 'Yerba', prueba: null }]);
    kiosco.close();
  });

  it('copia antes de migrar, en la versión vieja, solo lo pendiente', () => {
    const dataDir = sembrar();
    const { runDir } = runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba() });
    expect(runDir).toBe(join(dataDir, PRE_MIGRATION_DIR, '2026-10-02T14-30-00'));
    expect(versionDe(join(runDir ?? '', 'system.sqlite'))).toBe(4);
    expect(versionDe(join(runDir ?? '', 'tenants', 'kiosco-real.sqlite'))).toBe(2);
    expect(readdirSync(join(runDir ?? '', 'tenants')).sort()).toEqual(['demo-abc.sqlite', 'kiosco-real.sqlite']);
  });

  it('deja las últimas keepRuns corridas', () => {
    const dataDir = sembrar();
    for (const vieja of ['2026-09-01T00-00-00', '2026-09-02T00-00-00', '2026-09-03T00-00-00']) {
      mkdirSync(join(dataDir, PRE_MIGRATION_DIR, vieja), { recursive: true });
    }
    runMigrations({ dataDir, now: NOW, keepRuns: 3, schemas: schemasDePrueba() });
    expect(readdirSync(join(dataDir, PRE_MIGRATION_DIR)).sort()).toEqual([
      '2026-09-02T00-00-00', '2026-09-03T00-00-00', '2026-10-02T14-30-00',
    ]);
  });

  it('una base más nueva que el código frena todo sin tocar nada', () => {
    const dataDir = sembrar();
    const kiosco = new DatabaseSync(join(dataDir, 'tenants', 'kiosco-real.sqlite'));
    kiosco.exec('PRAGMA user_version = 9');
    kiosco.close();
    expect(() => runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba() })).toThrow(/kiosco-real.*más nueva/s);
    expect(versionDe(join(dataDir, 'system.sqlite'))).toBe(4);
    expect(existsSync(join(dataDir, PRE_MIGRATION_DIR))).toBe(false);
  });

  it('si un comercio falla, restaura lo ya migrado y todo queda como estaba', () => {
    const dataDir = sembrar(['a-ok', 'b-falla']);
    const falla = new DatabaseSync(join(dataDir, 'tenants', 'b-falla.sqlite'));
    falla.prepare('INSERT INTO tenant_settings (key, value) VALUES (?, ?)').run('romper', '1');
    falla.close();
    const schemas = schemasDePrueba((db) => {
      db.exec('ALTER TABLE products ADD COLUMN prueba TEXT');
      if (db.prepare("SELECT 1 FROM tenant_settings WHERE key = 'romper'").get() !== undefined) {
        throw new Error('pedido de romper');
      }
    });

    expect(() => runMigrations({ dataDir, now: NOW, schemas })).toThrow(MigrationRunError);
    expect(versionDe(join(dataDir, 'system.sqlite'))).toBe(4);
    expect(versionDe(join(dataDir, 'tenants', 'a-ok.sqlite'))).toBe(2);
    expect(versionDe(join(dataDir, 'tenants', 'b-falla.sqlite'))).toBe(2);
    const system = new DatabaseSync(join(dataDir, 'system.sqlite'));
    expect(system.prepare("SELECT name FROM sqlite_master WHERE name = 'prueba'").get()).toBeUndefined();
    system.close();
  });

  it('el error dice qué base y qué migración fallaron', () => {
    const dataDir = sembrar(['b-falla']);
    const schemas = schemasDePrueba(() => { throw new Error('pedido de romper'); });
    // Orden: sistema, b-falla, demo-abc. Falla b-falla y el sistema vuelve a v4
    expect(() => runMigrations({ dataDir, now: NOW, schemas })).toThrow(
      'tenants/b-falla.sqlite, migración v3 columna: pedido de romper',
    );
    expect(versionDe(join(dataDir, 'system.sqlite'))).toBe(4);
  });

  it('restoreRun copia encima y borra -wal y -shm', () => {
    const dataDir = sembrar();
    const { runDir } = runMigrations({ dataDir, now: NOW, schemas: schemasDePrueba() });
    const file = join(dataDir, 'system.sqlite');
    writeFileSync(`${file}-wal`, 'basura');
    writeFileSync(`${file}-shm`, 'basura');
    restoreRun(runDir ?? '', dataDir, ['system.sqlite']);
    expect(versionDe(file)).toBe(4);
    expect(existsSync(`${file}-wal`)).toBe(false);
    expect(existsSync(`${file}-shm`)).toBe(false);
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/run-migrations.test.ts`. Esperado: FAIL, porque no existe
`run-migrations.ts`.

- [ ] **Paso 3: implementar** (`src/server/db/migrations/run-migrations.ts`)

```typescript
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assessDb, migrateDb, SchemaError } from './migrate.ts';
import { SYSTEM_SCHEMA } from './system.ts';
import { TENANT_SCHEMA } from './tenant.ts';
import type { Schema } from './types.ts';

export const PRE_MIGRATION_DIR = 'pre-migracion';
const RUN_DIR = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
const SYSTEM_FILE = 'system.sqlite';

export type MigrationProgress = { file: string; done: number; total: number };
export type MigratedFile = { file: string; from: number; to: number };
export type MigrationRunResult = { runDir?: string; migrated: MigratedFile[] };

/** Falló la migración de una base; las ya migradas en la corrida se restauraron. */
export class MigrationRunError extends Error {
  file: string;
  constructor(file: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${file}, ${detail}`, { cause });
    this.name = 'MigrationRunError';
    this.file = file;
  }
}

type Pending = { file: string; schema: Schema; from: number; to: number };

function stamp(now: Date): string {
  return now.toISOString().slice(0, 19).replace(/:/g, '-');
}

/** `VACUUM INTO`: copia consistente y compacta (la misma que el backup nocturno). */
function vacuumInto(from: string, to: string): void {
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    db.prepare('VACUUM INTO ?').run(to);
  } finally {
    db.close();
  }
}

function pruneRuns(dir: string, keep: number): void {
  const runs = readdirSync(dir).filter((d) => RUN_DIR.test(d)).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - keep))) {
    rmSync(join(dir, old), { recursive: true, force: true });
  }
}

/** Vuelve a dejar cada base como estaba en la copia de la corrida. Nadie la tiene que tener abierta. */
export function restoreRun(runDir: string, dataDir: string, files: readonly string[]): void {
  for (const file of files) {
    const target = join(dataDir, file);
    for (const suffix of ['-wal', '-shm']) {
      rmSync(`${target}${suffix}`, { force: true });
    }
    copyFileSync(join(runDir, file), target);
  }
}

/** Qué base está atrasada. Si alguna está fuera de rango, no toca nada y lo dice. */
function plan(dataDir: string, schemas: { system: Schema; tenant: Schema }): Pending[] | undefined {
  const systemPath = join(dataDir, SYSTEM_FILE);
  if (!existsSync(systemPath)) {
    return undefined;
  }
  const targets: { file: string; schema: Schema }[] = [{ file: SYSTEM_FILE, schema: schemas.system }];
  const system = new DatabaseSync(systemPath, { readOnly: true });
  try {
    if (assessDb(system, schemas.system).kind === 'new') {
      return undefined;
    }
    const rows = system.prepare('SELECT id FROM tenants ORDER BY id').all() as { id: string }[];
    for (const { id } of rows) {
      const file = `tenants/${id}.sqlite`;
      if (existsSync(join(dataDir, file))) {
        targets.push({ file, schema: schemas.tenant });
      }
    }
  } catch (err: unknown) {
    if (err instanceof SchemaError) {
      throw new SchemaError(`Bases fuera de rango, no se migró nada:\n${SYSTEM_FILE}: ${err.message}`);
    }
    throw err;
  } finally {
    system.close();
  }

  const pending: Pending[] = [];
  const outOfRange: string[] = [];
  for (const target of targets) {
    const db = new DatabaseSync(join(dataDir, target.file), { readOnly: true });
    try {
      const state = assessDb(db, target.schema);
      if (state.kind === 'behind') {
        pending.push({ ...target, from: state.from, to: state.to });
      }
    } catch (err: unknown) {
      if (!(err instanceof SchemaError)) {
        throw err;
      }
      outOfRange.push(`${target.file}: ${err.message}`);
    } finally {
      db.close();
    }
  }
  if (outOfRange.length > 0) {
    throw new SchemaError(`Bases fuera de rango, no se migró nada:\n${outOfRange.join('\n')}`);
  }
  return pending;
}

/**
 * Migra todas las bases al arrancar (#47): sistema y cada comercio, demos incluidas. Antes copia lo
 * que va a migrar a `pre-migracion/<fecha>/`. Si una falla, restaura las que ya migró: todas quedan
 * en la versión vieja, consistentes.
 */
export function runMigrations(params: {
  dataDir: string;
  now: Date;
  keepRuns?: number | undefined;
  onProgress?: ((progress: MigrationProgress) => void) | undefined;
  schemas?: { system: Schema; tenant: Schema } | undefined;
}): MigrationRunResult {
  const pending = plan(params.dataDir, params.schemas ?? { system: SYSTEM_SCHEMA, tenant: TENANT_SCHEMA });
  if (pending === undefined || pending.length === 0) {
    return { migrated: [] };
  }

  const runsDir = join(params.dataDir, PRE_MIGRATION_DIR);
  const runDir = join(runsDir, stamp(params.now));
  rmSync(runDir, { recursive: true, force: true });
  for (const p of pending) {
    const copy = join(runDir, p.file);
    mkdirSync(dirname(copy), { recursive: true });
    vacuumInto(join(params.dataDir, p.file), copy);
  }
  pruneRuns(runsDir, params.keepRuns ?? 3);

  const migrated: MigratedFile[] = [];
  for (const [index, p] of pending.entries()) {
    const db = new DatabaseSync(join(params.dataDir, p.file));
    try {
      migrateDb(db, p.schema);
    } catch (err: unknown) {
      db.close();
      restoreRun(runDir, params.dataDir, migrated.map((m) => m.file));
      throw new MigrationRunError(p.file, err);
    }
    db.close();
    migrated.push({ file: p.file, from: p.from, to: p.to });
    params.onProgress?.({ file: p.file, done: index + 1, total: pending.length });
  }
  return { runDir, migrated };
}
```

`src/server/di/container.ts:27-33`:

```typescript
/**
 * Definición singleton para la base de datos del sistema: `<DATA_DIR>/system.sqlite`, la misma que
 * migra el arranque (#47). En tests se sobreescribe con toValue() en createRootContainer.
 */
export const systemDbDef = fn.singleton<DatabaseSync>(() => {
  return openSystemDb(join(dataDir(), 'system.sqlite'));
});
```

- [ ] **Paso 4: correr los tests**

Correr `pnpm vitest run test/run-migrations.test.ts`. Esperado: PASS. En Windows, si un `rmSync` del
`afterEach` falla con `EBUSY`, hay alguna base sin cerrar en el código: buscarla y cerrarla, no tapar
el error.

- [ ] **Paso 5: verificar y commitear**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/server/db/migrations/run-migrations.ts src/server/di/container.ts test/run-migrations.test.ts
git commit -m "feat: runMigrations con copia previa y restauración si falla (#47)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar: el usuario revisa.

---

### Tarea 4: el worker de migraciones

**Archivos:**
- Crear: `src/server/db/migrations/migrate-worker.ts`, `src/server/db/migrations/worker-runner.ts`.
- Test: `test/worker-runner.test.ts`.

**Interfaces:**
- Consume `runMigrations`, `MigrationProgress`, `MigrationRunResult` y `createDbAtVersion`.
- Produce:
  - `type MigrationRunner = (dataDir: string, onProgress: (progress: MigrationProgress) => void) => Promise<MigrationRunResult>`;
  - `runMigrationsInWorker: MigrationRunner`;
  - `type WorkerMessage`.

- [ ] **Paso 1: escribir el test que falla** (`test/worker-runner.test.ts`)

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { readVersion } from '../src/server/db/migrations/migrate.ts';
import type { MigrationProgress } from '../src/server/db/migrations/run-migrations.ts';
import { runMigrationsInWorker } from '../src/server/db/migrations/worker-runner.ts';
import { createDbAtVersion } from './helpers/db-at-version.ts';

let root = '';
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Sistema al día y un comercio en v1 (como el de producción antes de la 0.4.0), con un producto. */
function sembrar(tenantVersion = 1): string {
  root = mkdtempSync(join(tmpdir(), 'mini-erp-worker-'));
  const dataDir = join(root, 'data');
  const systemDb = openSystemDb(join(dataDir, 'system.sqlite'));
  systemDb.prepare('INSERT INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)').run('kiosco', 'kiosco', 'Kiosco', 'active', new Date().toISOString());
  systemDb.close();
  mkdirSync(join(dataDir, 'tenants'), { recursive: true });
  const tenant = createDbAtVersion(TENANT_SCHEMA, 1, join(dataDir, 'tenants', 'kiosco.sqlite'));
  const at = new Date().toISOString();
  tenant.prepare('INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('p1', 'SKU1', 'Yerba', at, at);
  tenant.exec(`PRAGMA user_version = ${String(tenantVersion)}`);
  tenant.close();
  return dataDir;
}

describe('runMigrationsInWorker (#47)', () => {
  it('migra en un worker real y avisa el progreso', async () => {
    const dataDir = sembrar();
    const progreso: MigrationProgress[] = [];
    const result = await runMigrationsInWorker(dataDir, (p) => { progreso.push(p); });

    expect(result.migrated).toEqual([{ file: 'tenants/kiosco.sqlite', from: 1, to: 2 }]);
    expect(result.runDir).toBeDefined();
    expect(progreso).toEqual([{ file: 'tenants/kiosco.sqlite', done: 1, total: 1 }]);
    const db = new DatabaseSync(join(dataDir, 'tenants', 'kiosco.sqlite'));
    expect(readVersion(db)).toBe(2);
    expect(db.prepare('SELECT name FROM products').all()).toEqual([{ name: 'Yerba' }]);
    db.close();
  });

  it('rechaza con el motivo si una base está fuera de rango', async () => {
    const dataDir = sembrar(99);
    await expect(runMigrationsInWorker(dataDir, () => undefined)).rejects.toThrow(/más nueva \(v99\)/);
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/worker-runner.test.ts`. Esperado: FAIL, porque no existe
`worker-runner.ts`.

- [ ] **Paso 3: implementar**

`src/server/db/migrations/worker-runner.ts`:

```typescript
import { Worker } from 'node:worker_threads';
import type { MigrationProgress, MigrationRunResult } from './run-migrations.ts';

/** Lo que el worker le manda al hilo principal. */
export type WorkerMessage =
  | { type: 'progress'; progress: MigrationProgress }
  | { type: 'done'; result: MigrationRunResult }
  | { type: 'failed'; message: string };

/** Quien corre las migraciones al arrancar: el worker en producción, una función en los tests. */
export type MigrationRunner = (
  dataDir: string,
  onProgress: (progress: MigrationProgress) => void,
) => Promise<MigrationRunResult>;

/**
 * Corre `runMigrations` en un worker (#47): `node:sqlite` es síncrono y una migración larga en el hilo
 * principal dejaría al servidor sin contestar el mantenimiento.
 */
export const runMigrationsInWorker: MigrationRunner = (dataDir, onProgress) =>
  new Promise<MigrationRunResult>((resolve, reject) => {
    const worker = new Worker(new URL('./migrate-worker.ts', import.meta.url), { workerData: { dataDir } });
    let settled = false;
    const settle = (finish: () => void): void => {
      if (!settled) {
        settled = true;
        finish();
      }
    };
    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') {
        onProgress(message.progress);
      } else if (message.type === 'done') {
        settle(() => { resolve(message.result); });
      } else {
        settle(() => { reject(new Error(message.message)); });
      }
    });
    worker.on('error', (err: Error) => {
      settle(() => { reject(err); });
    });
    worker.on('exit', (code: number) => {
      settle(() => { reject(new Error(`El worker de migraciones terminó sin avisar (código ${String(code)})`)); });
    });
  });
```

`src/server/db/migrations/migrate-worker.ts`:

```typescript
import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { runMigrations } from './run-migrations.ts';
import type { WorkerMessage } from './worker-runner.ts';

/** Worker de migraciones (#47): corre `runMigrations` y le avisa al hilo principal. */
const { dataDir } = z.object({ dataDir: z.string() }).parse(workerData);

function send(message: WorkerMessage): void {
  parentPort?.postMessage(message);
}

try {
  const result = runMigrations({
    dataDir,
    now: new Date(),
    onProgress: (progress) => { send({ type: 'progress', progress }); },
  });
  send({ type: 'done', result });
} catch (err: unknown) {
  send({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
}
```

> `migrate-worker.ts` importa solo un tipo de `worker-runner.ts` (se borra al stripear), así que no
> hay ciclo en tiempo de ejecución.

- [ ] **Paso 4: correr los tests**

Correr `pnpm vitest run test/worker-runner.test.ts`. Esperado: PASS.

Si Vitest no puede cargar el worker por la URL (por ejemplo, `ERR_UNKNOWN_FILE_EXTENSION`), es una
señal de que Node no está stripeando en el worker. Verificar a mano con
`node -e "import('./src/server/db/migrations/worker-runner.ts').then(m => m.runMigrationsInWorker('data', console.log)).then(console.log)"`.
Si a mano anda y en Vitest no, correr ese test con `pool: 'forks'`. **No** cambiar a un `.js`.

- [ ] **Paso 5: verificar y commitear**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/server/db/migrations/migrate-worker.ts src/server/db/migrations/worker-runner.ts test/worker-runner.test.ts
git commit -m "feat: las migraciones corren en un worker (#47)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar: el usuario revisa.

---

### Tarea 5: el app de mantenimiento

**Archivos:**
- Crear: `src/server/connector/backend-info.ts`, `src/server/maintenance/maintenance-app.ts`,
  `src/server/maintenance/maintenance-page.ts`.
- Modificar: `src/server/routes/connector-routes.ts` (líneas 12 y 103-113).
- Test: `test/maintenance-app.test.ts`.

**Interfaces:**
- Produce:
  - `CONTRACT_VERSION = '4.2.0'`, `MAINTENANCE_MESSAGE`;
  - `type BackendInfo`;
  - `backendInfo(params: { status: 'ok' | 'maintenance'; demos: boolean }): BackendInfo`;
  - `type MaintenanceState = { phase: 'migrating' | 'failed'; progress?: { done: number; total: number } }`;
  - `createMaintenanceApp(params: { state: () => MaintenanceState; demos: boolean }): Express`;
  - `RETRY_AFTER_SECONDS = 30`, `MAINTENANCE_PAGE: string`.

- [ ] **Paso 1: escribir el test que falla** (`test/maintenance-app.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createMaintenanceApp, type MaintenanceState } from '../src/server/maintenance/maintenance-app.ts';
import { MAINTENANCE_MESSAGE } from '../src/server/connector/backend-info.ts';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };

function app(state: MaintenanceState = { phase: 'migrating' }, demos = true) {
  return createMaintenanceApp({ state: () => state, demos });
}

describe('app de mantenimiento (#47)', () => {
  it('/health responde 503 maintenance con la versión y el progreso', async () => {
    const res = await request(app({ phase: 'migrating', progress: { done: 3, total: 41 } })).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'maintenance', service: 'mini-erp', version: pkg.version, progress: { done: 3, total: 41 } });
  });

  it('/health dice migration-failed si la migración falló', async () => {
    const res = await request(app({ phase: 'failed' })).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'migration-failed', service: 'mini-erp', version: pkg.version });
  });

  it('/connector/info responde maintenance sin key, con CORS y sin 409', async () => {
    const res = await request(app()).get('/connector/info').set('X-POS-Contract-Version', '9.0.0');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body).toEqual({
      contractVersion: '4.2.0',
      status: 'maintenance',
      message: MAINTENANCE_MESSAGE,
      backend: { name: 'mini-erp', version: pkg.version },
      capabilities: ['demo-sessions'],
    });
  });

  it('sin demos, /connector/info no declara capacidades', async () => {
    const res = await request(app({ phase: 'migrating' }, false)).get('/connector/info');
    expect(res.body).not.toHaveProperty('capabilities');
  });

  it('el preflight de red privada pasa, como en el app real', async () => {
    const res = await request(app())
      .options('/connector/info')
      .set('Origin', 'https://offline-pos.pages.dev')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Private-Network', 'true');
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it.each(['/connector/sync/push', '/connector/sync/pull', '/connector/account-holds', '/connector/demo-sessions'])(
    'POST %s responde 503 con Retry-After',
    async (path) => {
      const res = await request(app()).post(path).send({});
      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('30');
      expect(res.body).toEqual({ code: 'maintenance', message: MAINTENANCE_MESSAGE });
    },
  );

  it('/api responde 503 con el error y el código', async () => {
    const res = await request(app()).get('/api/auth/me');
    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('30');
    expect(res.body).toEqual({ error: MAINTENANCE_MESSAGE, code: 'maintenance' });
  });

  it('cualquier página muestra la pantalla de actualización que reintenta sola', async () => {
    const res = await request(app()).get('/admin');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Estamos actualizando mini contax');
    expect(res.text).toContain("fetch('/health'");
    expect(res.text).toContain('http-equiv="refresh"');
    expect(res.text).not.toMatch(/Mini-ERP|Express|Multitenant/);
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/maintenance-app.test.ts`. Esperado: FAIL, porque no existen los módulos.

- [ ] **Paso 3: implementar**

`src/server/connector/backend-info.ts`:

```typescript
import { APP_VERSION } from '../app-version.ts';

/** Versión del contrato que implementa el mini-erp (4.2.0 más la capacidad demo-sessions de 4.4.0). */
export const CONTRACT_VERSION = '4.2.0';

export const MAINTENANCE_MESSAGE = 'mini contax se está actualizando, vuelve en unos minutos';

export type BackendInfo = {
  contractVersion: string;
  status: 'ok' | 'maintenance';
  message?: string;
  backend: { name: string; version: string };
  capabilities?: string[];
};

/** Respuesta de `GET /connector/info`: la misma en el app real y en el de mantenimiento (#47). */
export function backendInfo(params: { status: 'ok' | 'maintenance'; demos: boolean }): BackendInfo {
  return {
    contractVersion: CONTRACT_VERSION,
    status: params.status,
    ...(params.status === 'maintenance' ? { message: MAINTENANCE_MESSAGE } : {}),
    backend: { name: 'mini-erp', version: APP_VERSION },
    ...(params.demos ? { capabilities: ['demo-sessions'] } : {}),
  };
}
```

En `connector-routes.ts`:
- se borra `const CONTRACT_VERSION = '4.2.0';` y se importa
  `import { backendInfo, CONTRACT_VERSION } from '../connector/backend-info.ts';`;
- la ruta `/info` queda así:

```typescript
  router.get('/info', (_req: AuthenticatedPosRequest, res: Response) => {
    res.status(200).json(backendInfo({ status: 'ok', demos: demoSessions.enabled() }));
  });
```

Si `APP_VERSION` deja de usarse en ese archivo, se borra el import (lo marca `noUnusedLocals`).

`src/server/maintenance/maintenance-page.ts`. El logo es el de `components/ui/Logo.tsx`:

```typescript
/**
 * Página de mantenimiento (#47): autocontenida, sin el SPA (que todavía no está montado). Consulta
 * `/health` cada 5 s y recarga cuando el servidor vuelve.
 */
export const MAINTENANCE_PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>mini contax</title>
<noscript><meta http-equiv="refresh" content="15" /></noscript>
<style>
  :root { --bg: #f8fafc; --fg: #0f172a; --muted: #475569; --accent: #4f46e5; }
  @media (prefers-color-scheme: dark) { :root { --bg: #020617; --fg: #f1f5f9; --muted: #94a3b8; } }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 0 16px; }
  main { max-width: 28rem; text-align: center; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  p { color: var(--muted); margin: 0; line-height: 1.5; }
</style>
</head>
<body>
<main>
  <svg width="56" height="56" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#4f46e5" />
    <path d="M9.5 6.5h13v19l-2.17-1.5-2.16 1.5-2.17-1.5-2.17 1.5-2.16-1.5-2.17 1.5z" fill="#fff" />
    <path d="M18.3 11.7A3.3 3.3 0 1 0 18.3 16.3" fill="none" stroke="#4f46e5" stroke-width="2.2" stroke-linecap="round" />
    <path d="M12.5 20.5h7" stroke="#4f46e5" stroke-width="1.6" stroke-linecap="round" />
  </svg>
  <h1>Estamos actualizando mini contax</h1>
  <p>Vuelve sola en cuanto termine; no hace falta recargar.</p>
</main>
<script>
  setInterval(function () {
    fetch('/health', { cache: 'no-store' }).then(function (res) {
      if (res.status === 200) location.reload();
    }).catch(function () {});
  }, 5000);
</script>
</body>
</html>
`;
```

`src/server/maintenance/maintenance-app.ts`:

```typescript
import express, { type Express, type Response } from 'express';
import cors from 'cors';
import { allowPrivateNetwork } from '../middleware/private-network.ts';
import { backendInfo, MAINTENANCE_MESSAGE } from '../connector/backend-info.ts';
import { APP_VERSION } from '../app-version.ts';
import { MAINTENANCE_PAGE } from './maintenance-page.ts';

export const RETRY_AFTER_SECONDS = 30;

export type MaintenanceState = { phase: 'migrating' | 'failed'; progress?: { done: number; total: number } };

function unavailable(res: Response): Response {
  res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
  return res.status(503);
}

/**
 * Lo que atiende el servidor mientras migra (#47), sin abrir ninguna base. El POS ve `maintenance`
 * en `/info` y deja de sincronizar; el admin y el alta ven la página de actualización.
 */
export function createMaintenanceApp(params: { state: () => MaintenanceState; demos: boolean }): Express {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(allowPrivateNetwork);
  app.use(cors());

  app.get('/health', (_req, res) => {
    const state = params.state();
    res.status(503).json({
      status: state.phase === 'failed' ? 'migration-failed' : 'maintenance',
      service: 'mini-erp',
      version: APP_VERSION,
      ...(state.progress === undefined ? {} : { progress: state.progress }),
    });
  });

  // Sin validar la key: no hay base de sistema y la respuesta no dice nada de nadie. Nunca 409.
  app.get('/connector/info', (_req, res) => {
    res.status(200).json(backendInfo({ status: 'maintenance', demos: params.demos }));
  });
  app.use('/connector', (_req, res) => {
    unavailable(res).json({ code: 'maintenance', message: MAINTENANCE_MESSAGE });
  });
  app.use('/api', (_req, res) => {
    unavailable(res).json({ error: MAINTENANCE_MESSAGE, code: 'maintenance' });
  });
  app.use((_req, res) => {
    unavailable(res).type('html').send(MAINTENANCE_PAGE);
  });
  return app;
}
```

- [ ] **Paso 4: correr los tests**

Correr `pnpm vitest run test/maintenance-app.test.ts test/connector-api.test.ts test/brand.test.ts`.
Esperado: PASS, y `/info` del app real responde lo mismo que antes, sin `message`.

- [ ] **Paso 5: verificar y commitear**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/server/connector/backend-info.ts src/server/maintenance src/server/routes/connector-routes.ts test/maintenance-app.test.ts
git commit -m "feat: app de mantenimiento para el POS, el admin y el alta (#47)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar: el usuario revisa.

---

### Tarea 6: arranque en dos fases (`startServer`)

**Archivos:**
- Crear: `src/server/startup.ts`.
- Modificar: `src/server/server.ts` (entero).
- Test: `test/startup.test.ts`.

**Interfaces:**
- Consume `MigrationRunner`, `MigrationRunResult`, `restoreRun`, `createMaintenanceApp` y
  `MaintenanceState`.
- Produce:
  - `type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void`;
  - `startServer(params: { port: number; dataDir: string; demos: boolean; runner: MigrationRunner; createReadyHandler: () => Promise<RequestHandler>; log?: ((line: string) => void) | undefined; logError?: ((line: string) => void) | undefined }): Promise<StartedServer>`;
  - `type StartedServer = { server: Server; port: number; ready: Promise<'ready' | 'failed'> }`.
- `createReadyHandler` es responsable de cerrar lo que abrió si falla.

- [ ] **Paso 1: escribir el test que falla** (`test/startup.test.ts`)

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import request from 'supertest';
import { startServer, type StartedServer } from '../src/server/startup.ts';
import type { MigrationRunResult, MigrationProgress } from '../src/server/db/migrations/run-migrations.ts';
import { readVersion } from '../src/server/db/migrations/migrate.ts';

let started: StartedServer | undefined;
let root = '';
afterEach(async () => {
  if (started !== undefined) {
    await new Promise<void>((resolve) => { started?.server.close(() => { resolve(); }); });
    started = undefined;
  }
  if (root !== '') {
    rmSync(root, { recursive: true, force: true });
    root = '';
  }
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (err: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function readyApp() {
  const app = express();
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  return app;
}

const quiet = { log: () => undefined, logError: () => undefined };

describe('startServer (#47)', () => {
  it('atiende en mantenimiento mientras migra y pasa al app listo', async () => {
    const migration = deferred<MigrationRunResult>();
    let progress: ((p: MigrationProgress) => void) | undefined;
    started = await startServer({
      port: 0, dataDir: 'no-se-usa', demos: false, ...quiet,
      runner: (_dir, onProgress) => { progress = onProgress; return migration.promise; },
      createReadyHandler: () => Promise.resolve(readyApp()),
    });

    const durante = await request(started.server).get('/health');
    expect(durante.status).toBe(503);
    expect(durante.body.status).toBe('maintenance');

    progress?.({ file: 'tenants/a.sqlite', done: 1, total: 2 });
    expect((await request(started.server).get('/health')).body.progress).toEqual({ done: 1, total: 2 });

    migration.resolve({ migrated: [] });
    expect(await started.ready).toBe('ready');
    const despues = await request(started.server).get('/health');
    expect(despues.status).toBe(200);
    expect(despues.body).toEqual({ status: 'ok' });
  });

  it('si la migración falla, sigue vivo en mantenimiento con migration-failed', async () => {
    const errores: string[] = [];
    started = await startServer({
      port: 0, dataDir: 'no-se-usa', demos: false, log: () => undefined, logError: (l) => { errores.push(l); },
      runner: () => Promise.reject(new Error('tenants/b.sqlite, migración v3 columna: pedido de romper')),
      createReadyHandler: () => Promise.reject(new Error('no se tiene que llamar')),
    });
    expect(await started.ready).toBe('failed');
    const res = await request(started.server).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('migration-failed');
    expect(errores.join('\n')).toMatch(/FALLÓ.*v3 columna.*quedaron como estaban/s);
  });

  it('si el app no arranca después de migrar, restaura la corrida y queda en failed', async () => {
    root = mkdtempSync(join(tmpdir(), 'mini-erp-startup-'));
    const dataDir = join(root, 'data');
    const runDir = join(root, 'data', 'pre-migracion', '2026-10-02T14-30-00');
    mkdirSync(runDir, { recursive: true });
    const copia = new DatabaseSync(join(runDir, 'system.sqlite'));
    copia.exec('PRAGMA user_version = 4');
    copia.close();
    const migrada = new DatabaseSync(join(dataDir, 'system.sqlite'));
    migrada.exec('PRAGMA user_version = 5');
    migrada.close();

    started = await startServer({
      port: 0, dataDir, demos: false, ...quiet,
      runner: () => Promise.resolve({ runDir, migrated: [{ file: 'system.sqlite', from: 4, to: 5 }] }),
      createReadyHandler: () => Promise.reject(new Error('no arranca')),
    });
    expect(await started.ready).toBe('failed');
    const db = new DatabaseSync(join(dataDir, 'system.sqlite'));
    expect(readVersion(db)).toBe(4);
    db.close();
    expect((await request(started.server).get('/health')).body.status).toBe('migration-failed');
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/startup.test.ts`. Esperado: FAIL, porque no existe `startup.ts`.

- [ ] **Paso 3: implementar** (`src/server/startup.ts`)

```typescript
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { restoreRun, type MigrationRunResult } from './db/migrations/run-migrations.ts';
import type { MigrationRunner } from './db/migrations/worker-runner.ts';
import { createMaintenanceApp, type MaintenanceState } from './maintenance/maintenance-app.ts';

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export type StartedServer = { server: Server; port: number; ready: Promise<'ready' | 'failed'> };

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Arranque en dos fases (#47): escucha enseguida con el app de mantenimiento, migra con `runner` y
 * recién después arma el app completo. Si algo falla, el proceso sigue vivo en mantenimiento (sin un
 * bucle de reinicios) y `/health` dice `migration-failed`.
 */
export async function startServer(params: {
  port: number;
  dataDir: string;
  demos: boolean;
  runner: MigrationRunner;
  /** Arma el app completo. Si falla, cierra lo que abrió antes de tirar el error. */
  createReadyHandler: () => Promise<RequestHandler>;
  log?: ((line: string) => void) | undefined;
  logError?: ((line: string) => void) | undefined;
}): Promise<StartedServer> {
  const log = params.log ?? ((line: string) => { console.log(line); });
  const logError = params.logError ?? ((line: string) => { console.error(line); });

  let state: MaintenanceState = { phase: 'migrating' };
  let current: RequestHandler = createMaintenanceApp({ state: () => state, demos: params.demos });
  const server = createServer((req, res) => { current(req, res); });
  await new Promise<void>((resolve) => { server.listen(params.port, resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : params.port;

  const ready = (async (): Promise<'ready' | 'failed'> => {
    let result: MigrationRunResult;
    try {
      result = await params.runner(params.dataDir, (progress) => {
        state = { phase: 'migrating', progress: { done: progress.done, total: progress.total } };
        log(`[migraciones] ${progress.file} (${String(progress.done)}/${String(progress.total)})`);
      });
    } catch (err: unknown) {
      state = { phase: 'failed' };
      logError(`[migraciones] FALLÓ ${reason(err)}. Las bases quedaron como estaban.`);
      return 'failed';
    }

    try {
      current = await params.createReadyHandler();
    } catch (err: unknown) {
      state = { phase: 'failed' };
      if (result.runDir === undefined) {
        logError(`[migraciones] FALLÓ el arranque: ${reason(err)}`);
      } else {
        restoreRun(result.runDir, params.dataDir, result.migrated.map((m) => m.file));
        logError(`[migraciones] FALLÓ el arranque después de migrar: ${reason(err)}. Restauré las bases desde ${result.runDir}.`);
      }
      return 'failed';
    }

    if (result.migrated.length > 0) {
      log(`[migraciones] listo: ${String(result.migrated.length)} bases migradas (copia en ${result.runDir ?? ''})`);
    }
    return 'ready';
  })();

  return { server, port, ready };
}
```

`src/server/server.ts` entero:

```typescript
import { createApp } from './app.ts';
import { DEV_ADMIN_PASS, DEV_BRANCH, DEV_POS } from './db/dev-seed.ts';
import { setupClient } from './client-middleware.ts';
import { bootstrap, type DevInfo } from './bootstrap.ts';
import { dataDir } from './db/data-dir.ts';
import { runMigrationsInWorker } from './db/migrations/worker-runner.ts';
import { readDemoConfig } from './demo/demo-config.ts';
import { startServer } from './startup.ts';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4100;
const publicUrl = process.env['PUBLIC_URL']?.trim() ?? '';
const url = publicUrl === '' ? `http://localhost:${String(PORT)}` : publicUrl;

let devInfo: DevInfo | undefined;

// Arranque en dos fases (#47): mantenimiento mientras migra, después el app completo
const started = await startServer({
  port: PORT,
  dataDir: dataDir(),
  demos: readDemoConfig(process.env).enabled,
  runner: runMigrationsInWorker,
  createReadyHandler: async () => {
    const bundle = createApp();
    let sweeper: NodeJS.Timeout | undefined;
    try {
      // Barrido de demos (#9) y datos de desarrollo solo fuera de producción (#3)
      const booted = bootstrap({ env: process.env, bundle });
      sweeper = booted.sweeper;
      devInfo = booted.devInfo;
      await setupClient(bundle.app);
      return bundle.app;
    } catch (err: unknown) {
      clearInterval(sweeper);
      bundle.tenantManager.closeAll();
      bundle.systemDb.close();
      throw err;
    }
  },
});

console.log(`[mini-erp] escuchando en ${url}: en mantenimiento hasta terminar las migraciones`);

if ((await started.ready) === 'ready') {
  console.log(`\n==================================================`);
  console.log(`🚀 [mini-erp] Servidor iniciado en ${url}`);
  console.log(`🧪 Landing y demo:    ${url}/`);
  console.log(`🔧 Admin:             ${url}/admin`);
  console.log(`📡 Connector API POS: ${url}/connector`);
  console.log(`🔧 Admin API:         ${url}/api`);
  if (devInfo !== undefined) {
    console.log(`\n✨ Credenciales de desarrollo:`);
    console.log(`   - Admin:    ${devInfo.email} (password: ${DEV_ADMIN_PASS})`);
    console.log(`   - POS Key:  ${devInfo.rawKey}`);
    console.log(`   - Sucursal: ${DEV_BRANCH}`);
    console.log(`   - Caja:     ${DEV_POS}`);
  }
  console.log(`\n(Servidor en ejecución, presiona Ctrl+C para detener)`);
  console.log(`==================================================\n`);
}
```

> Si `bootstrap` no exporta `DevInfo` como tipo, ya lo exporta (`export type DevInfo`). Si el
> `Express` de `createApp` no encaja en `RequestHandler` para `tsc`, se envuelve:
> `return (req, res) => { bundle.app(req, res); };`. Nada de `as`.

- [ ] **Paso 4: correr los tests y el servidor de verdad**

Correr `pnpm vitest run test/startup.test.ts`. Esperado: PASS.

Después, `pnpm dev` en PowerShell. El worktree no tiene `data/`, así que crea las bases nuevas en v2
y no migra nada. Esperado en el log: `escuchando en http://localhost:4100: en mantenimiento…` y
después el banner. `curl http://localhost:4100/health` da `200`. Cortar con Ctrl+C. El camino con
migraciones de verdad se prueba en la tarea 9.

- [ ] **Paso 5: verificar (también el e2e, porque se tocó el arranque) y commitear**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm test:e2e }
git add src/server/startup.ts src/server/server.ts test/startup.test.ts
git commit -m "feat: el servidor escucha en mantenimiento y migra antes de atender (#47)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar: el usuario revisa.

---

### Tarea 7: admin y alta con el servidor en mantenimiento

**Archivos:**
- Crear: `src/client/state/maintenance-state.ts`,
  `src/client/components/maintenance/MaintenanceView.tsx`.
- Modificar:
  - `src/client/api/client.ts` (después de parsear `responseData`);
  - `src/client/state/bulk-state.ts:211-213`;
  - `src/client/state/auth-state.ts:131-135`;
  - `src/client/App.tsx` (al principio de `App()`).
- Test: `test/maintenance-client.test.ts`.

**Interfaces:**
- Produce:
  - `maintenanceSignal`;
  - `isMaintenanceResponse(status: number, data: unknown): boolean`;
  - `enterMaintenance(deps?: { fetchHealth?: (() => Promise<number>) | undefined; reload?: (() => void) | undefined; intervalMs?: number | undefined }): void`;
  - `noteMaintenanceResponse(res: Response): Promise<void>`;
  - `resetMaintenance(): void`.

- [ ] **Paso 1: escribir el test que falla** (`test/maintenance-client.test.ts`)

```typescript
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  enterMaintenance,
  isMaintenanceResponse,
  maintenanceSignal,
  noteMaintenanceResponse,
  resetMaintenance,
} from '../src/client/state/maintenance-state.ts';
import { apiFetch, ApiError } from '../src/client/api/client.ts';
import { fetchProfile, logout, tokenSignal } from '../src/client/state/auth-state.ts';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetMaintenance();
  logout();
  vi.useRealTimers();
});

describe('mantenimiento en el cliente (#47)', () => {
  it('reconoce solo el 503 de mantenimiento', () => {
    expect(isMaintenanceResponse(503, { code: 'maintenance', error: 'x' })).toBe(true);
    expect(isMaintenanceResponse(503, { error: 'otra cosa' })).toBe(false);
    expect(isMaintenanceResponse(500, { code: 'maintenance' })).toBe(false);
    expect(isMaintenanceResponse(503, 'texto')).toBe(false);
  });

  it('apiFetch prende el aviso con un 503 de mantenimiento y tira el error igual', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(503, { code: 'maintenance', error: 'actualizando' }));
    await expect(apiFetch('auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(maintenanceSignal.value).toBe(true);
  });

  it('apiFetch no prende el aviso con otro 503', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'caído' }));
    await expect(apiFetch('auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(maintenanceSignal.value).toBe(false);
  });

  it('noteMaintenanceResponse lo detecta en un fetch suelto', async () => {
    await noteMaintenanceResponse(jsonResponse(503, { code: 'maintenance', error: 'x' }));
    expect(maintenanceSignal.value).toBe(true);
  });

  it('vuelve sola: con /health 200 recarga, y no antes', async () => {
    vi.useFakeTimers();
    const estados = [503, 200];
    const fetchHealth = vi.fn(() => Promise.resolve(estados.shift() ?? 200));
    const reload = vi.fn();
    enterMaintenance({ fetchHealth, reload, intervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchHealth).toHaveBeenCalledTimes(2);
  });

  it('fetchProfile conserva la sesión con un 503 y la cierra con un 401', async () => {
    tokenSignal.value = 'token-de-prueba';
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(503, { code: 'maintenance', error: 'x' }));
    expect(await fetchProfile()).toBe(false);
    expect(tokenSignal.value).toBe('token-de-prueba');

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'sesión vencida' }));
    expect(await fetchProfile()).toBe(false);
    expect(tokenSignal.value).toBeNull();
  });
});
```

> `tokenSignal` y `logout` ya se usan así en `test/auth-client-state.test.ts`. Si `tokenSignal`
> persiste en `localStorage` y en Node no existe, el test existente ya muestra cómo se maneja.
> Seguir ese patrón.

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/maintenance-client.test.ts`. Esperado: FAIL, porque no existe
`maintenance-state.ts`.

- [ ] **Paso 3: implementar**

`src/client/state/maintenance-state.ts`:

```typescript
import { signal } from '@preact/signals';

/** El servidor está en mantenimiento (#47): `App` muestra la pantalla de actualización. */
export const maintenanceSignal = signal(false);

const POLL_MS = 5_000;
let timer: ReturnType<typeof setInterval> | undefined;

/** Un `503` con `code: 'maintenance'`: lo que responde el mini-erp mientras migra. */
export function isMaintenanceResponse(status: number, data: unknown): boolean {
  return status === 503 && typeof data === 'object' && data !== null && 'code' in data && data.code === 'maintenance';
}

/**
 * Prende el aviso y consulta `/health` cada 5 s. Cuando vuelve, recarga: la versión cambió y los
 * assets también.
 */
export function enterMaintenance(deps?: {
  fetchHealth?: (() => Promise<number>) | undefined;
  reload?: (() => void) | undefined;
  intervalMs?: number | undefined;
}): void {
  maintenanceSignal.value = true;
  if (timer !== undefined) {
    return;
  }
  const fetchHealth = deps?.fetchHealth ?? (async () => (await fetch('/health', { cache: 'no-store' })).status);
  const reload = deps?.reload ?? (() => { window.location.reload(); });
  timer = setInterval(() => {
    fetchHealth()
      .then((status) => {
        if (status === 200) {
          clearInterval(timer);
          timer = undefined;
          reload();
        }
      })
      .catch(() => {
        // Sigue sin responder: se vuelve a probar en el próximo intervalo
      });
  }, deps?.intervalMs ?? POLL_MS);
}

/** Para un `fetch` suelto (fuera de `apiFetch`): mira si la respuesta es la del mantenimiento. */
export async function noteMaintenanceResponse(res: Response): Promise<void> {
  if (res.status !== 503) {
    return;
  }
  let data: unknown;
  try {
    data = await res.clone().json();
  } catch {
    return;
  }
  if (isMaintenanceResponse(res.status, data)) {
    enterMaintenance();
  }
}

/** Solo para tests: apaga el aviso y el intervalo. */
export function resetMaintenance(): void {
  clearInterval(timer);
  timer = undefined;
  maintenanceSignal.value = false;
}
```

`src/client/api/client.ts`: importar
`import { enterMaintenance, isMaintenanceResponse } from '../state/maintenance-state.ts';` y, justo
antes de `if (!res.ok) {`, agregar:

```typescript
  // Mantenimiento (#47): la pantalla de actualización; el error sigue su camino
  if (isMaintenanceResponse(res.status, responseData)) {
    enterMaintenance();
  }
```

`src/client/state/bulk-state.ts:211-213`:

```typescript
    if (!res.ok) {
      await noteMaintenanceResponse(res);
      throw new Error(`HTTP ${String(res.status)}: ${res.statusText}`);
    }
```

con `import { noteMaintenanceResponse } from './maintenance-state.ts';`.

`src/client/state/auth-state.ts:131-135` (importar `ApiError` junto a `apiFetch`):

```typescript
  } catch (err: unknown) {
    // Solo una sesión vencida la cierra (#47): con el servidor en mantenimiento o sin red, se conserva
    if (err instanceof ApiError && err.status === 401) {
      authErrorSignal.value = err.message;
      logout();
    }
    return false;
  } finally {
```

`src/client/components/maintenance/MaintenanceView.tsx`:

```tsx
import { Logo } from '../ui/Logo.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';

/** Pantalla de actualización (#47): el servidor está migrando; vuelve sola (`maintenance-state.ts`). */
export function MaintenanceView() {
  return (
    <div class="relative min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div class="absolute top-4 right-4">
        <ThemeToggle compact />
      </div>
      <main class="max-w-md text-center space-y-3">
        <Logo class="w-14 h-14 mx-auto" />
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-100">Estamos actualizando mini contax</h1>
        <p class="text-slate-600 dark:text-slate-400">Vuelve sola en cuanto termine; no hace falta recargar.</p>
      </main>
    </div>
  );
}
```

`src/client/App.tsx`: importar `maintenanceSignal` y `MaintenanceView`, y como primera línea de
`App()`:

```tsx
  // Servidor en mantenimiento (#47): tapa todo, incluidos el landing, el alta y los links
  if (maintenanceSignal.value) {
    return <MaintenanceView />;
  }
```

- [ ] **Paso 4: correr los tests y el build**

Correr `pnpm vitest run test/maintenance-client.test.ts test/auth-client-state.test.ts test/brand.test.ts`.
Esperado: PASS. Después, `pnpm build`: compila sin errores.

- [ ] **Paso 5: verificar y commitear**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }
git add src/client test/maintenance-client.test.ts
git commit -m "feat: pantalla de actualización en el admin y el alta; fetchProfile no cierra la sesión sin un 401 (#47)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar: el usuario revisa.

---

### Tarea 8: `deploy.sh` espera la migración

**Archivos:**
- Modificar: `deploy/deploy.sh` (la función `healthy` y su uso) y `deploy/README.md` (las secciones
  "Publicar" y "Reiniciar producción", líneas 230-345).

**Interfaces:** consume `/health` (tarea 5): `200` listo, `503 maintenance` o `503 migration-failed`.

- [ ] **Paso 1: reemplazar `healthy` por `wait_ready`**

En `deploy/deploy.sh`, después de `PREVIOUS=…`:

```bash
# Tope para una migración larga (#47): pasado esto, se avisa pero no se vuelve atrás
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-900}"
```

En lugar de `healthy()`:

```bash
# Espera a que el mini-erp nuevo atienda (#47). /health responde 503 "maintenance" mientras migra y
# 503 "migration-failed" si la migración falló (las bases quedaron como estaban).
# Sale con 0 si está listo, 1 si hay que volver atrás y 2 si sigue migrando al vencer el tope.
wait_ready() {
  local body code status start now silent=0 last_log=0
  body="$(mktemp)"
  start="$(date +%s)"
  while true; do
    code="$(curl -s -o "$body" -w '%{http_code}' --max-time 5 http://localhost:4100/health || true)"
    status="$(grep -o '"status":"[^"]*"' "$body" | head -n 1 | cut -d '"' -f 4 || true)"
    now="$(date +%s)"
    case "$code:$status" in
      200:*)
        rm -f "$body"
        return 0
        ;;
      503:migration-failed)
        echo "La migración falló: $(cat "$body")" >&2
        rm -f "$body"
        return 1
        ;;
      503:maintenance)
        silent=0
        if [ $((now - start)) -ge "$MIGRATION_TIMEOUT" ]; then
          rm -f "$body"
          return 2
        fi
        if [ $((now - last_log)) -ge 30 ]; then
          echo "Migrando: $(cat "$body")"
          last_log="$now"
        fi
        ;;
      *)
        silent=$((silent + 1))
        if [ "$silent" -ge 30 ]; then
          rm -f "$body"
          return 1
        fi
        ;;
    esac
    sleep 1
  done
}
```

En lugar de `if ! healthy; then … fi`:

```bash
set +e
wait_ready
ready=$?
set -e

if [ "$ready" -eq 2 ]; then
  echo "La migración sigue corriendo después de ${MIGRATION_TIMEOUT} s. No vuelvo atrás: cortarla puede dejar bases en versiones distintas." >&2
  echo "Revisá: sudo journalctl -u mini-erp -n 100 --no-pager" >&2
  exit 1
fi

if [ "$ready" -ne 0 ]; then
  echo "La versión $SHA no quedó lista" >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    activate "$PREVIOUS"
    echo "Volví a $(basename "$PREVIOUS")" >&2
  fi
  exit 1
fi
```

Actualizar el comentario de la cabecera: "Si no queda lista (`/health`), vuelve a la versión anterior,
salvo que siga migrando (#47)".

- [ ] **Paso 2: verificar el script contra el servidor local**

En Git Bash (no PowerShell), con `pnpm dev` corriendo en otra terminal:

```bash
bash -n deploy/deploy.sh
```

```bash
source <(sed -n '/^wait_ready()/,/^}/p' deploy/deploy.sh); MIGRATION_TIMEOUT=5; wait_ready; echo "salió con $?"
```

Esperado: `salió con 0` con el servidor listo. Con el servidor apagado, `salió con 1` después de unos
30 s. El caso `maintenance` se prueba en la tarea 9, con la migración lenta.

- [ ] **Paso 3: `deploy/README.md`**

En "Publicar una versión", el punto del workflow pasa a:

> - Después corre el CI entero y sube la versión. Si la versión trae migraciones, el mini-erp atiende
>   "en mantenimiento" mientras migra (el POS sigue vendiendo y sincroniza al terminar) y el deploy
>   espera hasta 15 minutos. Si la migración falla, las bases quedan como estaban y **vuelve solo a la
>   versión anterior**; el workflow queda en rojo.

La sección "Reiniciar producción (borrar todo)" se reemplaza por "Migraciones de esquema":

````markdown
## Migraciones de esquema

Producción tiene datos que no se pueden perder: desde la 0.4.0 (#47) las bases se migran, nunca se
borran. El mini-erp, al arrancar:

1. Escucha enseguida y responde "en mantenimiento" (`/health` da `503` con `"status":"maintenance"`).
2. Copia cada base que va a migrar a `/var/lib/mini-erp/pre-migracion/<fecha-hora>/` (deja las
   últimas 3 corridas).
3. Migra la base de sistema y la de cada comercio, demos incluidas, y recién ahí atiende normal.

Para seguirlo:

```bash
sudo journalctl -u mini-erp -f
```

Se ven las líneas `[migraciones] tenants/<id>.sqlite (n/N)` y, al final, `[migraciones] listo`.

**Si una migración falla**, el log dice cuál (`[migraciones] FALLÓ …`). Las bases vuelven a estar como
antes y el mini-erp queda en mantenimiento (`"status":"migration-failed"`); el deploy vuelve solo a la
versión anterior. Hay que arreglar la migración y publicar otra versión.

**Si el deploy avisa que la migración sigue corriendo** (más de 15 minutos), no se vuelve atrás: cortar
una migración puede dejar bases en versiones distintas. Esperá a que el log diga `listo` (o `FALLÓ`).

### Volver a una versión anterior a mano

Solo si una versión ya migró y atendió, y hay que volver a la anterior. **Se pierde lo que se escribió
después de migrar** (ventas sincronizadas, cambios en el admin), porque las bases vuelven a la copia.
La versión anterior no arranca sobre una base más nueva (el log dice "es más nueva (vN) que este
código"), así que hay que restaurar la copia:

1. Mirá qué corrida restaurar (la más nueva es la de la versión que querés deshacer):

   ```bash
   sudo ls /var/lib/mini-erp/pre-migracion
   ```

2. Pará el servicio, restaurá esa corrida y borrá los `-wal` y `-shm` (de a una línea):

   ```bash
   sudo systemctl stop mini-erp
   sudo -u minierp sh -c 'cd /var/lib/mini-erp && cp -r pre-migracion/<corrida>/. . && rm -f *.sqlite-wal *.sqlite-shm tenants/*.sqlite-wal tenants/*.sqlite-shm'
   ```

3. Volvé el enlace a la versión anterior y arrancá:

   ```bash
   ls -1dt /opt/mini-erp/releases/*/
   sudo -u deploy ln -sfn /opt/mini-erp/releases/<sha-anterior> /opt/mini-erp/current
   sudo systemctl start mini-erp
   curl -s https://mini.contax.ar/health
   ```
````

Se borra el párrafo final de "Si el deploy falla con «no respondió /health» … base vieja" (líneas
341-344), que hablaba del reinicio.

- [ ] **Paso 4: commitear**

```powershell
git add deploy/deploy.sh deploy/README.md
git commit -m "build: deploy.sh espera la migración y vuelve atrás solo si falla (#47)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar: el usuario revisa.

---

### Tarea 9: AGENTS.md, versión 0.4.0 y prueba de punta a punta en local

**Archivos:**
- Modificar: `AGENTS.md` (Arquitectura), `package.json` (versión).

- [ ] **Paso 1: `AGENTS.md`**

En "Roles de comercio e invitaciones", borrar el punto
`- Esquema de sistema 4, sin migraciones: una base vieja no arranca ("borrá el directorio de datos").`

En Arquitectura, después de "DB por tenant", agregar:

```markdown
- **Migraciones de esquema** (#47, spec `docs/superpowers/specs/2026-10-02-migraciones-mantenimiento-design.md`):
  - **Ninguna etapa cambia el esquema sin una migración.** Producción tiene datos: nunca se borra ni
    se reinicia una base.
  - Por tipo de base, en `src/server/db/migrations/`: `system.ts` y `tenant.ts` tienen la línea de
    base (sistema 4, comercio 1), que **no se toca nunca más**, y la lista de migraciones;
    `PRAGMA user_version` es el puntero.
  - Una migración nueva: un archivo `migrations/<tipo>/v<N>-<nombre>.ts` con
    `{ version: N, name, up(db) }` (N = la última + 1), agregado al final de la lista. `up` no abre
    transacciones (la abre `migrateDb`, una por migración) y no depende de datos de fuera de su base.
  - Su test parte de una base de la versión anterior **con datos** (`createDbAtVersion` en
    `test/helpers/`) y verifica que sobreviven (ejemplo: `test/tenant-migration-v2.test.ts`).
  - Solo el arranque migra bases con datos (`runMigrations`, en un worker): antes copia lo que va a
    migrar a `<DATA_DIR>/pre-migracion/<fecha>/` y, si una falla, restaura las ya migradas.
    `openSystemDb` y `openTenantDb` crean bases nuevas y verifican las existentes (`checkDb`), nunca
    migran.
  - Una base anterior a la línea de base o más nueva que el código (un rollback) no arranca.
- **Arranque en dos fases** (`src/server/startup.ts`): el servidor escucha enseguida con el app de
  mantenimiento (`src/server/maintenance/`, sin bases), migra y recién ahí monta el app completo.
  - Mientras tanto, `/health` da `503 maintenance` (o `migration-failed`, y el proceso sigue vivo),
    `/connector/info` da `status: maintenance` sin key, el resto del Connector API y `/api` dan `503`
    con `Retry-After: 30`, y las páginas, la de actualización.
  - El cliente muestra `MaintenanceView` con un `503 maintenance` y recarga cuando `/health` vuelve.
  - Un 503 en `account-holds` hoy hace fallar el cobro a cuenta corriente en el POS
    (rauldiazsolis/offline-pos#187).
```

En "Deploy (#3)", en el punto de `deploy.yml`, cambiar "vuelve a la versión anterior si `/health`
no responde" por "espera la migración (hasta 15 min, `/health` en `maintenance`) y vuelve a la
versión anterior si `/health` no responde o la migración falla".

- [ ] **Paso 2: subir la versión**

```powershell
pnpm version minor --no-git-tag-version
```

Esperado: `package.json` en `0.4.0`. `test/health.test.ts` y `release-version.test.ts` la leen de
`package.json`, así que siguen en verde.

- [ ] **Paso 3: verificación completa**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }; if ($?) { pnpm test:e2e }
```

Esperado: todo en verde.

- [ ] **Paso 4: prueba local de los criterios 1 a 4**

Con una copia de la base de desarrollo: `DATA_DIR` apuntando a una carpeta del scratchpad copiada de
`data/` antes de la tarea 6, o una nueva sembrada por `pnpm dev` y llevada a comercio v1 con
`PRAGMA user_version = 1`. Hay que probar:
- **Migración lenta** (criterios 1 a 3): agregar **sin commitear** una v3 de comercio cuyo `up` espera
  20 s con un bucle ocupado. Arrancar `pnpm start`; con `curl` ver `/health 503 maintenance`, después
  `/connector/info` con `status: maintenance` y una página del admin; al terminar, `200`. Los datos
  siguen y queda una copia en `pre-migracion/`.
- **Migración que falla** (criterio 4): una v3 que tira un error. Ver `migration-failed`, que las
  bases sigan en v2 y que `wait_ready` (tarea 8, paso 2) salga con 1. Con la lenta, `wait_ready`
  muestra "Migrando: …" y sale con 0 al terminar.
- Revertir la migración de prueba (`git checkout -- src/server/db/migrations`) y verificar que
  `git status` no la muestre.

- [ ] **Paso 5: commitear**

```powershell
git add AGENTS.md package.json
git commit -m "docs: migraciones de esquema en AGENTS.md y versión 0.4.0 (#47)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar: el usuario revisa. Después, con su aprobación, el informe final con la prueba manual, el push y
el PR (merge commit, "Closes #47"). El tag `v0.4.0` va después del merge, según `deploy/README.md`.
