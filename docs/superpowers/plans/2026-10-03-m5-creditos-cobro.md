# M5 · Créditos y cobro: plan de implementación

> **Para agentes:** se ejecuta con `superpowers:executing-plans`, **tarea por tarea en esta misma
> conversación** (nunca un subagente por tarea): al terminar cada tarea se verifica, se commitea y se
> frena para que el usuario la revise. Los pasos usan casillas (`- [ ]`).

**Objetivo:** cobrar $1000 por caja y por día con ventas, con cajas ligadas a un equipo, saldo pagado
del titular, créditos regalados por comercio, deuda con gracia y restricción del admin, pagos y
planilla de cobranzas, y las pantallas Créditos, Cajas y Plataforma.

**Arquitectura:** todo el cobro vive en `system.sqlite` (migración de sistema v5). El push guarda en
cada venta su caja y a qué equipo se cobra (migración de comercio v6), y después del commit del lote
pide los cargos a `BillingService`, que es idempotente por `(caja, equipo, día)`. Un barrido concilia
lo que falte. Los avisos del pull y un middleware de restricción leen el estado de cobro.

**Stack:** Express 5 + `node:sqlite` + Hardwired + Zod 3 en el servidor; Preact + signals + Tailwind 4
en el cliente; Vitest y Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-03-m5-creditos-cobro-design.md`](../specs/2026-10-03-m5-creditos-cobro-design.md)

## Restricciones globales

- Todo en español: código nuevo, comentarios, mensajes, commits.
- TDD: el test primero, verlo fallar, lo mínimo para que pase, la suite entera.
- Antes de cada commit: `pnpm lint && pnpm typecheck && pnpm test` (desde PowerShell), más
  `pnpm build` si se tocó el cliente, más `pnpm test:e2e` en la tarea 10.
- TypeScript estricto: sin `any`, sin `as` ni `!` para callar errores, `unknown` solo en fronteras
  y validado con Zod; sin parameter properties; imports relativos con `.ts`/`.tsx`.
- Opcionales: entradas `x?: T | undefined`; en resultados propios, la propiedad se omite.
- Sin hooks de React en el cliente; estado solo con signals.
- Ninguna base se reinicia: los cambios de esquema van solo por las migraciones de la tarea 1.
- Fechas e importes nuevos del cliente con `src/client/format.ts`.
- Lo visible dice "mini contax"; `test/brand.test.ts` tiene que seguir en verde.
- Commits convencionales en español, terminados en
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, en la rama `claude/m5-creditos-cobro`.

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/server/db/migrations/system/v5-creditos-y-cobro.ts` | Cajas, titular, gracia, tablas de cobro, bono a los existentes |
| `src/server/db/migrations/tenant/v6-caja-de-venta.ts` | `sales.register_id` y `sales.charge_device` |
| `src/server/registers/register-service.ts` | Cajas: crear, rotar key, ligar equipo, pasar, desligar, desactivar, listar, estado para avisos |
| `src/shared/register-types.ts` | `RegisterItem` (servidor y cliente) |
| `src/server/billing/settings.ts` | Configuración de cobro: valores por defecto, lectura y escritura |
| `src/server/billing/allocation.ts` | Reparto puro de un cargo |
| `src/server/billing/billing-service.ts` | Cargos, estado, pagos, créditos, gracia, devoluciones, titular, consultas |
| `src/server/billing/reconcile.ts` | Barrido de cargos faltantes |
| `src/server/billing/payment-sheet.ts` | Parseo de la planilla CSV |
| `src/server/billing/money-text.ts` | `$ 12.345` y `DD/MM` para los avisos |
| `src/shared/credits-types.ts` | Tipos de la API de Créditos y Plataforma |
| `src/server/routes/register-routes.ts` | `/pos-registers` |
| `src/server/routes/credits-routes.ts` | `/credits*` y `/billing-status` |
| `src/server/routes/platform-routes.ts` | `/api/platform` |
| `src/server/middleware/platform-role-middleware.ts` | `requirePlatformRole` |
| `src/server/middleware/billing-restriction-middleware.ts` | `402 billing-restricted` |
| `src/client/state/registers-state.ts` | Cajas en el cliente |
| `src/client/state/credits-state.ts` | Créditos, franja y restricción |
| `src/client/state/platform-state.ts` | Acciones de plataforma, planilla y configuración |
| `src/client/components/settings/RegistersSection.tsx` | Solapa Cajas (reemplaza a `PosKeysSection.tsx`) |
| `src/client/components/credits/*` | `CreditsView`, `CreditsBanner`, `RestrictedView`, `PlatformActionsBar` |
| `src/client/components/platform/*` | `PlatformView`, `PaymentSheetCard`, `PlatformSettingsCard` |

---

### Tarea 1: Migraciones de sistema v5 y de comercio v6

**Archivos:**
- Crear: `src/server/db/migrations/system/v5-creditos-y-cobro.ts`
- Modificar: `src/server/db/migrations/system.ts` (lista de migraciones)
- Crear: `src/server/db/migrations/tenant/v6-caja-de-venta.ts`
- Modificar: `src/server/db/migrations/tenant.ts` (lista de migraciones)
- Modificar: `docs/superpowers/specs/2026-10-03-m5-creditos-cobro-design.md` (ajustes de abajo)
- Test: `test/system-migration-v5.test.ts`, `test/tenant-migration-v6.test.ts`

**Interfaces:**
- Produce: las tablas `registers` (con `last_seen_at`), `register_devices`, `billing_settings`,
  `paid_movements`, `gift_credits`, `gift_consumptions`, `charges`; las columnas
  `tenant_api_keys.register_id`, `tenants.holder_user_id`, `tenants.grace_until`,
  `sales.register_id`, `sales.charge_device`. Los ids de las cajas migradas son `'reg_' || <id de la key>`.

- [ ] **Paso 1: ajustar la spec.** Tres cambios que salieron al planificar:
  - las rutas de cajas son `/pos-registers`, porque `GET /registers` ya existe (M4, la lista de
    cajas de Ventas & Caja);
  - `sales.charge_device` guarda a qué equipo se cobró la venta al recibirla (`''` = la caja), así
    el barrido no confunde un equipo que después pasó a ser el ligado; `registers.last_seen_at` es la
    última vez que se vio el equipo ligado;
  - el barrido de cobro es un timer propio (`startBillingSweeper`), al lado del de demos, y la
    planilla viaja como JSON `{ csv }`.

  Editar en la spec: "Migración de comercio v6" (sumar `charge_device`), la tabla `registers` (sumar
  `last_seen_at`), "Escritura" (`DocumentOrigin` suma `registerId` y `chargeDevice`), la tabla de
  rutas (`/registers` → `/pos-registers`), "Barrido" y la planilla.

- [ ] **Paso 2: test de la migración de sistema (falla).** `test/system-migration-v5.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

const at = '2026-10-01T12:00:00.000Z';

function baseV4() {
  const db = createDbAtVersion(SYSTEM_SCHEMA, 4);
  const user = db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES (?, ?, 'h', ?, 'user', ?)");
  user.run('u-ana', 'ana@x.com', 'Ana', at);
  user.run('u-beto', 'beto@x.com', 'Beto', '2026-10-01T13:00:00.000Z');
  const tenant = db.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)");
  tenant.run('kiosco', 'kiosco', 'Kiosco', at);
  tenant.run('demo-x', 'demo-x', 'Demo', at);
  const member = db.prepare('INSERT INTO memberships (user_id, tenant_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)');
  member.run('u-beto', 'kiosco', 'owner', 'active', '2026-10-01T13:00:00.000Z');
  member.run('u-ana', 'kiosco', 'owner', 'active', at);
  db.prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)').run('demo-x', 'kiosco', at, at);
  const key = db.prepare(
    'INSERT INTO tenant_api_keys (id, tenant_id, name, key_hash, key_prefix, branch, point_of_sale, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  key.run('key_1', 'kiosco', 'Caja 1', 'hash1', 'mpos_1', 'CENTRAL', 'Caja 1', 1, at);
  key.run('key_2', 'kiosco', 'Caja vieja', 'hash2', 'mpos_2', 'CENTRAL', 'Caja 2', 0, at);
  key.run('key_d', 'demo-x', 'Demo', 'hashd', 'mpos_d', 'DEMO', 'Caja', 1, at);
  return db;
}

describe('migración de sistema v5 créditos-y-cobro (#21)', () => {
  it('cada key pasa a tener su caja, activa si la key lo está, sin equipo', () => {
    const db = baseV4();
    migrateDb(db, SYSTEM_SCHEMA);
    const regs = db.prepare('SELECT id, tenant_id, name, branch, point_of_sale, device_id, active FROM registers ORDER BY id').all();
    expect(regs).toEqual([
      { id: 'reg_key_1', tenant_id: 'kiosco', name: 'Caja 1', branch: 'CENTRAL', point_of_sale: 'Caja 1', device_id: null, active: 1 },
      { id: 'reg_key_2', tenant_id: 'kiosco', name: 'Caja vieja', branch: 'CENTRAL', point_of_sale: 'Caja 2', device_id: null, active: 0 },
      { id: 'reg_key_d', tenant_id: 'demo-x', name: 'Demo', branch: 'DEMO', point_of_sale: 'Caja', device_id: null, active: 1 },
    ]);
    const keys = db.prepare('SELECT id, register_id, key_hash FROM tenant_api_keys ORDER BY id').all();
    expect(keys).toEqual([
      { id: 'key_1', register_id: 'reg_key_1', key_hash: 'hash1' },
      { id: 'key_2', register_id: 'reg_key_2', key_hash: 'hash2' },
      { id: 'key_d', register_id: 'reg_key_d', key_hash: 'hashd' },
    ]);
  });

  it('el titular es el owner activo más antiguo; las demos quedan sin titular', () => {
    const db = baseV4();
    migrateDb(db, SYSTEM_SCHEMA);
    const rows = db.prepare('SELECT id, holder_user_id, grace_until FROM tenants ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'demo-x', holder_user_id: null, grace_until: null },
      { id: 'kiosco', holder_user_id: 'u-ana', grace_until: null },
    ]);
  });

  it('los comercios con titular reciben el bono de $50.000 a 90 días; las demos no', () => {
    const db = baseV4();
    const before = Date.now();
    migrateDb(db, SYSTEM_SCHEMA);
    const gifts = db.prepare('SELECT tenant_id, amount, origin, expires_at FROM gift_credits').all() as {
      tenant_id: string; amount: number; origin: string; expires_at: string;
    }[];
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).toMatchObject({ tenant_id: 'kiosco', amount: 50000, origin: 'signup' });
    const days = (Date.parse(gifts[0]?.expires_at ?? '') - before) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it('los datos de v4 sobreviven y las tablas de cobro nacen vacías', () => {
    const db = baseV4();
    migrateDb(db, SYSTEM_SCHEMA);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM memberships').get()).toEqual({ n: 2 });
    for (const table of ['register_devices', 'billing_settings', 'paid_movements', 'gift_consumptions', 'charges']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
  });
});
```

Antes de escribirlo, confirmar en `src/server/db/migrations/migrate.ts` el nombre exacto de la
función que migra una base (`migrateDb`) y ajustar el import si difiere.

- [ ] **Paso 3: correrlo.** `pnpm vitest run test/system-migration-v5.test.ts` → FALLA (no hay
  tabla `registers`).

- [ ] **Paso 4: la migración.** `src/server/db/migrations/system/v5-creditos-y-cobro.ts`:

```typescript
import type { Migration } from '../types.ts';

/**
 * Créditos y cobro (#21): la caja como entidad (con su equipo ligado y sus keys), el titular y la
 * gracia del comercio, y las tablas de cobro. Cada key existente genera su caja. Los comercios con
 * titular reciben el bono de alta ($50.000 a 90 días): los valores quedan fijos acá, aunque la
 * configuración cambie después.
 */
export const v5CreditosYCobro: Migration = {
  version: 5,
  name: 'creditos-y-cobro',
  up: (db) => {
    db.exec(`
CREATE TABLE registers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  point_of_sale TEXT NOT NULL,
  device_id TEXT,
  bound_at TEXT,
  last_seen_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_registers_tenant ON registers (tenant_id);

ALTER TABLE tenant_api_keys ADD COLUMN register_id TEXT;
INSERT INTO registers (id, tenant_id, name, branch, point_of_sale, active, created_at)
  SELECT 'reg_' || id, tenant_id, name, branch, point_of_sale, active, created_at FROM tenant_api_keys;
UPDATE tenant_api_keys SET register_id = 'reg_' || id;

CREATE TABLE register_devices (
  register_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (register_id, device_id),
  FOREIGN KEY (register_id) REFERENCES registers(id) ON DELETE CASCADE
);

ALTER TABLE tenants ADD COLUMN holder_user_id TEXT;
ALTER TABLE tenants ADD COLUMN grace_until TEXT;
UPDATE tenants SET holder_user_id = (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = tenants.id AND m.role = 'owner' AND m.status = 'active'
  ORDER BY m.created_at, m.user_id LIMIT 1
) WHERE id NOT IN (SELECT tenant_id FROM demo_sessions);

CREATE TABLE billing_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE paid_movements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'payment', 'charge', 'debt-settlement', 'refund'
  amount REAL NOT NULL,
  tenant_id TEXT,
  charge_id TEXT,
  payment_ref TEXT,
  day TEXT NOT NULL,
  info TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_paid_movements_user ON paid_movements (user_id, created_at);
CREATE INDEX idx_paid_movements_tenant ON paid_movements (tenant_id, created_at);
CREATE UNIQUE INDEX idx_paid_movements_ref ON paid_movements (payment_ref) WHERE payment_ref IS NOT NULL;

CREATE TABLE gift_credits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  amount REAL NOT NULL,
  expires_at TEXT NOT NULL,
  origin TEXT NOT NULL, -- 'signup', 'grant'
  granted_by TEXT,
  reason TEXT,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_gift_credits_tenant ON gift_credits (tenant_id, expires_at);

CREATE TABLE gift_consumptions (
  charge_id TEXT NOT NULL,
  credit_id TEXT NOT NULL,
  amount REAL NOT NULL,
  PRIMARY KEY (charge_id, credit_id)
);
CREATE INDEX idx_gift_consumptions_credit ON gift_consumptions (credit_id);

CREATE TABLE charges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  device_id TEXT NOT NULL, -- '' = el cargo de la caja; si no, el equipo ajeno
  day TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_amount REAL NOT NULL,
  gift_amount REAL NOT NULL,
  debt_amount REAL NOT NULL,
  debt_settled_at TEXT,
  rule TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (register_id, device_id, day)
);
CREATE INDEX idx_charges_tenant_day ON charges (tenant_id, day);

INSERT INTO gift_credits (id, tenant_id, amount, expires_at, origin, reason, created_at)
  SELECT 'gift_' || lower(hex(randomblob(16))), id, 50000,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days'), 'signup', 'Bono de alta',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM tenants WHERE holder_user_id IS NOT NULL;
`);
  },
};
```

En `src/server/db/migrations/system.ts`: `import { v5CreditosYCobro } from './system/v5-creditos-y-cobro.ts';`
y `migrations: [v5CreditosYCobro]`.

- [ ] **Paso 5: correrlo.** `pnpm vitest run test/system-migration-v5.test.ts` → PASA.

- [ ] **Paso 6: test de la migración de comercio (falla).** `test/tenant-migration-v6.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

describe('migración de comercio v6 caja-de-venta (#21)', () => {
  it('suma register_id y charge_device nulos y las ventas sobreviven', () => {
    const db = createDbAtVersion(TENANT_SCHEMA, 5);
    db.prepare(
      `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at, day)
       VALUES ('s1', '{"id":"s1","total":100}', 'dev-1', 'CENTRAL', 'Caja 1', 100, NULL, '2026-10-01T12:00:00.000Z', '2026-10-01')`,
    ).run();
    migrateDb(db, TENANT_SCHEMA);
    expect(db.prepare('SELECT id, total, day, register_id, charge_device FROM sales').all()).toEqual([
      { id: 's1', total: 100, day: '2026-10-01', register_id: null, charge_device: null },
    ]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
  });
});
```

Confirmar las columnas obligatorias de `sales` en la línea de base de `tenant.ts` y completar el
INSERT si falta alguna `NOT NULL`.

- [ ] **Paso 7: correrlo** → FALLA. **La migración** `src/server/db/migrations/tenant/v6-caja-de-venta.ts`:

```typescript
import type { Migration } from '../types.ts';

/**
 * Caja de cada venta (#21): la caja de la key que la empujó y a qué equipo se cobró (`''` = la caja,
 * si no el equipo ajeno). Las ventas anteriores quedan en NULL y nunca se cobran.
 */
export const v6CajaDeVenta: Migration = {
  version: 6,
  name: 'caja-de-venta',
  up: (db) => {
    db.exec(`
ALTER TABLE sales ADD COLUMN register_id TEXT;
ALTER TABLE sales ADD COLUMN charge_device TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_register_day ON sales (register_id, charge_device, day);
`);
  },
};
```

Sumarla al final de la lista de `tenant.ts`.

- [ ] **Paso 8: suite completa.** `pnpm lint && pnpm typecheck && pnpm test` → todo en verde. Si
  algún test fija la versión actual de una base, se ajusta a la nueva (los que usan
  `SYSTEM_SCHEMA_VERSION`/`TENANT_SCHEMA_VERSION` siguen solos).

- [ ] **Paso 9: commit.**

```bash
git add src/server/db/migrations test/system-migration-v5.test.ts test/tenant-migration-v6.test.ts docs/superpowers/specs/2026-10-03-m5-creditos-cobro-design.md
git commit -m "feat: migraciones de sistema v5 y de comercio v6 para créditos y cobro (#21)"
```

---

### Tarea 2: Cajas con equipo ligado

**Archivos:**
- Crear: `src/shared/register-types.ts`, `src/server/registers/register-service.ts`,
  `src/server/routes/register-routes.ts`
- Modificar: `src/server/tenant/api-key-service.ts`, `src/server/db/tenant-manager.ts`
  (`deleteTenant`), `src/server/di/container.ts`, `src/server/app.ts`,
  `src/server/routes/connector-routes.ts`, `src/server/connector/connector-service.ts`,
  `src/server/sales/records.ts`, `src/server/audit/audit-log.ts`
- Test: `test/registers.test.ts`, `test/registers-api.test.ts`, `test/permissions-api.test.ts`,
  `test/sales-records.test.ts`

**Interfaces:**
- Consume: las tablas de la tarea 1.
- Produce:
  - `ValidatedPosKey` suma `registerId: string`.
  - `ApiKeyService.createApiKey(params)` crea **caja y key** y devuelve
    `{ id: string; registerId: string; rawKey: string; keyPrefix: string }` (`id` sigue siendo el de
    la key, para no romper `/api-keys` hasta la tarea 7).
  - `RegisterService`:
    - `seen(registerId: string, deviceId: string): 'bound' | 'foreign'`
    - `create(p: { tenantId: string; name: string; branch: string; pointOfSale: string }): { id: string; rawKey: string; keyPrefix: string }`
    - `rotateKey(tenantId: string, registerId: string): { rawKey: string; keyPrefix: string }`
    - `transferTo(tenantId: string, registerId: string, deviceId: string): void`
    - `unbind(tenantId: string, registerId: string): void`
    - `deactivate(tenantId: string, registerId: string): void`
    - `list(tenantId: string): RegisterItem[]`
    - `noticeState(registerId: string, deviceId: string): RegisterNoticeState`
  - `DocumentOrigin` suma `registerId: string | null; chargeDevice: string | null`.
  - `PushLotResult` suma `saleDays: string[]` (días de ventas no anulación aplicadas en el lote).
  - `createConnectorRoutes(requirePosAuth, demoSessions, demoLimit, deps: ConnectorDeps)` con
    `ConnectorDeps = { registers: RegisterService }` (la tarea 3 suma `billing`).

- [ ] **Paso 1: tipos compartidos.** `src/shared/register-types.ts`:

```typescript
/** Una caja del POS (#21): sucursal + punto de venta, con su equipo ligado y su key activa. */
export type RegisterDevice = { deviceId: string; firstSeenAt: string; lastSeenAt: string };

export type RegisterItem = {
  id: string;
  name: string;
  branch: string;
  pointOfSale: string;
  active: boolean;
  deviceId: string | null;
  boundAt: string | null;
  lastSeenAt: string | null;
  keyPrefix: string | null;
  createdAt: string;
  /** Equipos que usaron la key después de ligarse la caja, sin el ligado. */
  otherDevices: RegisterDevice[];
};

/** Lo que los avisos del pull necesitan de la caja de una terminal. */
export type RegisterNoticeState = {
  registerId: string;
  binding: 'bound' | 'foreign';
  /** Para el equipo ligado: si otro usó la key en los últimos 7 días. */
  sharedRecently: boolean;
};
```

- [ ] **Paso 2: test del servicio (falla).** `test/registers.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { RegisterService } from '../src/server/registers/register-service.ts';

describe('cajas con equipo ligado (#21)', () => {
  let db: DatabaseSync;
  let now: Date;
  let registers: RegisterService;
  let keys: ApiKeyService;

  beforeEach(() => {
    db = openSystemDb(':memory:');
    db.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES ('t1', 't1', 'T1', '2026-10-01T00:00:00.000Z')").run();
    now = new Date('2026-10-03T12:00:00.000Z');
    keys = new ApiKeyService(db);
    registers = new RegisterService(db, () => now);
  });

  it('crear una caja genera su key, que valida con la caja', () => {
    const created = registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    expect(keys.validateApiKey(created.rawKey)).toEqual({ tenantId: 't1', branch: 'CENTRAL', pointOfSale: 'Caja 1', registerId: created.id });
  });

  it('createApiKey (alta, demos) también crea la caja', () => {
    const key = keys.createApiKey({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    expect(keys.validateApiKey(key.rawKey)?.registerId).toBe(key.registerId);
    expect(registers.list('t1').map((r) => r.id)).toEqual([key.registerId]);
  });

  it('el primer equipo se liga; otro queda como ajeno', () => {
    const { id } = registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    expect(registers.seen(id, 'dev-a')).toBe('bound');
    expect(registers.seen(id, 'dev-a')).toBe('bound');
    expect(registers.seen(id, 'dev-b')).toBe('foreign');
    expect(registers.seen(id, '')).toBe('bound');
    const [caja] = registers.list('t1');
    expect(caja?.deviceId).toBe('dev-a');
    expect(caja?.otherDevices.map((d) => d.deviceId)).toEqual(['dev-b']);
  });

  it('rotar la key mantiene la caja y su equipo; la vieja deja de validar', () => {
    const created = registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    registers.seen(created.id, 'dev-a');
    const rotated = registers.rotateKey('t1', created.id);
    expect(keys.validateApiKey(created.rawKey)).toBeUndefined();
    expect(keys.validateApiKey(rotated.rawKey)?.registerId).toBe(created.id);
    expect(registers.list('t1')[0]?.deviceId).toBe('dev-a');
  });

  it('pasar la caja liga al otro equipo y el anterior deja de avisar como compartido', () => {
    const { id } = registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    registers.seen(id, 'dev-a');
    registers.seen(id, 'dev-b');
    expect(registers.noticeState(id, 'dev-a')).toEqual({ registerId: id, binding: 'bound', sharedRecently: true });
    now = new Date('2026-10-03T13:00:00.000Z');
    registers.transferTo('t1', id, 'dev-b');
    expect(registers.list('t1')[0]?.deviceId).toBe('dev-b');
    expect(registers.noticeState(id, 'dev-b')).toEqual({ registerId: id, binding: 'bound', sharedRecently: false });
    expect(registers.noticeState(id, 'dev-a').binding).toBe('foreign');
  });

  it('pasar la caja a un equipo que nunca la usó da 400', () => {
    const { id } = registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    expect(() => registers.transferTo('t1', id, 'dev-x')).toThrow('Ese equipo no usó esta caja');
  });

  it('el aviso de key compartida se va a los 7 días sin ver al otro equipo', () => {
    const { id } = registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    registers.seen(id, 'dev-a');
    registers.seen(id, 'dev-b');
    now = new Date('2026-10-10T12:00:01.000Z');
    expect(registers.noticeState(id, 'dev-a').sharedRecently).toBe(false);
  });

  it('desligar deja la caja libre; desactivar revoca sus keys', () => {
    const created = registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    registers.seen(created.id, 'dev-a');
    registers.unbind('t1', created.id);
    expect(registers.seen(created.id, 'dev-b')).toBe('bound');
    registers.deactivate('t1', created.id);
    expect(keys.validateApiKey(created.rawKey)).toBeUndefined();
    expect(registers.list('t1')[0]?.active).toBe(false);
  });

  it('una caja de otro comercio da 404', () => {
    const { id } = registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    expect(() => registers.unbind('otro', id)).toThrow('Caja no encontrada');
  });
});
```

- [ ] **Paso 3: correrlo** → FALLA (no existe `RegisterService`).

- [ ] **Paso 4: `ApiKeyService`.** En `src/server/tenant/api-key-service.ts`:
  - `ValidatedPosKey` suma `registerId: string`.
  - Un método nuevo `insertKey(tenantId, registerId, name, branch, pointOfSale): { id; rawKey; keyPrefix }`
    con el INSERT de hoy más `register_id`.
  - `createApiKey` crea la caja y llama a `insertKey`:

```typescript
  createApiKey(params: { tenantId: string; name: string; branch: string; pointOfSale: string }): {
    id: string;
    registerId: string;
    rawKey: string;
    keyPrefix: string;
  } {
    const registerId = `reg_${randomUUID()}`;
    this.systemDb
      .prepare(
        'INSERT INTO registers (id, tenant_id, name, branch, point_of_sale, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
      )
      .run(registerId, params.tenantId, params.name.trim(), params.branch.trim(), params.pointOfSale.trim(), new Date().toISOString());
    const key = this.insertKey(params.tenantId, registerId, params.name, params.branch, params.pointOfSale);
    return { ...key, registerId };
  }
```

  - `validateApiKey` lee la caja (activa) por join:

```typescript
    const row = this.systemDb
      .prepare(
        `SELECT k.tenant_id, r.branch, r.point_of_sale, r.id AS register_id
         FROM tenant_api_keys k JOIN registers r ON r.id = k.register_id
         WHERE k.key_hash = ? AND k.active = 1 AND r.active = 1`,
      )
      .get(keyHash) as { tenant_id: string; branch: string; point_of_sale: string; register_id: string } | undefined;
    if (row === undefined) return undefined;
    return { tenantId: row.tenant_id, branch: row.branch, pointOfSale: row.point_of_sale, registerId: row.register_id };
```

- [ ] **Paso 5: `RegisterService`.** `src/server/registers/register-service.ts`:

```typescript
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../errors.ts';
import { ApiKeyService } from '../tenant/api-key-service.ts';
import type { RegisterItem, RegisterNoticeState } from '../../shared/register-types.ts';

const SHARED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type RegisterRow = {
  id: string; name: string; branch: string; point_of_sale: string; active: number;
  device_id: string | null; bound_at: string | null; last_seen_at: string | null; created_at: string;
};

/**
 * Cajas del POS (#21): sucursal + punto de venta con un solo equipo ligado. La key es de la caja:
 * rotarla no cambia la caja ni su equipo. Otro equipo con la misma key queda como ajeno.
 */
export class RegisterService {
  private db: DatabaseSync;
  private now: () => Date;
  private keys: ApiKeyService;

  constructor(db: DatabaseSync, now: () => Date) {
    this.db = db;
    this.now = now;
    this.keys = new ApiKeyService(db);
  }

  create(p: { tenantId: string; name: string; branch: string; pointOfSale: string }): { id: string; rawKey: string; keyPrefix: string } {
    const created = this.keys.createApiKey(p);
    return { id: created.registerId, rawKey: created.rawKey, keyPrefix: created.keyPrefix };
  }

  seen(registerId: string, deviceId: string): 'bound' | 'foreign' {
    if (deviceId === '') return 'bound';
    const at = this.now().toISOString();
    const row = this.db.prepare('SELECT device_id FROM registers WHERE id = ?').get(registerId) as { device_id: string | null } | undefined;
    if (row === undefined) return 'bound';
    if (row.device_id === null || row.device_id === deviceId) {
      this.db
        .prepare('UPDATE registers SET device_id = ?, bound_at = COALESCE(bound_at, ?), last_seen_at = ? WHERE id = ?')
        .run(deviceId, at, at, registerId);
      return 'bound';
    }
    this.db
      .prepare(
        `INSERT INTO register_devices (register_id, device_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(register_id, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      )
      .run(registerId, deviceId, at, at);
    return 'foreign';
  }

  rotateKey(tenantId: string, registerId: string): { rawKey: string; keyPrefix: string } {
    const reg = this.get(tenantId, registerId);
    this.db.prepare('UPDATE tenant_api_keys SET active = 0 WHERE register_id = ?').run(registerId);
    const key = this.keys.insertKey(tenantId, registerId, reg.name, reg.branch, reg.point_of_sale);
    return { rawKey: key.rawKey, keyPrefix: key.keyPrefix };
  }

  transferTo(tenantId: string, registerId: string, deviceId: string): void {
    const reg = this.get(tenantId, registerId);
    const other = this.db
      .prepare('SELECT 1 FROM register_devices WHERE register_id = ? AND device_id = ?')
      .get(registerId, deviceId);
    if (other === undefined) throw new DomainError(400, 'Ese equipo no usó esta caja');
    const at = this.now().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM register_devices WHERE register_id = ? AND device_id = ?').run(registerId, deviceId);
      if (reg.device_id !== null) {
        const last = reg.last_seen_at ?? reg.bound_at ?? at;
        this.db
          .prepare(
            `INSERT INTO register_devices (register_id, device_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(register_id, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
          )
          .run(registerId, reg.device_id, reg.bound_at ?? last, last);
      }
      this.db.prepare('UPDATE registers SET device_id = ?, bound_at = ?, last_seen_at = NULL WHERE id = ?').run(deviceId, at, registerId);
      this.db.exec('COMMIT');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  unbind(tenantId: string, registerId: string): void {
    this.get(tenantId, registerId);
    this.db.prepare('UPDATE registers SET device_id = NULL, bound_at = NULL, last_seen_at = NULL WHERE id = ?').run(registerId);
    this.db.prepare('DELETE FROM register_devices WHERE register_id = ?').run(registerId);
  }

  deactivate(tenantId: string, registerId: string): void {
    this.get(tenantId, registerId);
    this.db.prepare('UPDATE registers SET active = 0 WHERE id = ?').run(registerId);
    this.db.prepare('UPDATE tenant_api_keys SET active = 0 WHERE register_id = ?').run(registerId);
  }

  list(tenantId: string): RegisterItem[] {
    const rows = this.db
      .prepare('SELECT * FROM registers WHERE tenant_id = ? ORDER BY active DESC, created_at')
      .all(tenantId) as RegisterRow[];
    const prefix = this.db.prepare('SELECT key_prefix FROM tenant_api_keys WHERE register_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1');
    const devices = this.db.prepare(
      `SELECT device_id, first_seen_at, last_seen_at FROM register_devices
       WHERE register_id = ? AND (? IS NULL OR last_seen_at >= ?) ORDER BY last_seen_at DESC`,
    );
    return rows.map((r): RegisterItem => {
      const key = prefix.get(r.id) as { key_prefix: string } | undefined;
      const others = devices.all(r.id, r.bound_at, r.bound_at) as { device_id: string; first_seen_at: string; last_seen_at: string }[];
      return {
        id: r.id,
        name: r.name,
        branch: r.branch,
        pointOfSale: r.point_of_sale,
        active: r.active === 1,
        deviceId: r.device_id,
        boundAt: r.bound_at,
        lastSeenAt: r.last_seen_at,
        keyPrefix: key?.key_prefix ?? null,
        createdAt: r.created_at,
        otherDevices: others.map((d) => ({ deviceId: d.device_id, firstSeenAt: d.first_seen_at, lastSeenAt: d.last_seen_at })),
      };
    });
  }

  noticeState(registerId: string, deviceId: string): RegisterNoticeState {
    const reg = this.db.prepare('SELECT device_id, bound_at FROM registers WHERE id = ?').get(registerId) as
      | { device_id: string | null; bound_at: string | null }
      | undefined;
    if (reg === undefined || reg.device_id === null || deviceId === '' || reg.device_id !== deviceId) {
      const foreign = reg !== undefined && reg.device_id !== null && deviceId !== '' && reg.device_id !== deviceId;
      return { registerId, binding: foreign ? 'foreign' : 'bound', sharedRecently: false };
    }
    const since = new Date(this.now().getTime() - SHARED_WINDOW_MS).toISOString();
    const shared = this.db
      .prepare('SELECT 1 FROM register_devices WHERE register_id = ? AND last_seen_at > ? AND last_seen_at >= ? LIMIT 1')
      .get(registerId, since, reg.bound_at ?? '');
    return { registerId, binding: 'bound', sharedRecently: shared !== undefined };
  }

  private get(tenantId: string, registerId: string): RegisterRow {
    const row = this.db.prepare('SELECT * FROM registers WHERE id = ? AND tenant_id = ?').get(registerId, tenantId) as RegisterRow | undefined;
    if (row === undefined) throw new DomainError(404, 'Caja no encontrada');
    return row;
  }
}
```

  (`randomUUID` no hace falta en este archivo: el id de la caja lo genera `ApiKeyService.createApiKey`.)

- [ ] **Paso 6: correr el test** → PASA.

- [ ] **Paso 7: borrar cajas con el comercio.** En `TenantManager.deleteTenant`, dentro de la
  transacción y antes de borrar `tenant_api_keys`:

```typescript
      this.systemDb.prepare('DELETE FROM register_devices WHERE register_id IN (SELECT id FROM registers WHERE tenant_id = ?)').run(id);
      this.systemDb.prepare('DELETE FROM registers WHERE tenant_id = ?').run(id);
```

  Sumar al test de `test/demo-session-service.test.ts` que borra una demo vencida un `expect` de que
  no quedan filas en `registers` para ese tenant.

- [ ] **Paso 8: caja en las ventas (test que falla).** En `test/sales-records.test.ts`, un caso nuevo:

```typescript
  it('el push guarda la caja de la key y a qué equipo se cobra (#21)', async () => {
    // usa el app, la key y el push del archivo; dos lotes: uno del equipo dev-1 y otro de dev-2
    await pushWith('l-a', 'dev-1', [venta('ev-a', 'va', '2026-10-01T13:00:00.000Z')]);
    await pushWith('l-b', 'dev-2', [venta('ev-b', 'vb', '2026-10-01T14:00:00.000Z')]);
    const rows = tenantDb.prepare('SELECT id, register_id, charge_device FROM sales ORDER BY id').all() as {
      id: string; register_id: string | null; charge_device: string | null;
    }[];
    expect(rows[0]).toMatchObject({ id: 'va', charge_device: '' });
    expect(rows[0]?.register_id).toMatch(/^reg_/);
    expect(rows[1]).toMatchObject({ id: 'vb', charge_device: 'dev-2', register_id: rows[0]?.register_id });
  });
```

  Adaptar a los helpers que ya tiene el archivo (si el push usa siempre `dev-1`, agregar un helper
  `pushWith(lotId, deviceId, events)` y una fábrica `venta(eventId, saleId, createdAt)` con
  `origin`, `sale.payments` y `sale.total`). Correrlo → FALLA.

- [ ] **Paso 9: `records.ts` y `ConnectorService`.**
  - `DocumentOrigin` suma `registerId: string | null; chargeDevice: string | null`.
  - `saveSale` inserta `register_id` y `charge_device`; en el `ON CONFLICT` suma
    `register_id = COALESCE(sales.register_id, excluded.register_id), charge_device = COALESCE(sales.charge_device, excluded.charge_device)`;
    devuelve el día calculado (`string | null`).
  - La cobranza del admin y la semilla pasan `registerId: null, chargeDevice: null`.
  - `processPushLot` recibe `registerId?: string | undefined` y `chargeDevice?: string | undefined`
    y los pasa a `applyEvent` en el `where`.
  - `applyEvent` devuelve `{ issue?: LotIssue; saleDay?: string }`: en `sale`, si no es anulación y
    `saveSale` devolvió un día, `saleDay` es ese día. `processPushLot` junta los `saleDay` **solo de
    los eventos cuyo SAVEPOINT se liberó** y devuelve `saleDays` ordenados y sin repetir (`[]` en
    la respuesta idempotente de un lote ya procesado).

- [ ] **Paso 10: rutas del Connector.** En `connector-routes.ts`:
  - `createConnectorRoutes(requirePosAuth, demoSessions, demoLimit, deps: ConnectorDeps)`, con
    `export type ConnectorDeps = { registers: RegisterService }`.
  - Push: antes de `processPushLot`,
    `const binding = deps.registers.seen(registerId, parseResult.data.deviceId);` y se pasan
    `registerId` y `chargeDevice: binding === 'foreign' ? parseResult.data.deviceId : ''`.
  - Pull: si viene `deviceId`, `deps.registers.seen(registerId, deviceId)`.
  - `app.ts`: `registerServiceDef` en el contenedor
    (`fn.singleton((c) => new RegisterService(c.use(systemDbDef), c.use(clockDef)))`) y se pasa en
    `createConnectorRoutes(requirePos, demoSessions, demoLimit, { registers })`.

- [ ] **Paso 11: correr** `pnpm vitest run test/sales-records.test.ts test/registers.test.ts` → PASA.

- [ ] **Paso 12: rutas `/pos-registers` (test que falla).** `test/registers-api.test.ts`, con el
  armado de `test/permissions-api.test.ts` (owner, admin y member):

```typescript
  it('el owner crea una caja, ve el equipo y el otro equipo, y se la pasa', async () => {
    const auth = { Authorization: `Bearer ${tokens.owner}` };
    const created = await request(app).post(`/api/tenants/${tenantId}/pos-registers`).set(auth)
      .send({ name: 'Caja 2', branch: 'CENTRAL', pointOfSale: 'Caja 2' });
    expect(created.status).toBe(201);
    const body = created.body as { id: string; rawKey: string; key: string; keyPrefix: string };
    expect(body.key).toBe(body.rawKey);
    await pull(body.rawKey, 'dev-a');
    await pull(body.rawKey, 'dev-b');
    const list = await request(app).get(`/api/tenants/${tenantId}/pos-registers`).set(auth);
    const caja = (list.body as RegisterItem[]).find((r) => r.id === body.id);
    expect(caja?.deviceId).toBe('dev-a');
    expect(caja?.otherDevices.map((d) => d.deviceId)).toEqual(['dev-b']);
    const moved = await request(app).post(`/api/tenants/${tenantId}/pos-registers/${body.id}/transfer`).set(auth).send({ deviceId: 'dev-b' });
    expect(moved.status).toBe(200);
    const rotated = await request(app).post(`/api/tenants/${tenantId}/pos-registers/${body.id}/rotate-key`).set(auth);
    expect((rotated.body as { rawKey: string }).rawKey).toMatch(/.+/);
    expect((await request(app).post(`/api/tenants/${tenantId}/pos-registers/${body.id}/unbind`).set(auth)).status).toBe(200);
    expect((await request(app).delete(`/api/tenants/${tenantId}/pos-registers/${body.id}`).set(auth)).status).toBe(200);
  });

  it('cada acción queda en la auditoría', async () => {
    // tras crear, rotar, pasar, desligar y desactivar: acciones register.* en audit_log del comercio
  });

  it('el member recibe 403', async () => {
    const auth = { Authorization: `Bearer ${tokens.member}` };
    expect((await request(app).get(`/api/tenants/${tenantId}/pos-registers`).set(auth)).status).toBe(403);
  });
```

  El caso de auditoría se escribe completo: repetir las cinco llamadas y verificar con
  `systemDb.prepare("SELECT action FROM audit_log WHERE tenant_id = ? AND action LIKE 'register.%' ORDER BY at").all(tenantId)`
  que salen `register.created`, `register.key_rotated`, `register.transferred`, `register.unbound` y
  `register.deactivated`. `pull(key, deviceId)` es un `POST /connector/sync/pull` con
  `{ deviceId, cursors: {}, pendingLotIds: [] }`.

  En `test/permissions-api.test.ts`, sumar a `RUTAS`:

```typescript
  'GET /pos-registers': 'settings.manage',
  'POST /pos-registers': 'settings.manage',
  'POST /pos-registers/:registerId/rotate-key': 'settings.manage',
  'POST /pos-registers/:registerId/transfer': 'settings.manage',
  'POST /pos-registers/:registerId/unbind': 'settings.manage',
  'DELETE /pos-registers/:registerId': 'settings.manage',
```

  Correr → FALLA.

- [ ] **Paso 13: las rutas.** `AuditAction` suma `'register.created' | 'register.key_rotated' |
  'register.transferred' | 'register.unbound' | 'register.deactivated'`.
  `src/server/routes/register-routes.ts`:

```typescript
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import type { RegisterService } from '../registers/register-service.ts';
import type { AuditLog, AuditAction } from '../audit/audit-log.ts';
import { sendError } from '../errors.ts';

const createSchema = z.object({
  name: z.string().trim().min(2, 'Nombre de la caja requerido'),
  branch: z.string().trim().min(1, 'Sucursal requerida'),
  pointOfSale: z.string().trim().min(1, 'Punto de venta requerido'),
});
const transferSchema = z.object({ deviceId: z.string().min(1, 'Equipo requerido') });

/** Cajas del POS (#21): owner y admin. Reemplaza a /api-keys (que se va en la tarea 7). */
export function createRegisterRoutes(registers: RegisterService, audit: AuditLog): Router {
  const router = Router({ mergeParams: true });
  const manage = requirePermission('settings.manage');

  const record = (req: AuthenticatedAdminRequest, action: AuditAction, registerId: string, extra?: Record<string, unknown>): void => {
    audit.record({ actorUserId: req.user?.id ?? '', tenantId: req.activeTenantId ?? null, action, details: { registerId, ...extra } });
  };

  router.get('/pos-registers', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(registers.list(req.activeTenantId ?? ''));
  });

  router.post('/pos-registers', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    const created = registers.create({ tenantId: req.activeTenantId ?? '', ...parsed.data });
    record(req, 'register.created', created.id, { name: parsed.data.name });
    res.status(201).json({ ...created, key: created.rawKey });
  });

  router.post('/pos-registers/:registerId/rotate-key', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const registerId = req.params['registerId'] ?? '';
      const key = registers.rotateKey(req.activeTenantId ?? '', registerId);
      record(req, 'register.key_rotated', registerId);
      res.status(200).json({ ...key, key: key.rawKey });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/pos-registers/:registerId/transfer', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      const registerId = req.params['registerId'] ?? '';
      registers.transferTo(req.activeTenantId ?? '', registerId, parsed.data.deviceId);
      record(req, 'register.transferred', registerId, { deviceId: parsed.data.deviceId });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/pos-registers/:registerId/unbind', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const registerId = req.params['registerId'] ?? '';
      registers.unbind(req.activeTenantId ?? '', registerId);
      record(req, 'register.unbound', registerId);
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.delete('/pos-registers/:registerId', manage, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const registerId = req.params['registerId'] ?? '';
      registers.deactivate(req.activeTenantId ?? '', registerId);
      record(req, 'register.deactivated', registerId);
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
```

  Montarla en `app.ts` en la cadena de `/api/tenants/:tenantId`, después de `createSalesRoutes()`:
  `createRegisterRoutes(registers, auditLog)`.

- [ ] **Paso 14: suite completa.** `pnpm lint && pnpm typecheck && pnpm test` → verde. `test/notices.test.ts`
  sigue igual en esta tarea (los avisos de caja llegan en la 6).

- [ ] **Paso 15: commit.**

```bash
git add src test
git commit -m "feat: cajas con equipo ligado, key rotable y caja en cada venta (#21)"
```

---

### Tarea 3: `BillingService`: reparto, cargos, estado y barrido

**Archivos:**
- Crear: `src/server/billing/settings.ts`, `src/server/billing/allocation.ts`,
  `src/server/billing/billing-service.ts`, `src/server/billing/reconcile.ts`
- Modificar: `src/server/db/tenant-manager.ts` (titular en `createTenant`), `src/server/di/container.ts`,
  `src/server/app.ts`, `src/server/routes/connector-routes.ts`, `src/server/bootstrap.ts`
- Test: `test/billing-allocation.test.ts`, `test/billing-charges.test.ts`, `test/billing-push.test.ts`

**Interfaces:**
- Consume: `charges`, `gift_credits`, `gift_consumptions`, `paid_movements`, `tenants.holder_user_id`,
  `tenants.grace_until`, `sales.register_id`/`charge_device` y `PushLotResult.saleDays`.
- Produce:
  - `BillingSettings`, `DEFAULT_BILLING_SETTINGS`, `readBillingSettings(db)`, `writeBillingSettings(db, patch, userId, at)`,
    `billingSettingsPatchSchema` (Zod).
  - `allocateCharge(p: { price: number; paidShare: number; paidBalance: number; gifts: readonly GiftBalance[] }): Allocation`.
  - `BillingService` (`new BillingService({ db, now })`):
    - `charge(p: { tenantId: string; registerId: string; chargeDevice: string; days: readonly string[] }): number`
    - `summary(tenantId: string): BillingSummary`
    - `grantSignupBonus(tenantId: string, actorUserId: string | null): string`
    - `isBillable(tenantId: string): boolean`
  - `reconcileCharges(p: { systemDb: DatabaseSync; tenantManager: TenantManager; billing: BillingService }): number`
    y `startBillingSweeper(p, intervalMs): NodeJS.Timeout`.
  - `ConnectorDeps` suma `billing: BillingService`.
  - `BillingSummary` en `src/shared/credits-types.ts`:

```typescript
export type BillingState = 'ok' | 'low' | 'debt' | 'restricted';

export type BillingSummary = {
  billable: boolean;
  state: BillingState;
  holder: { userId: string; name: string; email: string } | null;
  paidBalance: number;
  giftBalance: number;
  nextGiftExpiry: string | null;
  debt: number;
  /** Último día (AAAA-MM-DD) para pagar sin que se restrinja; solo con deuda. */
  deadline: string | null;
  daysCovered: number | null;
  dailyBurn: number;
};
```

- [ ] **Paso 1: test del reparto (falla).** `test/billing-allocation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { allocateCharge } from '../src/server/billing/allocation.ts';

const g = (creditId: string, remaining: number) => ({ creditId, remaining });

describe('reparto de un cargo (#21)', () => {
  it.each([
    ['con pagado, 50/50', { price: 1000, paidShare: 0.5, paidBalance: 5000, gifts: [g('a', 5000)] }, { paid: 500, gifts: [{ creditId: 'a', amount: 500 }], debt: 0 }],
    ['sin pagado, 100 % regalado', { price: 1000, paidShare: 0.5, paidBalance: 0, gifts: [g('a', 5000)] }, { paid: 0, gifts: [{ creditId: 'a', amount: 1000 }], debt: 0 }],
    ['sin regalados, 100 % pagado', { price: 1000, paidShare: 0.5, paidBalance: 5000, gifts: [] }, { paid: 1000, gifts: [], debt: 0 }],
    ['el pagado no alcanza: el regalado completa', { price: 1000, paidShare: 0.5, paidBalance: 200, gifts: [g('a', 5000)] }, { paid: 200, gifts: [{ creditId: 'a', amount: 800 }], debt: 0 }],
    ['el regalado no alcanza: el pagado completa', { price: 1000, paidShare: 0.5, paidBalance: 5000, gifts: [g('a', 300)] }, { paid: 700, gifts: [{ creditId: 'a', amount: 300 }], debt: 0 }],
    ['regalados por vencimiento, en orden', { price: 1000, paidShare: 0, paidBalance: 0, gifts: [g('a', 400), g('b', 5000)] }, { paid: 0, gifts: [{ creditId: 'a', amount: 400 }, { creditId: 'b', amount: 600 }], debt: 0 }],
    ['nada alcanza: el resto es deuda', { price: 1000, paidShare: 0.5, paidBalance: 100, gifts: [g('a', 300)] }, { paid: 100, gifts: [{ creditId: 'a', amount: 300 }], debt: 600 }],
    ['sin nada: todo deuda', { price: 1000, paidShare: 0.5, paidBalance: 0, gifts: [] }, { paid: 0, gifts: [], debt: 1000 }],
    ['pesos enteros: la parte pagada se redondea', { price: 1000, paidShare: 0.333, paidBalance: 5000, gifts: [g('a', 5000)] }, { paid: 333, gifts: [{ creditId: 'a', amount: 667 }], debt: 0 }],
    ['proporción 100 %: el regalado no se toca con pagado', { price: 1000, paidShare: 1, paidBalance: 5000, gifts: [g('a', 5000)] }, { paid: 1000, gifts: [], debt: 0 }],
  ])('%s', (_name, input, expected) => {
    expect(allocateCharge(input)).toEqual(expected);
  });
});
```

- [ ] **Paso 2: correrlo** → FALLA. **El reparto.** `src/server/billing/allocation.ts`:

```typescript
/** El remanente vigente de un crédito regalado, en el orden en que se consume (vencimiento más próximo primero). */
export type GiftBalance = { creditId: string; remaining: number };

export type Allocation = { paid: number; gifts: { creditId: string; amount: number }[]; debt: number };

/**
 * Reparte un cargo (#21): con pagado > 0, la proporción; el faltante de una fuente sale de la otra;
 * con pagado en 0, todo regalado; lo que no cubre ninguna es deuda. Pesos enteros: la parte pagada
 * se redondea y el regalado completa.
 */
export function allocateCharge(p: { price: number; paidShare: number; paidBalance: number; gifts: readonly GiftBalance[] }): Allocation {
  const giftTotal = p.gifts.reduce((sum, gift) => sum + Math.max(0, gift.remaining), 0);
  const available = Math.max(0, p.paidBalance);
  const wanted = available > 0 ? Math.round(p.price * p.paidShare) : 0;
  let paid = Math.min(wanted, available);
  const giftPart = Math.min(p.price - paid, giftTotal);
  paid += Math.min(p.price - paid - giftPart, available - paid);
  const debt = p.price - paid - giftPart;

  const gifts: { creditId: string; amount: number }[] = [];
  let left = giftPart;
  for (const gift of p.gifts) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, gift.remaining));
    if (take > 0) {
      gifts.push({ creditId: gift.creditId, amount: take });
      left -= take;
    }
  }
  return { paid, gifts, debt };
}
```

  Correr → PASA.

- [ ] **Paso 3: configuración.** `src/server/billing/settings.ts`:

```typescript
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/** Configuración de cobro (#21), solo para root. Los valores por defecto viven acá; la base guarda los cambios. */
export const billingSettingsSchema = z.object({
  pricePerRegisterDay: z.number().int().positive(),
  signupBonus: z.number().int().min(0),
  signupBonusDays: z.number().int().positive(),
  paidShare: z.number().min(0).max(1),
  graceDays: z.number().int().min(0),
  lowBalanceDays: z.number().int().min(0),
  paymentAlias: z.string().max(100),
  paymentCbu: z.string().max(30),
  paymentHolder: z.string().max(100),
  supportWhatsapp: z.string().max(30),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;
export const billingSettingsPatchSchema = billingSettingsSchema.partial().strict();
export type BillingSettingsPatch = z.infer<typeof billingSettingsPatchSchema>;

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  pricePerRegisterDay: 1000,
  signupBonus: 50000,
  signupBonusDays: 90,
  paidShare: 0.5,
  graceDays: 10,
  lowBalanceDays: 7,
  paymentAlias: '',
  paymentCbu: '',
  paymentHolder: '',
  supportWhatsapp: '',
};

const KEYS = Object.keys(DEFAULT_BILLING_SETTINGS) as (keyof BillingSettings)[];

/** Lo guardado sobre los valores por defecto; un valor guardado que no valida se ignora. */
export function readBillingSettings(db: DatabaseSync): BillingSettings {
  const rows = db.prepare('SELECT key, value FROM billing_settings').all() as { key: string; value: string }[];
  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    if ((KEYS as string[]).includes(row.key)) stored[row.key] = JSON.parse(row.value);
  }
  const merged: Record<string, unknown> = { ...DEFAULT_BILLING_SETTINGS };
  for (const key of KEYS) {
    if (!(key in stored)) continue;
    const field = billingSettingsSchema.shape[key].safeParse(stored[key]);
    if (field.success) merged[key] = field.data;
  }
  return billingSettingsSchema.parse(merged);
}

export function writeBillingSettings(db: DatabaseSync, patch: BillingSettingsPatch, userId: string, at: string): BillingSettings {
  const upsert = db.prepare(
    `INSERT INTO billing_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) upsert.run(key, JSON.stringify(value), userId, at);
  }
  return readBillingSettings(db);
}
```

- [ ] **Paso 4: test de cargos y estado (falla).** `test/billing-charges.test.ts`. Reloj fijo; un
  comercio `t1` con titular `u1` y otro `t2` del mismo titular; helpers locales:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { BillingService } from '../src/server/billing/billing-service.ts';

describe('cargos y estado de cobro (#21)', () => {
  let db: DatabaseSync;
  let now: Date;
  let billing: BillingService;

  const gift = (tenantId: string, amount: number, expiresAt: string, id = `g-${String(amount)}-${expiresAt}`) =>
    db.prepare("INSERT INTO gift_credits (id, tenant_id, amount, expires_at, origin, created_at) VALUES (?, ?, ?, ?, 'grant', '2026-10-01T00:00:00.000Z')")
      .run(id, tenantId, amount, expiresAt);
  const paid = (userId: string, amount: number) =>
    db.prepare("INSERT INTO paid_movements (id, user_id, kind, amount, day, created_at) VALUES (?, ?, 'payment', ?, '2026-10-01', '2026-10-01T00:00:00.000Z')")
      .run(`pm-${String(Math.random())}`, userId, amount);
  const charges = () => db.prepare('SELECT tenant_id, register_id, device_id, day, amount, paid_amount, gift_amount, debt_amount, rule FROM charges ORDER BY day, register_id, device_id').all();

  beforeEach(() => {
    db = openSystemDb(':memory:');
    db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES ('u1', 'u1@x.com', 'h', 'Ana', 'user', '2026-10-01T00:00:00.000Z')").run();
    for (const t of ['t1', 't2']) {
      db.prepare("INSERT INTO tenants (id, slug, name, created_at, holder_user_id) VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', 'u1')").run(t, t, t);
    }
    db.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES ('demo', 'demo', 'Demo', '2026-10-01T00:00:00.000Z')").run();
    now = new Date('2026-10-05T15:00:00.000Z');
    billing = new BillingService({ db, now: () => now });
  });

  it('un cargo por caja y día; repetir no cobra dos veces', () => {
    gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    expect(billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-04', '2026-10-05'] })).toBe(2);
    expect(billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] })).toBe(0);
    billing.charge({ tenantId: 't1', registerId: 'r2', chargeDevice: '', days: ['2026-10-05'] });
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: 'dev-b', days: ['2026-10-05'] });
    expect(charges()).toHaveLength(4);
  });

  it('guarda el reparto y la regla; consume regalados por vencimiento', () => {
    gift('t1', 300, '2026-11-01T00:00:00.000Z', 'g-pronto');
    gift('t1', 50000, '2027-01-01T00:00:00.000Z', 'g-tarde');
    paid('u1', 5000);
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    expect(charges()).toEqual([
      expect.objectContaining({ day: '2026-10-05', amount: 1000, paid_amount: 500, gift_amount: 500, debt_amount: 0, rule: JSON.stringify({ price: 1000, paidShare: 0.5 }) }),
    ]);
    expect(db.prepare('SELECT credit_id, amount FROM gift_consumptions ORDER BY credit_id').all()).toEqual([
      { credit_id: 'g-pronto', amount: 300 },
      { credit_id: 'g-tarde', amount: 200 },
    ]);
    expect(db.prepare("SELECT amount, kind, tenant_id FROM paid_movements WHERE kind = 'charge'").all()).toEqual([
      { amount: -500, kind: 'charge', tenant_id: 't1' },
    ]);
  });

  it('un regalado vencido o anulado no cuenta', () => {
    gift('t1', 5000, '2026-10-05T14:00:00.000Z', 'g-vencido');
    gift('t1', 5000, '2027-01-01T00:00:00.000Z', 'g-anulado');
    db.prepare("UPDATE gift_credits SET voided_at = '2026-10-02T00:00:00.000Z' WHERE id = 'g-anulado'").run();
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    expect(charges()[0]).toMatchObject({ debt_amount: 1000 });
  });

  it('una demo o un comercio sin titular no cobra', () => {
    expect(billing.charge({ tenantId: 'demo', registerId: 'r9', chargeDevice: '', days: ['2026-10-05'] })).toBe(0);
    expect(billing.isBillable('demo')).toBe(false);
  });

  it('estado ok con saldo de sobra; low si cubre menos de 7 días', () => {
    gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    expect(billing.summary('t1')).toMatchObject({ state: 'ok', giftBalance: 50000, paidBalance: 0, debt: 0, daysCovered: 50, dailyBurn: 1000 });
    db.prepare("UPDATE gift_credits SET amount = 6000").run();
    expect(billing.summary('t1')).toMatchObject({ state: 'low', daysCovered: 6 });
  });

  it('el consumo diario cuenta las cajas y equipos con cargos en los últimos 7 días', () => {
    gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    billing.charge({ tenantId: 't1', registerId: 'r2', chargeDevice: '', days: ['2026-10-04'] });
    billing.charge({ tenantId: 't1', registerId: 'r3', chargeDevice: '', days: ['2026-09-28'] });
    expect(billing.summary('t1')).toMatchObject({ dailyBurn: 2000, daysCovered: 23 });
  });

  it('deuda: fecha límite a 10 días del cargo más antiguo en deuda; restringido al pasarla', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-03'] });
    expect(billing.summary('t1')).toMatchObject({ state: 'debt', debt: 1000, deadline: '2026-10-13' });
    now = new Date('2026-10-14T03:00:00.000Z'); // 14/10 00:00 en Argentina
    expect(billing.summary('t1')).toMatchObject({ state: 'restricted' });
  });

  it('grace_until posterior extiende la fecha límite', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-03'] });
    db.prepare("UPDATE tenants SET grace_until = '2026-10-20' WHERE id = 't1'").run();
    now = new Date('2026-10-15T12:00:00.000Z');
    expect(billing.summary('t1')).toMatchObject({ state: 'debt', deadline: '2026-10-20' });
  });

  it('el pagado es del titular: lo comparten sus comercios; la deuda de uno no restringe al otro', () => {
    paid('u1', 1500);
    gift('t2', 50000, '2027-01-01T00:00:00.000Z');
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01', '2026-10-02'] });
    expect(billing.summary('t1')).toMatchObject({ paidBalance: 0, debt: 500 });
    expect(billing.summary('t2')).toMatchObject({ paidBalance: 0, state: 'ok' });
  });

  it('el bono de alta usa la configuración', () => {
    const id = billing.grantSignupBonus('t1', 'u1');
    expect(db.prepare('SELECT amount, origin, expires_at, granted_by FROM gift_credits WHERE id = ?').get(id)).toEqual({
      amount: 50000, origin: 'signup', expires_at: '2027-01-03T15:00:00.000Z', granted_by: 'u1',
    });
  });
});
```

  Correr → FALLA.

- [ ] **Paso 5: `BillingService`** (`src/server/billing/billing-service.ts`), la parte de cargos y estado:

```typescript
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { allocateCharge, type GiftBalance } from './allocation.ts';
import { readBillingSettings } from './settings.ts';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import type { BillingSummary } from '../../shared/credits-types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cobro (#21), en la base de sistema: cargos por caja (o equipo ajeno) y día, saldo pagado del
 * titular, créditos regalados del comercio, deuda y gracia. Cada escritura va en su transacción.
 */
export class BillingService {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; now: () => Date }) {
    this.db = deps.db;
    this.now = deps.now;
  }

  isBillable(tenantId: string): boolean {
    return this.holderOf(tenantId) !== null;
  }

  /** Crea los cargos que falten, en orden de día. Devuelve cuántos creó. */
  charge(p: { tenantId: string; registerId: string; chargeDevice: string; days: readonly string[] }): number {
    const holder = this.holderOf(p.tenantId);
    if (holder === null) {
      const demo = this.db.prepare('SELECT 1 FROM demo_sessions WHERE tenant_id = ?').get(p.tenantId);
      if (demo === undefined) console.warn(`[cobro] el comercio ${p.tenantId} no tiene titular: no se cobra`);
      return 0;
    }
    let created = 0;
    for (const day of [...new Set(p.days)].sort()) {
      if (this.chargeOne(p.tenantId, holder, p.registerId, p.chargeDevice, day)) created++;
    }
    return created;
  }

  summary(tenantId: string): BillingSummary {
    const settings = readBillingSettings(this.db);
    const holderId = this.holderOf(tenantId);
    const today = argentinaToday(this.now());
    const holder = holderId === null
      ? null
      : (this.db.prepare('SELECT id AS userId, name, email FROM users WHERE id = ?').get(holderId) as { userId: string; name: string; email: string } | undefined) ?? null;
    const paidBalance = holderId === null ? 0 : this.paidBalance(holderId);
    const gifts = this.giftBalances(tenantId);
    const giftBalance = gifts.reduce((sum, g) => sum + g.remaining, 0);
    const nextGiftExpiry = gifts[0]?.expiresAt ?? null;
    const debtRow = this.db
      .prepare('SELECT COALESCE(SUM(debt_amount), 0) AS debt, MIN(day) AS oldest FROM charges WHERE tenant_id = ? AND debt_amount > 0')
      .get(tenantId) as { debt: number; oldest: string | null };
    const activeUnits = (this.db
      .prepare("SELECT COUNT(DISTINCT register_id || '|' || device_id) AS n FROM charges WHERE tenant_id = ? AND day >= ?")
      .get(tenantId, shiftDay(today, -6)) as { n: number }).n;
    const dailyBurn = settings.pricePerRegisterDay * Math.max(1, activeUnits);
    const base = { billable: holderId !== null, holder, paidBalance, giftBalance, nextGiftExpiry, debt: debtRow.debt, dailyBurn };

    if (holderId === null) {
      return { ...base, state: 'ok', deadline: null, daysCovered: null };
    }
    if (debtRow.debt > 0 && debtRow.oldest !== null) {
      const graceUntil = (this.db.prepare('SELECT grace_until FROM tenants WHERE id = ?').get(tenantId) as { grace_until: string | null }).grace_until;
      const byRule = shiftDay(debtRow.oldest, settings.graceDays);
      const deadline = graceUntil !== null && graceUntil > byRule ? graceUntil : byRule;
      return { ...base, state: today > deadline ? 'restricted' : 'debt', deadline, daysCovered: 0 };
    }
    const daysCovered = Math.floor((paidBalance + giftBalance) / dailyBurn);
    return { ...base, state: daysCovered < settings.lowBalanceDays ? 'low' : 'ok', deadline: null, daysCovered };
  }

  grantSignupBonus(tenantId: string, actorUserId: string | null): string {
    const settings = readBillingSettings(this.db);
    const at = this.now();
    const id = `gift_${randomUUID()}`;
    this.db
      .prepare("INSERT INTO gift_credits (id, tenant_id, amount, expires_at, origin, granted_by, reason, created_at) VALUES (?, ?, ?, ?, 'signup', ?, 'Bono de alta', ?)")
      .run(id, tenantId, settings.signupBonus, new Date(at.getTime() + settings.signupBonusDays * DAY_MS).toISOString(), actorUserId, at.toISOString());
    return id;
  }

  // --- internos ---

  protected holderOf(tenantId: string): string | null {
    const row = this.db.prepare('SELECT holder_user_id FROM tenants WHERE id = ?').get(tenantId) as { holder_user_id: string | null } | undefined;
    return row?.holder_user_id ?? null;
  }

  protected paidBalance(userId: string): number {
    return (this.db.prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM paid_movements WHERE user_id = ?').get(userId) as { balance: number }).balance;
  }

  /** Regalados vigentes con remanente, por vencimiento más próximo. */
  protected giftBalances(tenantId: string): (GiftBalance & { expiresAt: string })[] {
    const rows = this.db
      .prepare(
        `SELECT g.id, g.expires_at, g.amount - COALESCE((SELECT SUM(c.amount) FROM gift_consumptions c WHERE c.credit_id = g.id), 0) AS remaining
         FROM gift_credits g
         WHERE g.tenant_id = ? AND g.voided_at IS NULL AND g.expires_at > ?
         ORDER BY g.expires_at, g.created_at`,
      )
      .all(tenantId, this.now().toISOString()) as { id: string; expires_at: string; remaining: number }[];
    return rows.filter((r) => r.remaining > 0).map((r) => ({ creditId: r.id, remaining: r.remaining, expiresAt: r.expires_at }));
  }

  private chargeOne(tenantId: string, holder: string, registerId: string, device: string, day: string): boolean {
    this.db.exec('BEGIN');
    try {
      const exists = this.db.prepare('SELECT 1 FROM charges WHERE register_id = ? AND device_id = ? AND day = ?').get(registerId, device, day);
      if (exists !== undefined) {
        this.db.exec('COMMIT');
        return false;
      }
      const settings = readBillingSettings(this.db);
      const allocation = allocateCharge({
        price: settings.pricePerRegisterDay,
        paidShare: settings.paidShare,
        paidBalance: this.paidBalance(holder),
        gifts: this.giftBalances(tenantId),
      });
      const id = `chg_${randomUUID()}`;
      const at = this.now().toISOString();
      const giftAmount = allocation.gifts.reduce((sum, g) => sum + g.amount, 0);
      this.db
        .prepare(
          `INSERT INTO charges (id, tenant_id, register_id, device_id, day, amount, paid_amount, gift_amount, debt_amount, rule, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, tenantId, registerId, device, day, settings.pricePerRegisterDay, allocation.paid, giftAmount, allocation.debt,
          JSON.stringify({ price: settings.pricePerRegisterDay, paidShare: settings.paidShare }), at);
      const consume = this.db.prepare('INSERT INTO gift_consumptions (charge_id, credit_id, amount) VALUES (?, ?, ?)');
      for (const g of allocation.gifts) consume.run(id, g.creditId, g.amount);
      if (allocation.paid > 0) {
        this.db
          .prepare("INSERT INTO paid_movements (id, user_id, kind, amount, tenant_id, charge_id, day, created_at) VALUES (?, ?, 'charge', ?, ?, ?, ?, ?)")
          .run(`pm_${randomUUID()}`, holder, -allocation.paid, tenantId, id, day, at);
      }
      this.db.exec('COMMIT');
      return true;
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
```

  Correr → PASA. (Los `protected` son para que la tarea 4 los use desde la misma clase; si el lint
  marca algo, pasan a `private`.)

- [ ] **Paso 6: titular al crear un comercio.** `TenantManager.createTenant` guarda
  `holder_user_id = params.ownerUserId ?? null` en el INSERT de `tenants`. Test en
  `test/tenant-manager.test.ts`: un comercio con `ownerUserId` queda con ese titular; uno sin owner
  (demo), sin titular.

- [ ] **Paso 7: cargo después del push (test que falla).** `test/billing-push.test.ts`, con `createApp`
  y reloj fijo (`now: () => new Date('2026-10-05T15:00:00.000Z')`), un owner, `createTenant` con
  owner, `grantSignupBonus` y dos cajas creadas con `POST /api-keys` (todavía existe):

```typescript
  it('vender en dos cajas el mismo día genera dos cargos; un día sin ventas, ninguno', async () => {
    await push(key1, 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T13:00:00.000Z')]);
    await push(key2, 'l2', 'dev-2', [venta('e2', 's2', '2026-10-04T14:00:00.000Z')]);
    const rows = systemDb.prepare('SELECT day, device_id FROM charges ORDER BY register_id').all();
    expect(rows).toEqual([{ day: '2026-10-04', device_id: '' }, { day: '2026-10-04', device_id: '' }]);
  });

  it('una venta offline sincronizada al día siguiente se cobra en su día', async () => {
    await push(key1, 'l1', 'dev-1', [venta('e1', 's1', '2026-10-03T22:00:00.000Z', { date: '2026-10-03', number: 1 })]);
    expect(systemDb.prepare('SELECT day FROM charges').all()).toEqual([{ day: '2026-10-03' }]);
  });

  it('una anulación sola no cobra; un lote repetido tampoco', async () => {
    await push(key1, 'l1', 'dev-1', [{ ...venta('e1', 's9', '2026-10-04T13:00:00.000Z'), sale: { id: 's9', total: -100, voidsSaleId: 's0', payments: [{ method: 'cash', amount: -100 }] } }]);
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM charges').get()).toEqual({ n: 0 });
    await push(key1, 'l2', 'dev-1', [venta('e2', 's1', '2026-10-04T13:00:00.000Z')]);
    await push(key1, 'l2', 'dev-1', [venta('e2', 's1', '2026-10-04T13:00:00.000Z')]);
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM charges').get()).toEqual({ n: 1 });
  });

  it('otro equipo con la key de la caja cobra aparte', async () => {
    await push(key1, 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T13:00:00.000Z')]);
    await push(key1, 'l2', 'dev-x', [venta('e2', 's2', '2026-10-04T14:00:00.000Z')]);
    expect(systemDb.prepare('SELECT device_id FROM charges ORDER BY device_id').all()).toEqual([{ device_id: '' }, { device_id: 'dev-x' }]);
  });

  it('el barrido crea los cargos que falten y no repite', async () => {
    await push(key1, 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T13:00:00.000Z')]);
    systemDb.prepare('DELETE FROM charges').run();
    systemDb.prepare('DELETE FROM gift_consumptions').run();
    expect(reconcileCharges({ systemDb, tenantManager, billing })).toBe(1);
    expect(reconcileCharges({ systemDb, tenantManager, billing })).toBe(0);
  });
```

  `venta(eventId, saleId, createdAt, ticket?)` arma `{ id, type: 'sale', createdAt, origin, sale: { id, total: 100, payments: [{ method: 'cash', amount: 100 }], ...(ticket ? { ticket } : {}) } }`;
  `push(key, lotId, deviceId, events)` es el `POST /connector/sync/push` con los headers de siempre.
  `billing` sale de `bundle.billing`. Correr → FALLA.

- [ ] **Paso 8: conectar el cargo y el barrido.**
  - `billingServiceDef = fn.singleton((c) => new BillingService({ db: c.use(systemDbDef), now: c.use(clockDef) }))`
    en `container.ts`; `createApp` lo resuelve y lo devuelve como `billing`.
  - `ConnectorDeps` suma `billing: BillingService`. En el push, después de `processPushLot`:

```typescript
    if (result.saleDays.length > 0) {
      try {
        deps.billing.charge({ tenantId: req.posContext.tenantId, registerId, chargeDevice, days: result.saleDays });
      } catch (err: unknown) {
        // El cobro nunca tumba un push: el barrido lo recupera
        console.error('[cobro] no se pudo generar el cargo:', err);
      }
    }
```

  - `src/server/billing/reconcile.ts`:

```typescript
import type { DatabaseSync } from 'node:sqlite';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { BillingService } from './billing-service.ts';

type Deps = { systemDb: DatabaseSync; tenantManager: TenantManager; billing: BillingService };

/** Crea los cargos que falten (#21): una caída entre el commit del lote y el cargo. Devuelve cuántos creó. */
export function reconcileCharges(deps: Deps): number {
  const tenants = deps.systemDb.prepare('SELECT id FROM tenants WHERE holder_user_id IS NOT NULL').all() as { id: string }[];
  let created = 0;
  for (const { id } of tenants) {
    const groups = deps.tenantManager
      .getTenantDb(id)
      .prepare(
        `SELECT register_id, COALESCE(charge_device, '') AS device, group_concat(DISTINCT day) AS days
         FROM sales WHERE register_id IS NOT NULL AND voids_sale_id IS NULL AND day IS NOT NULL
         GROUP BY register_id, COALESCE(charge_device, '')`,
      )
      .all() as { register_id: string; device: string; days: string }[];
    for (const g of groups) {
      created += deps.billing.charge({ tenantId: id, registerId: g.register_id, chargeDevice: g.device, days: g.days.split(',') });
    }
  }
  return created;
}

export function startBillingSweeper(deps: Deps, intervalMs: number): NodeJS.Timeout {
  const sweep = (): void => {
    try {
      const created = reconcileCharges(deps);
      if (created > 0) console.log(`[cobro] barrido: ${String(created)} cargos recuperados`);
    } catch (err: unknown) {
      console.error('[cobro] falló el barrido:', err);
    }
  };
  sweep();
  const timer = setInterval(sweep, intervalMs);
  timer.unref();
  return timer;
}
```

  - `bootstrap.ts`: `Bundle` suma `billing`; arranca `startBillingSweeper({ systemDb, tenantManager, billing }, intervalo)`
    y devuelve también `billingSweeper`. Ajustar `test/bootstrap.test.ts` (y `server.ts` si limpia
    los timers) a ese campo nuevo.
  - `ensureDevData` le da el bono a `tienda-demo` al crearla (`new BillingService({ db: systemDb, now: () => new Date() }).grantSignupBonus(...)`).

- [ ] **Paso 9: suite completa.** `pnpm lint && pnpm typecheck && pnpm test` → verde.

- [ ] **Paso 10: commit.**

```bash
git add src test
git commit -m "feat: cargos por caja y día con reparto entre pagado y regalado (#21)"
```

---

### Tarea 4: Operaciones de plataforma y bono en el alta

**Archivos:**
- Crear: `src/server/middleware/platform-role-middleware.ts`, `src/server/routes/platform-routes.ts`
- Modificar: `src/server/billing/billing-service.ts`, `src/server/audit/audit-log.ts`,
  `src/server/alta/alta-service.ts`, `src/server/di/container.ts`, `src/server/app.ts`,
  `src/server/errors.ts` (si hace falta un estado)
- Test: `test/billing-payments.test.ts`, `test/platform-api.test.ts`, `test/alta-api.test.ts`

**Interfaces:**
- Produce en `BillingService`:
  - `registerPayment(p: { tenantId: string; day: string; amount: number; info?: string | undefined; actorUserId: string; paymentRef?: string | undefined }): { movementId: string; settled: number }`
  - `grantCredits(p: { tenantId: string; amount: number; expiresOn: string; reason?: string | undefined; actorUserId: string }): string`
  - `voidCredit(p: { tenantId: string; creditId: string; reason: string; actorUserId: string }): void`
  - `setGrace(p: { tenantId: string; until: string }): void`
  - `refund(p: { tenantId: string; amount: number; info?: string | undefined; actorUserId: string }): string`
  - `setHolder(p: { tenantId: string; userId: string }): void`
  - `settings(): BillingSettings` y `updateSettings(patch: BillingSettingsPatch, actorUserId: string): BillingSettings`
  - `listPayments(limit?: number): PlatformPaymentItem[]`
- `requirePlatformRole(...roles: ('root' | 'support')[]): RequestHandler`
- `AuditAction` suma `'billing.payment_registered' | 'billing.credits_granted' | 'billing.credit_voided' |
  'billing.grace_extended' | 'billing.refund' | 'billing.holder_changed' | 'billing.settings_updated'`.
- `createPlatformRoutes(deps: { billing: BillingService; audit: AuditLog; systemDb: DatabaseSync }): Router`,
  montado en `/api/platform` con `requireAdmin`.
- `PlatformPaymentItem` en `src/shared/credits-types.ts`:
  `{ id: string; day: string; amount: number; info: string | null; tenantId: string | null; tenantName: string | null; holderName: string; createdByName: string | null; createdAt: string; fromSheet: boolean }`.

- [ ] **Paso 1: test de pagos y movimientos (falla).** `test/billing-payments.test.ts` (mismo armado
  que `billing-charges.test.ts`, con un usuario `u2` owner activo de `t1` vía `memberships`):

```typescript
  it('un pago cancela primero la deuda, del cargo más antiguo, y el resto queda de saldo', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01', '2026-10-02'] });
    billing.charge({ tenantId: 't2', registerId: 'r2', chargeDevice: '', days: ['2026-10-03'] });
    const res = billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 2500, actorUserId: 'root' });
    expect(res.settled).toBe(2500);
    expect(db.prepare('SELECT day, debt_amount, paid_amount FROM charges ORDER BY day').all()).toEqual([
      { day: '2026-10-01', debt_amount: 0, paid_amount: 1000 },
      { day: '2026-10-02', debt_amount: 0, paid_amount: 1000 },
      { day: '2026-10-03', debt_amount: 500, paid_amount: 500 },
    ]);
    expect(billing.summary('t1')).toMatchObject({ debt: 0, paidBalance: 0, state: 'low' });
    expect(billing.summary('t2')).toMatchObject({ debt: 500 });
  });

  it('después de un pago, los cargos siguientes se reparten según la proporción', () => {
    gift('t1', 50000, '2027-01-01T00:00:00.000Z');
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 10000, actorUserId: 'root' });
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-05'] });
    expect(db.prepare('SELECT paid_amount, gift_amount FROM charges').get()).toEqual({ paid_amount: 500, gift_amount: 500 });
  });

  it('un crédito regalado nuevo no cancela deuda', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-10-01'] });
    billing.grantCredits({ tenantId: 't1', amount: 5000, expiresOn: '2026-12-31', actorUserId: 'root' });
    expect(billing.summary('t1')).toMatchObject({ debt: 1000, giftBalance: 5000 });
  });

  it('otorgar vence al final del día argentino; anular deja el remanente en cero', () => {
    const id = billing.grantCredits({ tenantId: 't1', amount: 5000, expiresOn: '2026-12-31', reason: 'Cortesía', actorUserId: 'root' });
    expect(db.prepare('SELECT expires_at, reason, granted_by FROM gift_credits WHERE id = ?').get(id)).toEqual({
      expires_at: '2027-01-01T03:00:00.000Z', reason: 'Cortesía', granted_by: 'root',
    });
    billing.voidCredit({ tenantId: 't1', creditId: id, reason: 'Error', actorUserId: 'root' });
    expect(billing.summary('t1').giftBalance).toBe(0);
  });

  it('la devolución no puede superar el saldo pagado', () => {
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 3000, actorUserId: 'root' });
    expect(() => billing.refund({ tenantId: 't1', amount: 3001, actorUserId: 'root' })).toThrow('La devolución supera el saldo pagado');
    billing.refund({ tenantId: 't1', amount: 3000, actorUserId: 'root' });
    expect(billing.summary('t1').paidBalance).toBe(0);
  });

  it('el titular nuevo tiene que ser owner activo; el saldo no se mueve', () => {
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 3000, actorUserId: 'root' });
    expect(() => billing.setHolder({ tenantId: 't1', userId: 'nadie' })).toThrow('El titular tiene que ser un owner activo del comercio');
    billing.setHolder({ tenantId: 't1', userId: 'u2' });
    expect(billing.summary('t1')).toMatchObject({ paidBalance: 0, holder: { userId: 'u2' } });
  });

  it('extender la gracia con una fecha', () => {
    billing.charge({ tenantId: 't1', registerId: 'r1', chargeDevice: '', days: ['2026-09-01'] });
    expect(billing.summary('t1').state).toBe('restricted');
    billing.setGrace({ tenantId: 't1', until: '2026-10-10' });
    expect(billing.summary('t1')).toMatchObject({ state: 'debt', deadline: '2026-10-10' });
  });

  it('un pago con la misma referencia no se registra dos veces', () => {
    billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 100, actorUserId: 'root', paymentRef: 'abc' });
    expect(() => billing.registerPayment({ tenantId: 't1', day: '2026-10-05', amount: 100, actorUserId: 'root', paymentRef: 'abc' })).toThrow('Ese pago ya estaba registrado');
  });
```

  Correr → FALLA.

- [ ] **Paso 2: los métodos.** En `BillingService`:

```typescript
  registerPayment(p: { tenantId: string; day: string; amount: number; info?: string | undefined; actorUserId: string; paymentRef?: string | undefined }): { movementId: string; settled: number } {
    const holder = this.requireHolder(p.tenantId);
    if (!(p.amount > 0)) throw new DomainError(400, 'El importe tiene que ser mayor que 0');
    if (p.paymentRef !== undefined && this.db.prepare('SELECT 1 FROM paid_movements WHERE payment_ref = ?').get(p.paymentRef) !== undefined) {
      throw new DomainError(409, 'Ese pago ya estaba registrado');
    }
    const at = this.now().toISOString();
    const movementId = `pm_${randomUUID()}`;
    let settled = 0;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare("INSERT INTO paid_movements (id, user_id, kind, amount, tenant_id, payment_ref, day, info, created_by, created_at) VALUES (?, ?, 'payment', ?, ?, ?, ?, ?, ?, ?)")
        .run(movementId, holder, p.amount, p.tenantId, p.paymentRef ?? null, p.day, p.info ?? null, p.actorUserId, at);
      const debts = this.db
        .prepare(
          `SELECT c.id, c.tenant_id, c.day, c.debt_amount FROM charges c JOIN tenants t ON t.id = c.tenant_id
           WHERE t.holder_user_id = ? AND c.debt_amount > 0 ORDER BY c.day, c.created_at`,
        )
        .all(holder) as { id: string; tenant_id: string; day: string; debt_amount: number }[];
      let left = p.amount;
      for (const debt of debts) {
        if (left <= 0) break;
        const x = Math.min(left, debt.debt_amount);
        this.db
          .prepare('UPDATE charges SET debt_amount = debt_amount - ?, paid_amount = paid_amount + ?, debt_settled_at = CASE WHEN debt_amount - ? <= 0 THEN ? ELSE NULL END WHERE id = ?')
          .run(x, x, x, at, debt.id);
        this.db
          .prepare("INSERT INTO paid_movements (id, user_id, kind, amount, tenant_id, charge_id, day, created_by, created_at) VALUES (?, ?, 'debt-settlement', ?, ?, ?, ?, ?, ?)")
          .run(`pm_${randomUUID()}`, holder, -x, debt.tenant_id, debt.id, debt.day, p.actorUserId, at);
        left -= x;
        settled += x;
      }
      this.db.exec('COMMIT');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { movementId, settled };
  }

  grantCredits(p: { tenantId: string; amount: number; expiresOn: string; reason?: string | undefined; actorUserId: string }): string {
    this.requireTenant(p.tenantId);
    if (!(p.amount > 0)) throw new DomainError(400, 'El importe tiene que ser mayor que 0');
    const id = `gift_${randomUUID()}`;
    // Vence al terminar el día argentino elegido: 00:00 del día siguiente en UTC−3
    const expiresAt = `${shiftDay(p.expiresOn, 1)}T03:00:00.000Z`;
    this.db
      .prepare("INSERT INTO gift_credits (id, tenant_id, amount, expires_at, origin, granted_by, reason, created_at) VALUES (?, ?, ?, ?, 'grant', ?, ?, ?)")
      .run(id, p.tenantId, p.amount, expiresAt, p.actorUserId, p.reason ?? null, this.now().toISOString());
    return id;
  }

  voidCredit(p: { tenantId: string; creditId: string; reason: string; actorUserId: string }): void {
    const res = this.db
      .prepare('UPDATE gift_credits SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND tenant_id = ? AND voided_at IS NULL')
      .run(this.now().toISOString(), p.actorUserId, p.reason, p.creditId, p.tenantId);
    if (res.changes === 0) throw new DomainError(404, 'Crédito no encontrado');
  }

  setGrace(p: { tenantId: string; until: string }): void {
    this.requireTenant(p.tenantId);
    this.db.prepare('UPDATE tenants SET grace_until = ? WHERE id = ?').run(p.until, p.tenantId);
  }

  refund(p: { tenantId: string; amount: number; info?: string | undefined; actorUserId: string }): string {
    const holder = this.requireHolder(p.tenantId);
    if (!(p.amount > 0)) throw new DomainError(400, 'El importe tiene que ser mayor que 0');
    if (p.amount > this.paidBalance(holder)) throw new DomainError(400, 'La devolución supera el saldo pagado');
    const id = `pm_${randomUUID()}`;
    const at = this.now();
    this.db
      .prepare("INSERT INTO paid_movements (id, user_id, kind, amount, tenant_id, day, info, created_by, created_at) VALUES (?, ?, 'refund', ?, ?, ?, ?, ?, ?)")
      .run(id, holder, -p.amount, p.tenantId, argentinaToday(at), p.info ?? null, p.actorUserId, at.toISOString());
    return id;
  }

  setHolder(p: { tenantId: string; userId: string }): void {
    this.requireTenant(p.tenantId);
    const owner = this.db
      .prepare("SELECT 1 FROM memberships WHERE tenant_id = ? AND user_id = ? AND role = 'owner' AND status = 'active'")
      .get(p.tenantId, p.userId);
    if (owner === undefined) throw new DomainError(400, 'El titular tiene que ser un owner activo del comercio');
    this.db.prepare('UPDATE tenants SET holder_user_id = ? WHERE id = ?').run(p.userId, p.tenantId);
  }

  settings(): BillingSettings {
    return readBillingSettings(this.db);
  }

  updateSettings(patch: BillingSettingsPatch, actorUserId: string): BillingSettings {
    return writeBillingSettings(this.db, patch, actorUserId, this.now().toISOString());
  }

  private requireTenant(tenantId: string): void {
    const row = this.db.prepare('SELECT 1 FROM tenants WHERE id = ? AND id NOT IN (SELECT tenant_id FROM demo_sessions)').get(tenantId);
    if (row === undefined) throw new DomainError(404, 'Comercio no encontrado');
  }

  private requireHolder(tenantId: string): string {
    this.requireTenant(tenantId);
    const holder = this.holderOf(tenantId);
    if (holder === null) throw new DomainError(400, 'El comercio no tiene titular');
    return holder;
  }
```

  Más `listPayments(limit = 200)`: los `paid_movements` `kind = 'payment'`, con el nombre del
  comercio, del titular y de quien lo cargó, del más nuevo al más viejo; `fromSheet = payment_ref !== null`.
  Correr → PASA.

- [ ] **Paso 3: test de la API de plataforma (falla).** `test/platform-api.test.ts`: un root (con
  `AuthService.ensureRoot` como en `test/root-bootstrap.test.ts`), un soporte (usuario con
  `UPDATE users SET global_role = 'support'`), un owner y su comercio `kiosco` con titular.
  - Root y soporte: `POST /api/platform/tenants/kiosco/payments` `{ day: '2026-10-05', amount: 5000, info: 'Transf. 123' }` → 201;
    `POST …/gift-credits` `{ amount: 1000, expiresOn: '2026-12-31', reason: 'Cortesía' }` → 201 con `{ id }`;
    `DELETE …/gift-credits/:id` `{ reason: 'Error' }` → 200; `POST …/grace` `{ until: '2026-10-20' }` → 200;
    `PUT …/holder` `{ userId }` → 200.
  - Solo root: `POST …/refunds` (`403` para soporte) y `PUT /api/platform/settings` (`403` para
    soporte; `GET` lo pueden los dos).
  - Un owner común: `403` en todas.
  - Validaciones: `amount` ≤ 0 o `day` inválido → 400; comercio inexistente → 404; `PUT /settings`
    con una clave desconocida → 400.
  - Auditoría: cada operación deja su `billing.*` en `audit_log` con `tenant_id` (la de
    configuración, con `tenant_id` nulo).
  - `GET /api/platform/payments` lista el pago con `tenantName`.

  Correr → FALLA.

- [ ] **Paso 4: middleware y rutas.** `src/server/middleware/platform-role-middleware.ts`:

```typescript
import type { NextFunction, Response } from 'express';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';

type PlatformRole = 'root' | 'support';

/** Rutas de plataforma (#21): solo los roles globales indicados. */
export function requirePlatformRole(...roles: PlatformRole[]) {
  return (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.globalRole;
    if (role !== 'root' && role !== 'support') {
      res.status(403).json({ error: 'Solo para la plataforma' });
      return;
    }
    if (!roles.includes(role)) {
      res.status(403).json({ error: 'No tenés permiso para esto' });
      return;
    }
    next();
  };
}
```

  `src/server/routes/platform-routes.ts`: un `Router` con los esquemas Zod
  (`day: z.string().regex(DAY_PATTERN, 'Fecha inválida')`, `amount: z.number().positive('El importe tiene que ser mayor que 0')`,
  `info`/`reason` opcionales `z.string().trim().max(200).optional()`, `until` y `expiresOn` con
  `DAY_PATTERN`, `reason` obligatorio al anular), cada handler en `try { … } catch (err) { sendError(res, err, 500) }`,
  y después de cada operación exitosa `audit.record({ actorUserId, tenantId, action, details })`
  con el importe, la fecha o el motivo en `details`. Rutas:

| Ruta | Roles | Acción de auditoría |
|---|---|---|
| `POST /tenants/:tenantId/payments` | root, support | `billing.payment_registered` |
| `POST /tenants/:tenantId/gift-credits` | root, support | `billing.credits_granted` |
| `DELETE /tenants/:tenantId/gift-credits/:creditId` | root, support | `billing.credit_voided` |
| `POST /tenants/:tenantId/grace` | root, support | `billing.grace_extended` |
| `POST /tenants/:tenantId/refunds` | root | `billing.refund` |
| `PUT /tenants/:tenantId/holder` | root, support | `billing.holder_changed` (con `targetUserId`) |
| `GET /payments` | root, support | — |
| `GET /settings` | root, support | — |
| `PUT /settings` | root | `billing.settings_updated` (`tenantId: null`, las claves cambiadas) |

  En `app.ts`: `app.use('/api/platform', requireAdmin, createPlatformRoutes({ billing, audit: auditLog, systemDb }))`.

- [ ] **Paso 5: bono en el alta.** Test en `test/alta-api.test.ts`: después del alta, el comercio tiene
  titular (el usuario del alta) y un `gift_credits` `signup` de 50.000. `AltaService` recibe
  `billing: BillingService` en sus deps (`altaServiceDef` le pasa `c.use(billingServiceDef)`) y,
  después de `createApiKey`, llama a `this.billing.grantSignupBonus(tenant.id, user.id)`.

- [ ] **Paso 6: suite completa** → verde. **Commit.**

```bash
git add src test
git commit -m "feat: pagos, créditos, gracia, devoluciones, titular y configuración de plataforma (#21)"
```

---

### Tarea 5: Planilla de cobranzas en CSV

**Archivos:**
- Crear: `src/server/billing/payment-sheet.ts`
- Modificar: `src/server/routes/platform-routes.ts`, `src/shared/credits-types.ts`
- Test: `test/payment-sheet.test.ts`, `test/platform-api.test.ts`

**Interfaces:**
- Produce:
  - `parsePaymentSheet(csv: string): SheetRow[]` con
    `SheetRow = { line: number; day?: string; slug?: string; amount?: number; info: string; ref?: string; error?: string }`.
  - `SheetResultRow` en `credits-types.ts`:
    `{ line: number; status: 'ok' | 'duplicate' | 'error'; message?: string; tenantId?: string; tenantName?: string; day?: string; amount?: number; info?: string }`.
  - `POST /api/platform/payments/import` con `{ csv: string }` y `?dryRun=1` → `{ rows: SheetResultRow[]; applied: boolean }`.

- [ ] **Paso 1: test del parseo (falla).** `test/payment-sheet.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parsePaymentSheet } from '../src/server/billing/payment-sheet.ts';

describe('planilla de cobranzas (#21)', () => {
  it('con punto y coma, coma decimal, fecha DD/MM/AAAA y comillas', () => {
    const csv = 'Fecha;Comercio;Importe;Info\r\n05/10/2026;kiosco;12.345,50;"Transf; op 1"\r\n';
    const [row] = parsePaymentSheet(csv);
    expect(row).toMatchObject({ line: 2, day: '2026-10-05', slug: 'kiosco', amount: 12345.5, info: 'Transf; op 1' });
    expect(row?.ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('con coma y fecha ISO', () => {
    const [row] = parsePaymentSheet('fecha,comercio,importe,info\n2026-10-05,kiosco,5000,op 2\n');
    expect(row).toMatchObject({ day: '2026-10-05', amount: 5000, info: 'op 2' });
  });

  it('la misma fila normalizada da la misma referencia', () => {
    const a = parsePaymentSheet('fecha;comercio;importe;info\n05/10/2026;Kiosco ;5.000,00; op 3\n')[0];
    const b = parsePaymentSheet('fecha,comercio,importe,info\n2026-10-05,kiosco,5000,op 3\n')[0];
    expect(a?.ref).toBe(b?.ref);
  });

  it('errores por fila: fecha, importe y comercio', () => {
    const rows = parsePaymentSheet('fecha;comercio;importe\n31/02/2026;kiosco;100\n05/10/2026;kiosco;0\n05/10/2026;;100\n');
    expect(rows.map((r) => r.error)).toEqual(['Fecha inválida', 'El importe tiene que ser mayor que 0', 'Falta el comercio']);
  });

  it('sin las columnas obligatorias, un error en la línea 1', () => {
    expect(parsePaymentSheet('fecha;importe\n05/10/2026;100\n')).toEqual([{ line: 1, info: '', error: 'Faltan columnas: comercio' }]);
  });

  it('ignora las líneas vacías', () => {
    expect(parsePaymentSheet('fecha;comercio;importe\n\n05/10/2026;kiosco;100\n\n')).toHaveLength(1);
  });
});
```

  Correr → FALLA.

- [ ] **Paso 2: el parseo.** `src/server/billing/payment-sheet.ts`:

```typescript
import { createHash } from 'node:crypto';
import { DAY_PATTERN } from '../../shared/argentina-day.ts';

export type SheetRow = { line: number; day?: string; slug?: string; amount?: number; info: string; ref?: string; error?: string };

const REQUIRED = ['fecha', 'comercio', 'importe'] as const;

/** Una línea CSV con comillas dobles (`""` escapa una comilla). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

const normalizeHeader = (h: string): string => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function parseDay(raw: string): string | undefined {
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = dmy === null ? raw : `${dmy[3] ?? ''}-${(dmy[2] ?? '').padStart(2, '0')}-${(dmy[1] ?? '').padStart(2, '0')}`;
  if (!DAY_PATTERN.test(iso)) return undefined;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/** `12.345,50` (coma decimal) o `12345.50`. */
function parseAmount(raw: string): number | undefined {
  const clean = raw.replace(/[$\s]/g, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : (clean.match(/\./g) ?? []).length > 1 ? clean.replace(/\./g, '') : clean;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  return Math.round(Number(normalized) * 100) / 100;
}

/** La planilla de cobranzas (#21): fecha, comercio (slug), importe e info. Cada fila con su referencia idempotente. */
export function parsePaymentSheet(csv: string): SheetRow[] {
  const lines = csv.split(/\r?\n/);
  const header = lines[0] ?? '';
  const sep = header.includes(';') ? ';' : ',';
  const cols = splitLine(header, sep).map(normalizeHeader);
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length > 0) return [{ line: 1, info: '', error: `Faltan columnas: ${missing.join(', ')}` }];
  const at = (cells: string[], name: string): string => cells[cols.indexOf(name)] ?? '';

  const rows: SheetRow[] = [];
  lines.slice(1).forEach((text, index) => {
    if (text.trim() === '') return;
    const line = index + 2;
    const cells = splitLine(text, sep);
    const info = cols.includes('info') ? at(cells, 'info') : '';
    const day = parseDay(at(cells, 'fecha'));
    if (day === undefined) { rows.push({ line, info, error: 'Fecha inválida' }); return; }
    const slug = at(cells, 'comercio').toLowerCase();
    if (slug === '') { rows.push({ line, info, error: 'Falta el comercio' }); return; }
    const amount = parseAmount(at(cells, 'importe'));
    if (amount === undefined || amount <= 0) { rows.push({ line, info, error: 'El importe tiene que ser mayor que 0' }); return; }
    const ref = createHash('sha256').update(`${day}|${slug}|${amount.toFixed(2)}|${info}`).digest('hex');
    rows.push({ line, day, slug, amount, info, ref });
  });
  return rows;
}
```

  Correr → PASA.

- [ ] **Paso 3: test del endpoint (falla).** En `test/platform-api.test.ts`:
  - `dryRun=1` con una fila buena, una con un slug inexistente (`error`, "Comercio no encontrado")
    y una repetida dentro de la misma planilla (`duplicate`): devuelve las tres filas con
    `applied: false` y no registra nada.
  - Sin `dryRun`: registra la buena (`ok`), y volver a subir la misma planilla da `duplicate` en
    esa fila sin un pago nuevo.
  - Una demo como comercio da `error` ("Las demos no se cobran").
  - Un owner común: `403`.

  Correr → FALLA.

- [ ] **Paso 4: el endpoint.** En `platform-routes.ts`, `POST /payments/import` (root y soporte) con
  `z.object({ csv: z.string().min(1, 'La planilla está vacía').max(1_000_000) })`. Por cada fila
  de `parsePaymentSheet`:
  - con `error` → `{ status: 'error', message }`;
  - el comercio por `slug` (`SELECT id, name FROM tenants WHERE slug = ?`); si no existe → error
    "Comercio no encontrado"; si está en `demo_sessions` → "Las demos no se cobran";
  - si `ref` ya está en `paid_movements` o apareció antes en la misma planilla → `duplicate`;
  - si no, `ok`, y sin `dryRun` llama a `billing.registerPayment({ …, paymentRef: ref, info })` y
    audita `billing.payment_registered` con `{ fromSheet: true }`. Un `DomainError` de esa llamada
    deja la fila en `error` con su mensaje.

  Responde `200 { rows, applied: !dryRun }`.

- [ ] **Paso 5: suite completa** → verde. **Commit.**

```bash
git add src test
git commit -m "feat: planilla de cobranzas en CSV, idempotente y con vista previa (#21)"
```

---

### Tarea 6: Avisos del pull, restricción y rutas de Créditos

**Archivos:**
- Crear: `src/server/billing/money-text.ts`, `src/server/routes/credits-routes.ts`,
  `src/server/middleware/billing-restriction-middleware.ts`
- Modificar: `src/server/notices/notice-service.ts`, `src/server/connector/connector-service.ts`,
  `src/server/routes/connector-routes.ts`, `src/server/billing/billing-service.ts`,
  `src/shared/permissions.ts`, `src/shared/credits-types.ts`, `src/server/app.ts`
- Test: `test/notices.test.ts`, `test/billing-notices.test.ts`, `test/credits-api.test.ts`,
  `test/billing-restriction.test.ts`, `test/permissions-api.test.ts`, `test/permissions.test.ts`

**Interfaces:**
- Produce:
  - `noticesFor(db: DatabaseSync, ctx: { deviceId: string | undefined; billing?: BillingSummary | undefined; register?: RegisterNoticeState | undefined }): BackendNotice[]`
  - `pullCatalog` recibe `notices: { billing?: BillingSummary | undefined; register?: RegisterNoticeState | undefined }`.
  - `formatPesos(n: number): string` (`$ 12.345`) y `formatDayShort(day: string): string` (`DD/MM`).
  - Capacidad `credits.view` (owner, admin).
  - `BillingService.listCharges(tenantId, q: { from?: string | undefined; to?: string | undefined; page: number; pageSize: number }): ChargesPage`,
    `listMovements(tenantId): CreditMovementItem[]`, `listGifts(tenantId): GiftItem[]`,
    `paymentInfo(): PaymentInfo`.
  - En `credits-types.ts`:

```typescript
export type ChargeItem = {
  id: string; day: string; registerId: string; registerName: string; deviceId: string | null;
  amount: number; paidAmount: number; giftAmount: number; debtAmount: number; createdAt: string;
};
export type ChargesPage = { items: ChargeItem[]; count: number; page: number; pageSize: number; total: number };
export type CreditMovementItem = {
  id: string; kind: 'payment' | 'refund' | 'debt-settlement' | 'gift-granted' | 'gift-voided';
  day: string; amount: number; info: string | null; byName: string | null; createdAt: string;
};
export type GiftItem = {
  id: string; origin: 'signup' | 'grant'; amount: number; remaining: number; expiresAt: string;
  status: 'active' | 'expired' | 'voided' | 'used'; grantedByName: string | null; reason: string | null; createdAt: string;
};
export type PaymentInfo = { alias: string; cbu: string; holder: string; supportWhatsapp: string };
export type CreditsResponse = BillingSummary & { paymentInfo: PaymentInfo };
export type BillingStatus = { state: BillingState; debt: number; deadline: string | null };
```

- [ ] **Paso 1: tests de avisos (fallan).** `test/billing-notices.test.ts`, puro sobre `noticesFor`
  con una base de comercio en memoria (`openTenantDb(':memory:')` o como lo arme
  `test/notices.test.ts`) y `BillingSummary` armados a mano:

```typescript
  const base: BillingSummary = { billable: true, state: 'ok', holder: null, paidBalance: 0, giftBalance: 50000, nextGiftExpiry: null, debt: 0, deadline: null, daysCovered: 50, dailyBurn: 1000 };

  it('ok: sin avisos de créditos', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: base })).toEqual([]);
  });
  it('low: warning con los días', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: { ...base, state: 'low', daysCovered: 4 } })).toEqual([
      { id: 'credits:low', severity: 'warning', message: 'Te quedan créditos para unos 4 días. Cargá saldo desde mini → Créditos.' },
    ]);
  });
  it('debt: critical con el importe y la fecha', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: { ...base, state: 'debt', debt: 12345, deadline: '2026-10-13' } })).toEqual([
      { id: 'credits:debt', severity: 'critical', message: 'mini contax: sin créditos, debés $ 12.345. Pagá antes del 13/10 para que mini siga funcionando. El POS sigue vendiendo.' },
    ]);
  });
  it('restricted: critical', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: { ...base, state: 'restricted', debt: 1000 } })[0]).toEqual({
      id: 'credits:restricted', severity: 'critical',
      message: 'mini contax está restringido por deuda de $ 1.000. El POS sigue vendiendo y sincronizando. Pagá desde mini → Créditos.',
    });
  });
  it('no facturable (demo): sin avisos de créditos', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: { ...base, billable: false, state: 'ok' } })).toEqual([]);
  });
  it('equipo ajeno y key compartida', () => {
    expect(noticesFor(db, { deviceId: 'dev-2', register: { registerId: 'r1', binding: 'foreign', sharedRecently: false } })).toEqual([
      { id: 'register:foreign-device', severity: 'warning', ref: { type: 'register', id: 'r1' },
        message: 'Esta caja está ligada a otro equipo: tus ventas se cobran aparte. Pedile al dueño que te pase la caja o te cree una.' },
    ]);
    expect(noticesFor(db, { deviceId: 'dev-1', register: { registerId: 'r1', binding: 'bound', sharedRecently: true } })).toEqual([
      { id: 'register:shared-key', severity: 'warning', ref: { type: 'register', id: 'r1' }, message: 'Otro equipo está usando la key de esta caja.' },
    ]);
  });
```

  En `test/notices.test.ts`, el caso "otro no" pasa a comparar solo los avisos `discrepancy:` (el
  otro equipo ahora recibe `register:foreign-device`) y se suma un caso de punta a punta: un pull de
  `dev-2` con la misma key trae `register:foreign-device`, y un comercio con deuda trae
  `credits:debt` en el pull. Correr → FALLA.

- [ ] **Paso 2: implementar.**
  - `src/server/billing/money-text.ts`:

```typescript
/** Textos fijos del servidor para los avisos del POS (#21): el servidor no conoce el navegador de quien lee. */
const PESOS = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export function formatPesos(n: number): string {
  return `$ ${PESOS.format(Math.round(n))}`;
}

export function formatDayShort(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}
```

  - `noticesFor` nuevo:

```typescript
export function noticesFor(
  db: DatabaseSync,
  ctx: { deviceId: string | undefined; billing?: BillingSummary | undefined; register?: RegisterNoticeState | undefined },
): BackendNotice[] {
  const notices: BackendNotice[] = [];
  const credits = creditsNotice(ctx.billing);
  if (credits !== undefined) notices.push(credits);
  if (ctx.register !== undefined) {
    const ref = { type: 'register', id: ctx.register.registerId };
    if (ctx.register.binding === 'foreign') {
      notices.push({ id: 'register:foreign-device', severity: 'warning', ref,
        message: 'Esta caja está ligada a otro equipo: tus ventas se cobran aparte. Pedile al dueño que te pase la caja o te cree una.' });
    } else if (ctx.register.sharedRecently) {
      notices.push({ id: 'register:shared-key', severity: 'warning', ref, message: 'Otro equipo está usando la key de esta caja.' });
    }
  }
  if (ctx.deviceId === undefined || ctx.deviceId === '') return notices;
  return [
    ...notices,
    ...listOpenDiscrepancies(db, { deviceId: ctx.deviceId }).map((d): BackendNotice => ({
      id: `discrepancy:${d.id}`, severity: 'warning', message: d.message, ref: { type: d.refType, id: d.refId },
    })),
  ];
}

function creditsNotice(billing: BillingSummary | undefined): BackendNotice | undefined {
  if (billing === undefined || !billing.billable) return undefined;
  switch (billing.state) {
    case 'low':
      return { id: 'credits:low', severity: 'warning',
        message: `Te quedan créditos para unos ${String(billing.daysCovered ?? 0)} días. Cargá saldo desde mini → Créditos.` };
    case 'debt':
      return { id: 'credits:debt', severity: 'critical',
        message: `mini contax: sin créditos, debés ${formatPesos(billing.debt)}. Pagá antes del ${formatDayShort(billing.deadline ?? '')} para que mini siga funcionando. El POS sigue vendiendo.` };
    case 'restricted':
      return { id: 'credits:restricted', severity: 'critical',
        message: `mini contax está restringido por deuda de ${formatPesos(billing.debt)}. El POS sigue vendiendo y sincronizando. Pagá desde mini → Créditos.` };
    case 'ok':
      return undefined;
  }
}
```

  - `ConnectorService.pullCatalog` suma `notices` en sus parámetros y llama
    `noticesFor(this.tenantDb, { deviceId, ...notices })`.
  - El pull de `connector-routes.ts` arma
    `{ billing: deps.billing.summary(tenantId), register: deviceId === undefined ? undefined : deps.registers.noticeState(registerId, deviceId) }`.

  Correr → PASA.

- [ ] **Paso 3: tests de Créditos y restricción (fallan).**
  - `test/credits-api.test.ts`: con un comercio con bono, ventas en dos cajas por push y un pago
    registrado por la plataforma:
    - `GET /credits` (owner y admin) trae `state`, `giftBalance`, `paidBalance`, `holder` y `paymentInfo`
      (después de un `PUT /api/platform/settings` con `paymentAlias: 'mini.contax'`, el alias sale ahí);
    - `GET /credits/charges?from=…&to=…` trae los cargos con `registerName` y `total`; `deviceId` es
      `null` en los de la caja y el `deviceId` en el de otro equipo;
    - `GET /credits/movements` trae el pago y el bono (`gift-granted`), del más nuevo al más viejo;
    - `GET /credits/gifts` trae el bono con `remaining` y `status: 'active'`;
    - `GET /billing-status` lo ve el member (`{ state, debt, deadline }`); `GET /credits` da 403 al member.
  - `test/permissions-api.test.ts`: sumar a `RUTAS`

```typescript
  'GET /credits': 'credits.view',
  'GET /credits/charges': 'credits.view',
  'GET /credits/movements': 'credits.view',
  'GET /credits/gifts': 'credits.view',
  'GET /billing-status': 'tenant.use',
```

    y en `test/permissions.test.ts` que `credits.view` es de owner y admin, no de member.
  - `test/billing-restriction.test.ts`: un comercio con un cargo en deuda de hace 20 días (insertado
    con `billing.charge` y reloj fijo):
    - el owner recibe `402 { code: 'billing-restricted', debt, deadline }` en `GET /products`,
      `GET /sales` y `POST /customers`;
    - el owner pasa en `GET /credits`, `GET /credits/charges`, `GET /billing-status` y
      `GET /export/products`;
    - el member recibe `402` en `GET /products` y `200` en `GET /billing-status`;
    - root impersonando pasa en `GET /products`;
    - el Connector sigue: un push con la key del comercio da 200 y la venta queda guardada; el pull da 200;
    - un pago que cancela la deuda levanta la restricción en el próximo pedido.

  Correr → FALLA.

- [ ] **Paso 4: implementar.**
  - `permissions.ts`: `Capability` suma `'credits.view'` y la matriz `'credits.view': ['owner', 'admin']`.
    En `src/client/state/permissions-state.ts` no hace falta nada todavía (no hay vista nueva).
  - `BillingService`: `listCharges` (join a `registers` para el nombre; `deviceId` nulo si `device_id = ''`;
    `total` = Σ `amount` del filtro; orden día descendente), `listMovements` (unión de
    `paid_movements` del comercio con `kind IN ('payment', 'refund', 'debt-settlement')`, los
    `gift_credits` como `gift-granted` y los anulados como `gift-voided`, con nombres de `users`),
    `listGifts` (con `remaining` y `status`: `voided` si `voided_at`, `expired` si vencido,
    `used` si `remaining <= 0`, si no `active`) y `paymentInfo()` de la configuración.
  - `src/server/routes/credits-routes.ts` con las cinco rutas; `from`/`to` validados con
    `DAY_PATTERN`, `page` y `pageSize` como en `sales-routes.ts`.
  - `src/server/middleware/billing-restriction-middleware.ts`:

```typescript
import type { NextFunction, Response } from 'express';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';
import type { BillingService } from '../billing/billing-service.ts';

/** Lo que sigue abierto con el comercio restringido (#21): Créditos, el estado de cobro y exportar. */
const OPEN = /^\/(credits(\/.*)?|billing-status|export\/[^/]+)\/?$/;

/**
 * Pasada la gracia, el admin del comercio queda restringido (#21): 402 en todo menos lo abierto.
 * Root y soporte impersonando no se restringen. El Connector API no pasa por acá.
 */
export function createBillingRestriction(billing: BillingService) {
  return (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.globalRole;
    if (role === 'root' || role === 'support' || OPEN.test(req.path)) {
      next();
      return;
    }
    const summary = billing.summary(req.activeTenantId ?? '');
    if (summary.state === 'restricted') {
      res.status(402).json({ code: 'billing-restricted', error: 'mini contax está restringido por deuda', debt: summary.debt, deadline: summary.deadline });
      return;
    }
    next();
  };
}
```

  - `app.ts`: en la cadena de `/api/tenants/:tenantId`, después de `requireTenantContext`, va
    `createBillingRestriction(billing)` y, entre los routers, `createCreditsRoutes(billing)`.
    Verificar que `req.path` dentro del middleware es relativo al montaje (`/products`); si no,
    comparar contra `req.path.replace(/^\/api\/tenants\/[^/]+/, '')`.

- [ ] **Paso 5: suite completa** → verde. **Commit.**

```bash
git add src test
git commit -m "feat: avisos de créditos y de caja en el pull, restricción por deuda y rutas de Créditos (#21)"
```

---

### Tarea 7: Cliente: solapa Cajas (y adiós a `/api-keys`)

**Archivos:**
- Crear: `src/client/state/registers-state.ts`, `src/client/components/settings/RegistersSection.tsx`
- Borrar: `src/client/components/settings/PosKeysSection.tsx`, `src/server/routes/api-key-routes.ts`
- Modificar: `src/client/state/settings-state.ts` (sacar lo de keys), `src/client/components/settings/SettingsView.tsx`,
  `src/client/components/settings/SettingsTabs.tsx`, `src/server/app.ts`,
  `src/server/tenant/api-key-service.ts` (sacar `listApiKeys` y `revokeApiKey` si no se usan),
  los tests que usan `/api-keys`
- Test: `test/registers-client.test.ts`, `test/settings-client.test.ts`

**Interfaces:**
- Consume: `/pos-registers` y `RegisterItem`.
- Produce en `registers-state.ts`: `registersSignal: Signal<RegisterItem[]>`, `registersLoadingSignal`,
  `createRegisterModalOpenSignal`, `createRegisterFormSignal`, `createRegisterErrorSignal`,
  `revealedKeySignal: Signal<{ registerName: string; rawKey: string } | null>`, y
  `fetchRegisters()`, `openCreateRegisterModal()`, `submitCreateRegister()`, `rotateRegisterKey(item)`,
  `transferRegister(item, deviceId)`, `unbindRegister(item)`, `deactivateRegister(item)`,
  `dismissRevealedKey()`.

- [ ] **Paso 1: test del estado (falla).** `test/registers-client.test.ts`, con el estilo de
  `test/settings-client.test.ts` (mock de `fetch` con `vi.spyOn(globalThis, 'fetch')`, token y
  comercio activos):
  - `fetchRegisters` hace `GET /api/tenants/tienda-test/pos-registers` y llena `registersSignal`;
  - `submitCreateRegister` hace `POST` con `{ name, branch, pointOfSale }` (sucursal en mayúsculas),
    pone `revealedKeySignal` con la key y recarga;
  - con el nombre vacío, `createRegisterErrorSignal` es "Completá todos los campos" y no llama a la API;
  - `rotateRegisterKey` (con `window.confirm` mockeado en `true`) hace `POST …/rotate-key` y revela la key;
  - `transferRegister(item, 'dev-b')` hace `POST …/transfer` con `{ deviceId: 'dev-b' }`;
  - `unbindRegister` y `deactivateRegister` hacen `POST …/unbind` y `DELETE …`, y recargan.

  Correr → FALLA.

- [ ] **Paso 2: el estado.** `src/client/state/registers-state.ts`, con `apiFetch`, `tokenSignal`,
  `effectiveTenantIdSignal` y `showToast` como en `settings-state.ts`; las confirmaciones con
  `window.confirm` (si no hay `window`, `true`), con estos textos:
  - rotar: "¿Generar una key nueva para «{nombre}»? La actual deja de funcionar: hay que cargar la nueva en el POS.";
  - pasar: "¿Pasar «{nombre}» a este equipo? Sus ventas se cobran desde ahora como las de la caja.";
  - desligar: "¿Desligar el equipo de «{nombre}»? El próximo equipo que la use queda ligado.";
  - desactivar: "¿Desactivar «{nombre}»? Su key deja de funcionar."

  Correr → PASA.

- [ ] **Paso 3: la solapa.** `RegistersSection.tsx` reemplaza a `PosKeysSection.tsx` (mismo lugar en
  `SettingsView.tsx`, misma estructura de tarjetas y el mismo modal de "key generada" que hoy, que
  muestra la key una sola vez con un botón de copiar). Cada caja muestra:
  - nombre, `SUCURSAL · Punto de venta`, y una marca *Inactiva* si `!active`;
  - "Equipo: `…últimos 8 caracteres`" y "visto {formatDateTime(lastSeenAt)}", o "Sin equipo todavía";
  - la key activa (`keyPrefix…`);
  - si hay `otherDevices`, una alerta ámbar "Otro equipo usó esta key" con cada equipo (id corto,
    visto por última vez) y el botón **Pasar la caja a este equipo**;
  - botones **Rotar key**, **Desligar equipo** (solo si tiene equipo) y **Desactivar**.

  Encabezado: "Cajas del POS" y una línea "Cada caja se usa desde un solo equipo: si otro equipo usa
  su key, sus ventas se cobran aparte." Botón **Nueva caja** con el modal de alta (nombre, sucursal
  de `settingsBranchesSignal` y punto de venta). En `SettingsTabs.tsx`, la solapa `pos` pasa a
  llamarse "Cajas del POS".

- [ ] **Paso 4: adiós a `/api-keys`.**
  - Borrar `api-key-routes.ts` y su montaje en `app.ts`; sacar de `settings-state.ts` todo lo de
    keys (`apiKeysSignal`, `PosApiKeyItem`, `submitCreateApiKey`, `revokeApiKey`, etc.) y de
    `test/settings-client.test.ts` sus casos (los de cajas viven en `registers-client.test.ts`).
  - En los tests de servidor, reemplazar `` .post(`/api/tenants/${tenantId}/api-keys`) `` por
    `` .post(`/api/tenants/${tenantId}/pos-registers`) `` (la respuesta sigue trayendo `rawKey`):
    `test/catalog-and-branches.test.ts`, `connector-api`, `connector-discrepancies`,
    `connector-push-atomic`, `contract-evolution`, `customer-and-accounts`, `demo-sessions-api`,
    `discrepancies-api`, `e2e-pos-sync-lifecycle`, `notices`, `sales-records`, `stock-and-kardex`,
    `billing-push` y `test/helpers/sales-fixture.ts`. `grep -rn "api-keys" test e2e src` tiene que
    quedar vacío.
  - `test/auth-and-tenants.test.ts`: el caso de listar y revocar pasa a `GET /pos-registers` y
    `DELETE /pos-registers/:registerId` (la caja queda `active: false`).
  - `test/permissions-api.test.ts`: sacar las tres rutas `/api-keys` de `RUTAS` y cambiar los
    casos de member y admin a `/pos-registers`.
  - Si `listApiKeys` y `revokeApiKey` quedan sin uso, borrarlos (el lint de `noUnusedLocals` no los
    marca por ser métodos: buscarlos con `grep`).

- [ ] **Paso 5: suite completa y build.** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → verde.

- [ ] **Paso 6: commit.**

```bash
git add -A src test
git commit -m "feat: solapa Cajas del POS con equipo ligado; se van las rutas de API keys (#21)"
```

---

### Tarea 8: Cliente: Créditos, franja y pantalla restringida

**Archivos:**
- Crear: `src/client/state/credits-state.ts`, `src/client/components/credits/CreditsView.tsx`,
  `src/client/components/credits/CreditsBanner.tsx`, `src/client/components/credits/RestrictedView.tsx`
- Modificar: `src/client/state/navigation-state.ts`, `src/client/state/permissions-state.ts`,
  `src/client/components/shell/Sidebar.tsx`, `src/client/components/shell/AppShell.tsx`,
  `src/client/App.tsx`, `src/client/api/client.ts` (si hace falta exponer el 402)
- Test: `test/credits-client.test.ts`, `test/permissions-client.test.ts`

**Interfaces:**
- Consume: `/credits*`, `/billing-status`, `CreditsResponse`, `ChargesPage`, `CreditMovementItem`,
  `GiftItem`, `BillingStatus`; `downloadExport` de `bulk-state.ts`.
- Produce en `credits-state.ts`:
  - `creditsSignal: Signal<CreditsResponse | null>`, `chargesSignal: Signal<ChargesPage | null>`,
    `movementsSignal`, `giftsSignal`, `creditsTabSignal: Signal<'charges' | 'movements' | 'gifts'>`,
    `chargesRangeSignal: Signal<{ from: string; to: string }>` (por defecto, los últimos 30 días argentinos);
  - `billingStatusSignal: Signal<BillingStatus | null>`;
  - `isRestrictedSignal = computed(() => billingStatusSignal.value?.state === 'restricted' && !isImpersonatingSignal.value)`;
  - `fetchCredits()`, `fetchCharges(page?)`, `fetchMovements()`, `fetchGifts()`, `fetchBillingStatus()`;
  - `whatsappPayUrl(p: { phone: string; tenantName: string }): string` (pura);
  - `markRestrictedFromError(err: unknown): boolean`: si es un `ApiError` 402 con
    `code: 'billing-restricted'`, pone `billingStatusSignal` en `restricted` y devuelve `true`.
- `ActiveNavView` suma `'credits'`.

- [ ] **Paso 1: test del estado (falla).** `test/credits-client.test.ts`:
  - `fetchCredits` llama a `/api/tenants/tienda-test/credits` y llena `creditsSignal`;
  - `fetchCharges(2)` arma `?from=…&to=…&page=2&pageSize=50`;
  - `fetchBillingStatus` llena `billingStatusSignal`; con `state: 'restricted'`,
    `isRestrictedSignal` es `true`, y `false` si se está impersonando (`impersonatedTenantIdSignal`);
  - `markRestrictedFromError(new ApiError(402, '…', { code: 'billing-restricted', debt: 1000, deadline: '2026-10-13' }))`
    devuelve `true` y deja el estado `restricted`; con un `ApiError(500)` devuelve `false`;
  - `whatsappPayUrl({ phone: '+54 9 11 5555-1234', tenantName: 'Kiosco' })` es
    `https://wa.me/5491155551234?text=` + el `encodeURIComponent` de
    "Hola, soy de Kiosco. Ya transferí para cargar saldo en mini contax." (el teléfono queda solo
    con dígitos).
  - En `test/permissions-client.test.ts`: la vista `credits` está permitida para owner y admin, no
    para member.

  Correr → FALLA.

- [ ] **Paso 2: el estado y los permisos.** `credits-state.ts` con `apiFetch` y las firmas de arriba.
  `navigation-state.ts`: `ActiveNavView` suma `'credits'`. `permissions-state.ts`:
  `VIEW_CAPABILITY.credits = 'credits.view'`. Un `effect` recarga `fetchBillingStatus()` al cambiar
  el comercio efectivo y cada 5 minutos (con `setInterval` creado una sola vez si hay `window`).
  Correr → PASA.

- [ ] **Paso 3: el 402 en las vistas.** En los `catch` de los `fetch*` de los stores de dominio no se
  toca nada: el `apiFetch` llama a `markRestrictedFromError` antes de tirar el error. Para no crear
  un ciclo de imports, `client.ts` expone `setOnPaymentRequired(cb: (data: unknown) => void)` (como
  `setOnUnauthorized`) y la llama con un 402; `credits-state.ts` se registra con
  `setOnPaymentRequired((data) => markRestrictedFromError(new ApiError(402, '', data)))`. Test en
  `test/credits-client.test.ts`: un `apiFetch` que recibe 402 deja `isRestrictedSignal` en `true`.

- [ ] **Paso 4: las pantallas.**
  - **`CreditsView.tsx`**:
    - `PageHeader` "Créditos";
    - cuatro `StatCard`: **Saldo pagado** (`formatMoney(paidBalance)`, con la nota "Es tuyo: si dejás
      de usar mini contax, te devolvemos lo que quede"), **Créditos regalados** (con "vence el
      {formatDay}" del próximo), **Deuda** (con "Pagá antes del {formatDay(deadline)}" si hay) y
      **Te alcanza para** ("{daysCovered} días" o "—");
    - un `Card` **Cómo pagar**: alias y CBU con botón Copiar (`navigator.clipboard.writeText` y toast),
      titular de la cuenta, el texto "Transferí el importe que quieras. Cuando lo registremos, se
      acredita como saldo pagado; primero cancela la deuda." y el botón **Avisar por WhatsApp**
      (`whatsappPayUrl`, `target="_blank"`, solo si hay `supportWhatsapp`). Si no hay alias ni CBU:
      "Escribinos por WhatsApp para coordinar el pago";
    - las solapas **Consumo** (rango con dos `Input type="date"`, tabla Día · Caja · Importe ·
      Pagado · Regalado · Deuda, con la caja como "{registerName} · otro equipo" si `deviceId`,
      el total y `Pagination`), **Movimientos** (Fecha · Tipo · Importe · Detalle · Por) y
      **Regalados** (Origen "Bono de alta"/"Otorgado" · Importe · Remanente · Vence · Estado ·
      Otorgó · Motivo);
    - si `isRootOrSupportSignal`, el lugar para `PlatformActionsBar` (tarea 9).
  - **`CreditsBanner.tsx`** (en `AppShell`, debajo de la franja de impersonación), según
    `billingStatusSignal` y el rol:
    - `low` (owner y admin): ámbar, "Te quedan créditos para pocos días." + link **Ver créditos**;
    - `debt`: rojo, "Sin créditos: debés {formatMoney(debt)}. Pagá antes del {formatDay(deadline)} para que mini siga funcionando." + **Cómo pagar**;
      a un member, "mini contax tiene una deuda pendiente: avisale al dueño";
    - `restricted` impersonando: rojo, "Comercio restringido por deuda ({formatMoney(debt)})".
  - **`RestrictedView.tsx`**: tarjeta centrada "mini contax está restringido por deuda", el importe,
    "El POS sigue vendiendo y sincronizando: no perdés ventas.", los botones **Ver créditos y cómo
    pagar** (`navigateTo('credits')`, solo si `canDo('credits.view')`), **Exportar productos** y
    **Exportar clientes** (`downloadExport('products' | 'customers', 'csv')`, solo con `canDo('bulk')`),
    y a un member "Avisale al dueño del comercio para que regularice el pago".
  - **`App.tsx`**: si `isRestrictedSignal` y la vista no es `credits` ni `settings`, se muestra
    `RestrictedView` en lugar de la vista. **`Sidebar.tsx`**: ítem "Créditos" (ícono de billetera)
    debajo de "Ventas & Caja".
  - Celular: las tablas scrollean dentro de su tarjeta; las tarjetas pasan a una columna.

- [ ] **Paso 5: suite completa y build** → verde; `test/brand.test.ts` incluido.

- [ ] **Paso 6: commit.**

```bash
git add src test
git commit -m "feat: pantalla Créditos, franja de saldo y pantalla de comercio restringido (#21)"
```

---

### Tarea 9: Cliente: acciones de plataforma y vista Plataforma

**Archivos:**
- Crear: `src/client/state/platform-state.ts`, `src/client/components/credits/PlatformActionsBar.tsx`,
  `src/client/components/platform/PlatformView.tsx`, `src/client/components/platform/PaymentSheetCard.tsx`,
  `src/client/components/platform/PlatformSettingsCard.tsx`
- Modificar: `src/client/state/navigation-state.ts`, `src/client/state/permissions-state.ts`,
  `src/client/components/shell/Sidebar.tsx`, `src/client/App.tsx`, `src/client/components/credits/CreditsView.tsx`
- Test: `test/platform-client.test.ts`, `test/permissions-client.test.ts`

**Interfaces:**
- Consume: `/api/platform/*`, `SheetResultRow`, `PlatformPaymentItem` y `BillingSettings`. El
  cliente no importa del servidor: el tipo `BillingSettings` se mueve a `src/shared/credits-types.ts`
  como tipo plano, y `settings.ts` lo importa de ahí y declara el esquema como
  `z.object({...}) satisfies z.ZodType<BillingSettings>`.
- Produce en `platform-state.ts`:
  - `registerPayment(input: { day: string; amount: number; info?: string | undefined }): Promise<boolean>`,
    `grantCredits(input: { amount: number; expiresOn: string; reason?: string | undefined })`,
    `voidCredit(creditId: string, reason: string)`, `extendGrace(until: string)`,
    `registerRefund(input: { amount: number; info?: string | undefined })`, `changeHolder(userId: string)`:
    todas sobre el comercio efectivo, con toast y recarga de Créditos; devuelven `true` si salió bien.
  - `sheetTextSignal`, `sheetRowsSignal: Signal<SheetResultRow[] | null>`, `sheetAppliedSignal`,
    `previewSheet()`, `applySheet()`, `loadSheetFile(file: File)`.
  - `platformPaymentsSignal`, `fetchPlatformPayments()`.
  - `platformSettingsSignal`, `fetchPlatformSettings()`, `savePlatformSettings(patch)`.
  - `platformTabSignal: Signal<'payments' | 'settings'>`.
- `ActiveNavView` suma `'platform'`.

- [ ] **Paso 1: test del estado (falla).** `test/platform-client.test.ts` (mock de `fetch`):
  - `registerPayment({ day: '2026-10-05', amount: 5000, info: 'op 1' })` hace
    `POST /api/platform/tenants/tienda-test/payments` con ese body, devuelve `true` y recarga
    `/credits`; con un 400 devuelve `false` y muestra el error en un toast;
  - `grantCredits`, `voidCredit`, `extendGrace`, `registerRefund` y `changeHolder` pegan a sus rutas
    con sus bodies;
  - `previewSheet()` hace `POST /api/platform/payments/import?dryRun=1` con `{ csv }` y llena
    `sheetRowsSignal`; `applySheet()` lo hace sin `dryRun` y pone `sheetAppliedSignal` en `true`;
  - `savePlatformSettings({ pricePerRegisterDay: 1200 })` hace `PUT /api/platform/settings`;
  - en `test/permissions-client.test.ts`: la vista `platform` está permitida para root y support
    (por `currentUserSignal.globalRole`) y no para un owner común.

  Correr → FALLA.

- [ ] **Paso 2: el estado y la navegación.** `platform-state.ts` con las firmas de arriba.
  `ActiveNavView` suma `'platform'`; en `permissions-state.ts`, `VIEW_CAPABILITY` pasa a
  `Record<Exclude<ActiveNavView, 'platform'>, Capability>` e `isViewAllowed` resuelve `platform`
  con `isRootOrSupportSignal.value`. El `effect` que vuelve al dashboard no echa a root de
  `platform`. Correr → PASA.

- [ ] **Paso 3: las pantallas.**
  - **`PlatformActionsBar.tsx`** (en `CreditsView`, solo con `isRootOrSupportSignal`): una franja
    "Acciones de plataforma" con botones que abren un `Modal` cada uno:
    - **Registrar pago**: fecha (hoy argentino por defecto), importe, info;
    - **Otorgar créditos**: importe, vence (por defecto, hoy + 90 días), motivo;
    - **Extender gracia**: nueva fecha límite;
    - **Devolución** (solo root): importe (con el saldo pagado como tope visible), info;
    - **Cambiar titular**: un `Select` con los owners activos (de `GET /users`, filtrando `role: 'owner'`
      y `status: 'active'`);
    - en la solapa Regalados, cada crédito activo suma un botón **Anular** (pide el motivo).
  - **`PlatformView.tsx`** con solapas **Cobranzas** y **Configuración** (esta, solo root):
    - **`PaymentSheetCard.tsx`**: el formato esperado ("fecha;comercio;importe;info", fecha
      DD/MM/AAAA o AAAA-MM-DD, el comercio por su identificador), un `input type="file"` (`.csv`) que
      carga el texto, o un `textarea` para pegarlo; **Vista previa** muestra la tabla de filas (Línea ·
      Comercio · Fecha · Importe · Info · Estado, con "Se registra", "Ya registrado" o el error en
      rojo) y el resumen ("3 para registrar, 1 ya registrado, 1 con error"); **Registrar** aplica y
      muestra el resultado. Debajo, la lista de pagos registrados (`fetchPlatformPayments`).
    - **`PlatformSettingsCard.tsx`**: un formulario con los diez valores (precio por caja y día, bono,
      días del bono, porcentaje pagado como 0–100 %, días de gracia, días del aviso, alias, CBU,
      titular de la cuenta, WhatsApp de soporte) y **Guardar**.
  - **`Sidebar.tsx`**: ítem "Plataforma" al final, solo si `isViewAllowed('platform')`. **`App.tsx`**:
    `currentView === 'platform' && <PlatformView />`. La vista Plataforma no depende de tener un
    comercio activo: en `AppShell`, el estado vacío ("No tienes ningún comercio asociado") no se
    muestra si la vista es `platform`.

- [ ] **Paso 4: suite completa y build** → verde.

- [ ] **Paso 5: commit.**

```bash
git add src test
git commit -m "feat: acciones de plataforma en Créditos y vista Plataforma con planilla y configuración (#21)"
```

---

### Tarea 10: e2e, documentación, issue en offline-pos, versión e informe

**Archivos:**
- Crear: `e2e/credits.spec.ts`
- Modificar: `AGENTS.md`, `docs/superpowers/specs/2026-10-01-mvp-mini-contax-design.md`,
  `deploy/README.md` (si nombra versiones de base), `package.json`

- [ ] **Paso 1: e2e.** `e2e/credits.spec.ts`, con el estilo de `e2e/sales-cash.spec.ts` (servidor del
  e2e en el puerto 4110 y base descartable):
  1. alta de un comercio por la UI de `/alta` (o por `POST /api/alta`, como haga `sales-cash.spec.ts`);
  2. crear una segunda caja con `POST /pos-registers`;
  3. push de una venta en cada caja (`deviceId` distintos), del día de hoy;
  4. pull con un tercer equipo usando la key de la caja 1: la respuesta trae `register:foreign-device`;
  5. en el admin, el owner entra a **Créditos**: ve 2 cargos de hoy en Consumo y el bono en Regalados
     con remanente $48.000.

  `pnpm test:e2e` → verde.

- [ ] **Paso 2: AGENTS.md.**
  - En "Contrato implementado": los avisos del pull suman créditos y caja.
  - En "Arquitectura", una sección **Créditos y cobro** (#21, spec
    `docs/superpowers/specs/2026-10-03-m5-creditos-cobro-design.md`):
    - caja = `registers` (sistema) con equipo ligado; la key es de la caja; otro equipo cobra aparte;
    - el cargo es por `(caja, equipo, sales.day)`, idempotente; nace después del push
      (`BillingService.charge`) y el barrido (`startBillingSweeper`) recupera los que falten;
    - las ventas guardan `register_id` y `charge_device` (comercio v6); las anteriores no cobran;
    - pagado del titular (`paid_movements`), regalados del comercio (`gift_credits`), reparto en
      `billing/allocation.ts`, configuración en `billing/settings.ts` (`billing_settings`, solo root);
    - deuda, gracia y `402 billing-restricted` (`billing-restriction-middleware.ts`); root y soporte
      impersonando no se restringen; el Connector no pasa por ahí;
    - rutas de plataforma en `/api/platform` con `requirePlatformRole`; todo queda en `audit_log`.
  - En "Migraciones": las bases quedan en sistema v5 y comercio v6.
  - En "Estado": M5 hecha.

- [ ] **Paso 3: spec del MVP.** En "Producto" de `2026-10-01-mvp-mini-contax-design.md`, reemplazar
  "reiniciar producción a cero (borrar todo) sigue siendo aceptable. Por eso las etapas no migran
  datos de producción." por "producción tiene datos que no se pueden perder: desde #47, todo cambio
  de esquema es una migración y nunca se reinicia una base." (y ajustar "Reinicio de producción al
  publicarla" de M2 y "Cuentas de prueba en producción" si contradicen).

- [ ] **Paso 4: issue en offline-pos.** Pedirle al usuario el OK y crear el issue con `gh issue create
  --repo rauldiazsolis/offline-pos` (etiquetas `feature:contrato` y `backlog` si existen allá):
  "Avisos `critical` y de caja del backend: cómo los muestra el POS". Cuerpo: mini contax (M5,
  rauldiazsolis/mini-erp#21) manda en el pull `credits:low` (`warning`), `credits:debt` y
  `credits:restricted` (`critical`), `register:foreign-device` y `register:shared-key` (`warning`,
  con `ref: { type: 'register' }`); hoy el POS los cuenta en "Avisos (N)" sin distinguir severidad;
  proponer destacar los `critical` en la barra de estado (sin bloquear nada, como dice el contrato) y
  decidir si `ref.type: register` merece un texto o una acción; el contrato no cambia.

- [ ] **Paso 5: versión.** `pnpm version minor --no-git-tag-version` → `0.7.0`. Suite completa,
  build y e2e en verde.

- [ ] **Paso 6: commit.**

```bash
git add -A
git commit -m "docs: créditos y cobro en AGENTS.md, e2e de M5 y versión 0.7.0 (#21)"
```

- [ ] **Paso 7: informe con la prueba manual en checklist**, con acción y verificación precisa por
  paso. Cubre el criterio de aceptación de #21 contra `pnpm dev`:
  - el bono de un comercio nuevo;
  - dos cajas que venden el mismo día y dos cargos;
  - una venta offline del día anterior;
  - un tercer equipo con la key (aviso en el POS y "Otro equipo" en Cajas, y pasarle la caja);
  - registrar un pago y ver el reparto 50/50 del cargo siguiente;
  - la planilla con una fila repetida;
  - llevar el comercio a deuda y a restringido (bajando el bono con "Anular" y la gracia a 0 en
    Configuración) y ver que el POS sigue sincronizando.

  Después, con el OK del usuario: push de la rama y el PR con "Closes #21", merge commit.
