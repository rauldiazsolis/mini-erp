# M4 · Ventas y caja: plan de implementación

> **Para agentes:** se ejecuta con `superpowers:executing-plans`, **tarea por tarea en esta misma
> conversación** (AGENTS.md: nunca un subagente por tarea). Al terminar cada tarea: verificar, commitear
> y frenar para que el usuario la revise. Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** la sección "Ventas & Caja" del admin. Tiene:
- ventas con filtros y el detalle del ticket;
- cobranzas y movimientos de caja;
- el resumen por caja y por día, que cuadra con el `/RESUMEN` del POS;
- el drill-down desde el dashboard.

**Arquitectura:**
- Una migración de comercio v5 suma columnas derivadas del payload (`day`, cliente, número de ticket
  o recibo) que completa un único módulo de escritura (`sales/records.ts`). Lo usan el push, la
  cobranza del admin y la semilla.
- Un servicio de consultas de comercio (`SalesQueryService`) pagina en SQL y arma los resúmenes con
  una copia fiel de `calculateDaySummary` del POS.
- El día es siempre el argentino (`src/shared/argentina-day.ts`, compartido con el cliente). El
  dashboard pasa a usarlo y a contar las anulaciones como el POS.

**Stack:** Node 24, `node:sqlite`, Express 4, Zod 3, Hardwired, Preact y signals, Tailwind 4, Vitest
y supertest, Playwright. Sin dependencias nuevas.

**Spec:** [`docs/superpowers/specs/2026-10-02-m4-ventas-caja-design.md`](../specs/2026-10-02-m4-ventas-caja-design.md)

## Restricciones globales

- Todo en español: código, comentarios, mensajes y commits.
- TypeScript estricto:
  - sin `any` y sin `!`;
  - `as` solo para filas de SQLite (`as { … }` / `as unknown as Row[]`), como el resto del repo;
  - `unknown` se valida con Zod;
  - sin parameter properties, `enum` ni `namespace`.
- Imports relativos con `.ts` o `.tsx`. Los tipos y funciones que comparten servidor y cliente van en
  `src/shared/` (TS puro).
- Opcionales: las entradas son `x?: T | undefined`; en los resultados, la propiedad se omite
  (`...(x === undefined ? {} : { x })`).
- Cliente: solo signals, sin hooks.
- **Nunca `new Service()` para un servicio de comercio**: van por `req.tenantScope.use(def)`.
- **Esquema**: la migración nueva es `migrations/tenant/v5-ventas-y-caja.ts`, al final de
  `TENANT_SCHEMA.migrations`, con su test desde una base v4 con datos. La línea de base no se toca.
- **El día argentino** sale siempre de `src/shared/argentina-day.ts` (TS) o de
  `date(x, '-3 hours')` (SQL). Nunca de `new Date().getDate()` ni de la hora del servidor.
- **Fechas, horas e importes nuevos del cliente** pasan por `src/client/format.ts`, con el locale del
  navegador (#51).
- TDD: el test primero, se ve fallar, después el código mínimo.
- Antes de cada commit, en PowerShell: `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }`.
  Si se toca el cliente, también `pnpm build`. Si se toca el Connector API, también `pnpm test:e2e`.
- Commits convencionales en español, terminados en
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Valores fijos:

  | Qué | Valor |
  |---|---|
  | Zona del día | UTC−3 fijo |
  | Página por defecto y máxima | 50 / 200 |
  | Rango máximo | 366 días (inclusive) |
  | Caja de la cobranza del admin | `deviceId` `admin_panel`, `branch` `ADMIN`, `pointOfSale` `Oficina` (se muestra "Admin") |
  | Medios del contrato | `cash`, `debit`, `credit`, `transfer`, `qr`, `account`; cualquier otro es `other` ("Otro") |
  | Versión | 0.6.0 |

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `src/shared/argentina-day.ts` (nuevo) | `argentinaDay`, `argentinaHour`, `argentinaToday`, `shiftDay`, `daysBetween`, `pickDay`, `DAY_PATTERN` |
| `src/shared/payment-methods.ts` (nuevo) | `PAYMENT_METHODS`, `isPaymentMethod`, `methodKey`, tipos `PaymentMethod` y `MethodKey` |
| `src/shared/sales-types.ts` (nuevo) | Tipos de la API de Ventas & Caja (los usan el servicio y el cliente) |
| `src/server/db/migrations/tenant/v5-ventas-y-caja.ts` (nuevo) | Columnas derivadas, normalización de cobranzas del admin e índices |
| `src/server/db/migrations/tenant.ts` | Agrega v5 a la lista |
| `src/server/sales/records.ts` (nuevo) | `saveSale`, `saveCustomerPayment`, `saveCashMovement`: escriben payload y columnas |
| `src/server/sales/stored-documents.ts` (nuevo) | Lectura tolerante de los payloads guardados |
| `src/server/sales/day-summary.ts` (nuevo) | Copia de `calculateDaySummary` del POS |
| `src/server/sales/sales-query-service.ts` (nuevo) | `SalesQueryService`: listas, detalle, cajas y resúmenes |
| `src/server/routes/sales-routes.ts` (nuevo) | Rutas y esquemas Zod de la consulta |
| `src/server/connector/push-events.ts` | `createdAt` y `receipt` en los esquemas que se leen |
| `src/server/connector/connector-service.ts` | El push escribe con `records.ts` |
| `src/server/customer/customer-service.ts` | `registerPayment` con forma de contrato |
| `src/server/seeds/demo-activity-generator.ts` | Historial con forma de contrato |
| `src/server/dashboard/dashboard-service.ts` | Día argentino, neteo y vigentes |
| `src/server/di/container.ts`, `src/server/app.ts` | `salesQueryServiceDef`, reloj del dashboard y montaje de rutas |
| `src/client/format.ts` (nuevo) | `formatMoney`, `formatDay`, `formatDateTime`, `formatTime` |
| `src/client/state/sales-labels.ts` (nuevo) | Etiquetas de medios, cajas y tipos |
| `src/client/state/sales-state.ts` (nuevo) | Filtros, carga, drawers y drill-down |
| `src/client/state/navigation-state.ts`, `permissions-state.ts` | Vista `'sales'` |
| `src/client/components/sales/*.tsx` (nuevos) | La sección y sus solapas y drawers |
| `src/client/components/ui/Pagination.tsx` (nuevo) | "Anterior / Siguiente · 1–50 de N" |
| `src/client/components/shell/Sidebar.tsx`, `src/client/App.tsx` | Ítem de menú y vista |
| `src/client/components/dashboard/*.tsx` | Drill-down |
| `e2e/sales-cash.spec.ts` (nuevo) | Criterio de aceptación de #20 |

---

### Tarea 1: día argentino y migración v5

**Archivos:**
- Crear: `src/shared/argentina-day.ts`, `src/server/db/migrations/tenant/v5-ventas-y-caja.ts`.
- Modificar: `src/server/db/migrations/tenant.ts`, `test/tenant-migration-v3-v4.test.ts`.
- Test: `test/argentina-day.test.ts`, `test/tenant-migration-v5.test.ts` (nuevos).

**Interfaces:**
- Produce: `argentinaDay(iso: string): string | null`, `argentinaHour(iso: string): number | null`,
  `argentinaToday(now: Date): string`, `shiftDay(day: string, delta: number): string`,
  `daysBetween(from: string, to: string): number`,
  `pickDay(numbered: unknown, instants: ReadonlyArray<string | null | undefined>): string | null` y
  `DAY_PATTERN`. Columnas nuevas:
  - `sales`: `day`, `customer_id`, `ticket_date` y `ticket_number`;
  - `customer_payments`: `day`, `receipt_date` y `receipt_number`;
  - `cash_movements`: `day`.

- [ ] **Paso 1: escribir los tests que fallan**

`test/argentina-day.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  argentinaDay, argentinaHour, argentinaToday, shiftDay, daysBetween, pickDay,
} from '../src/shared/argentina-day.ts';

describe('día argentino (#20)', () => {
  const db = new DatabaseSync(':memory:');

  it.each([
    ['2026-10-02T02:59:59.999Z', '2026-10-01'],
    ['2026-10-02T03:00:00.000Z', '2026-10-02'],
    ['2026-10-02T12:00:00.000Z', '2026-10-02'],
    ['2026-10-01T23:30:00-03:00', '2026-10-01'],
    ['2026-01-01T01:00:00.000Z', '2025-12-31'],
  ])('%s → %s, igual que date(x, "-3 hours") de SQLite', (iso, day) => {
    expect(argentinaDay(iso)).toBe(day);
    expect(db.prepare("SELECT date(?, '-3 hours') AS d").get(iso)).toEqual({ d: day });
  });

  it('un instante inválido no tiene día', () => {
    expect(argentinaDay('cualquier cosa')).toBeNull();
    expect(argentinaHour('cualquier cosa')).toBeNull();
  });

  it('hora argentina, hoy, desplazar y contar días', () => {
    expect(argentinaHour('2026-10-02T02:30:00.000Z')).toBe(23);
    expect(argentinaToday(new Date('2026-10-02T01:00:00.000Z'))).toBe('2026-10-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });

  it('pickDay: la fecha numerada manda; si no, el primer instante válido', () => {
    expect(pickDay('2026-09-24', ['2026-09-25T12:00:00.000Z'])).toBe('2026-09-24');
    expect(pickDay(undefined, [undefined, 'x', '2026-09-25T02:00:00.000Z'])).toBe('2026-09-24');
    expect(pickDay('24/09', ['2026-09-25T12:00:00.000Z'])).toBe('2026-09-25');
    expect(pickDay(undefined, [])).toBeNull();
  });
});
```

`test/tenant-migration-v5.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { migrateDb, readVersion } from '../src/server/db/migrations/migrate.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { createDbAtVersion } from './helpers/db-at-version.ts';

const at = '2026-10-02T12:00:00.000Z';

describe('comercio v5: ventas y caja (#20)', () => {
  it('una base v4 con datos pasa a v5 con columnas derivadas, cobranzas del admin normalizadas e índices', () => {
    const db = createDbAtVersion(TENANT_SCHEMA, 4);
    db.prepare('INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('c1', 'Ana', at, at);
    const venta = db.prepare(
      'INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    // Numerada antes de la medianoche, con createdAt del día siguiente: manda ticket.date
    venta.run('v1', JSON.stringify({ id: 'v1', total: 100, customerId: 'c1', createdAt: '2026-10-02T03:10:00.000Z', ticket: { date: '2026-10-01', number: 7 }, payments: [{ method: 'cash', amount: 100 }], lines: [] }), 'dev', 'CENTRAL', 'Caja 1', 100, null, at);
    // Sin ticket: el createdAt del payload, a las 23:30 argentinas
    venta.run('v2', JSON.stringify({ id: 'v2', total: -100, voidsSaleId: 'v1', createdAt: '2026-10-03T02:30:00.000Z', payments: [], lines: [] }), 'dev', 'CENTRAL', 'Caja 1', -100, 'v1', at);
    // Sin createdAt en el payload: el de la fila
    venta.run('v3', JSON.stringify({ id: 'v3', total: 50, payments: [], lines: [] }), 'dev', 'CENTRAL', null, 50, null, '2026-10-02T01:00:00.000Z');
    // Payload roto: el de la fila, sin tumbar la migración
    venta.run('v4', 'no es json', 'dev', 'CENTRAL', 'Caja 1', 10, null, at);

    const cobranza = db.prepare(
      'INSERT INTO customer_payments (id, customer_id, payload, device_id, branch, point_of_sale, voids_payment_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const delPos = { id: 'p1', customerId: 'c1', payments: [{ method: 'cash', amount: 700 }], total: 700, createdAt: '2026-10-02T03:30:00.000Z', receipt: { date: '2026-10-01', number: 3 } };
    cobranza.run('p1', 'c1', JSON.stringify(delPos), 'dev', 'CENTRAL', 'Caja 1', null, at);
    // Las dos formas que escribía registerPayment
    cobranza.run('p2', 'c1', JSON.stringify({ id: 'p2', customerId: 'c1', total: 500, method: 'transfer', reference: 'op-1' }), 'admin_panel', 'ADMIN', 'Oficina', null, at);
    cobranza.run('p3', 'c1', JSON.stringify({ id: 'p3', customerId: 'c1', total: 300, method: 'cash', reference: null }), 'admin_panel', 'ADMIN', 'Oficina', null, at);

    const caja = db.prepare('INSERT INTO cash_movements (id, payload, device_id, branch, point_of_sale, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    caja.run('m1', JSON.stringify({ id: 'm1', direction: 'in', amount: 2000, concept: 'Fondo', source: 'manual', createdAt: '2026-10-02T02:00:00.000Z' }), 'dev', 'CENTRAL', 'Caja 1', at);
    caja.run('m2', JSON.stringify({ id: 'm2', type: 'float-in', amount: 15000, timestamp: at }), 'dev', 'CENTRAL', 'Caja 1', at);

    expect(migrateDb(db, TENANT_SCHEMA)).toEqual({ from: 4, to: 5, applied: ['v5 ventas-y-caja'] });
    expect(readVersion(db)).toBe(5);

    expect(db.prepare('SELECT id, day, customer_id, ticket_date, ticket_number FROM sales ORDER BY id').all()).toEqual([
      { id: 'v1', day: '2026-10-01', customer_id: 'c1', ticket_date: '2026-10-01', ticket_number: 7 },
      { id: 'v2', day: '2026-10-02', customer_id: null, ticket_date: null, ticket_number: null },
      { id: 'v3', day: '2026-10-01', customer_id: null, ticket_date: null, ticket_number: null },
      { id: 'v4', day: '2026-10-02', customer_id: null, ticket_date: null, ticket_number: null },
    ]);

    const pagos = db.prepare('SELECT id, payload, day, receipt_date, receipt_number FROM customer_payments ORDER BY id').all() as {
      id: string; payload: string; day: string; receipt_date: string | null; receipt_number: number | null;
    }[];
    expect(pagos.map(({ id, day, receipt_date, receipt_number }) => ({ id, day, receipt_date, receipt_number }))).toEqual([
      { id: 'p1', day: '2026-10-01', receipt_date: '2026-10-01', receipt_number: 3 },
      { id: 'p2', day: '2026-10-02', receipt_date: null, receipt_number: null },
      { id: 'p3', day: '2026-10-02', receipt_date: null, receipt_number: null },
    ]);
    expect(JSON.parse(pagos[0]?.payload ?? '')).toEqual(delPos);
    expect(JSON.parse(pagos[1]?.payload ?? '')).toEqual({
      id: 'p2', customerId: 'c1', payments: [{ method: 'transfer', amount: 500, reference: 'op-1' }], total: 500, createdAt: at,
    });
    expect(JSON.parse(pagos[2]?.payload ?? '')).toEqual({
      id: 'p3', customerId: 'c1', payments: [{ method: 'cash', amount: 300 }], total: 300, createdAt: at,
    });

    expect(db.prepare('SELECT id, day FROM cash_movements ORDER BY id').all()).toEqual([
      { id: 'm1', day: '2026-10-01' },
      { id: 'm2', day: '2026-10-02' },
    ]);

    const indices = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_sales_day', 'idx_sales_customer', 'idx_customer_payments_day', 'idx_cash_movements_day') ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    expect(indices).toEqual(['idx_cash_movements_day', 'idx_customer_payments_day', 'idx_sales_customer', 'idx_sales_day']);
  });
});
```

- [ ] **Paso 2: correrlos y verlos fallar**

Correr `pnpm vitest run test/argentina-day.test.ts test/tenant-migration-v5.test.ts`.
Esperado: FAIL. No existe `src/shared/argentina-day.ts` y la migración da `to: 4`.

- [ ] **Paso 3: implementar el día argentino**

`src/shared/argentina-day.ts`:

```typescript
/**
 * El día de un comercio es el día argentino (#20): UTC−3 fijo (Argentina no tiene horario de
 * verano). Lo usan el push, las consultas de Ventas & Caja, el dashboard y el cliente. En SQL, el
 * equivalente es `date(x, '-3 hours')`; un test verifica que los dos dan lo mismo.
 */
const OFFSET_MS = 3 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function argentinaDay(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms - OFFSET_MS).toISOString().slice(0, 10);
}

export function argentinaHour(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms - OFFSET_MS).getUTCHours();
}

export function argentinaToday(now: Date): string {
  return new Date(now.getTime() - OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * ONE_DAY_MS).toISOString().slice(0, 10);
}

/** Días de `from` a `to` (0 si son el mismo). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / ONE_DAY_MS);
}

/**
 * El día de un documento, como lo agrupa el `/RESUMEN` del POS: su fecha numerada (`ticket.date`,
 * `receipt.date`) si es válida; si no, el día argentino del primer instante válido.
 */
export function pickDay(numbered: unknown, instants: ReadonlyArray<string | null | undefined>): string | null {
  if (typeof numbered === 'string' && DAY_PATTERN.test(numbered)) {
    return numbered;
  }
  for (const iso of instants) {
    const day = iso === undefined || iso === null ? null : argentinaDay(iso);
    if (day !== null) {
      return day;
    }
  }
  return null;
}
```

- [ ] **Paso 4: implementar la migración**

`src/server/db/migrations/tenant/v5-ventas-y-caja.ts`:

```typescript
import type { Migration } from '../types.ts';

/** Una fecha numerada (`ticket.date`, `receipt.date`) válida, o NULL. */
const numberedDate = (path: string): string =>
  `CASE WHEN json_extract(payload, '${path}') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN json_extract(payload, '${path}') END`;

/** El día argentino del `createdAt` del payload o, si no hay, del de la fila. */
const instantDay = `COALESCE(date(json_extract(payload, '$.createdAt'), '-3 hours'), date(created_at, '-3 hours'))`;

/**
 * Ventas y caja (#20): columnas derivadas del payload para filtrar y agrupar con SQL (el día
 * argentino como el `/RESUMEN` del POS, el cliente de la venta, los números de ticket y de recibo),
 * las cobranzas del admin con la forma del contrato e índices. El payload sigue siendo la fuente.
 * Un payload que no es JSON no tumba la migración: su día sale de `created_at`.
 */
export const v5VentasYCaja: Migration = {
  version: 5,
  name: 'ventas-y-caja',
  up: (db) => {
    db.exec(`
ALTER TABLE sales ADD COLUMN day TEXT;
ALTER TABLE sales ADD COLUMN customer_id TEXT;
ALTER TABLE sales ADD COLUMN ticket_date TEXT;
ALTER TABLE sales ADD COLUMN ticket_number INTEGER;
UPDATE sales SET
  customer_id = json_extract(payload, '$.customerId'),
  ticket_date = ${numberedDate('$.ticket.date')},
  ticket_number = json_extract(payload, '$.ticket.number'),
  day = COALESCE(${numberedDate('$.ticket.date')}, ${instantDay})
WHERE json_valid(payload);
UPDATE sales SET day = date(created_at, '-3 hours') WHERE day IS NULL;

ALTER TABLE customer_payments ADD COLUMN day TEXT;
ALTER TABLE customer_payments ADD COLUMN receipt_date TEXT;
ALTER TABLE customer_payments ADD COLUMN receipt_number INTEGER;
UPDATE customer_payments SET payload = json_object(
  'id', id,
  'customerId', customer_id,
  'payments', json_array(
    CASE WHEN json_extract(payload, '$.reference') IS NULL
      THEN json_object('method', COALESCE(json_extract(payload, '$.method'), 'cash'), 'amount', json_extract(payload, '$.total'))
      ELSE json_object('method', COALESCE(json_extract(payload, '$.method'), 'cash'), 'amount', json_extract(payload, '$.total'), 'reference', json_extract(payload, '$.reference'))
    END),
  'total', json_extract(payload, '$.total'),
  'createdAt', created_at)
WHERE json_valid(payload) AND json_type(payload, '$.payments') IS NULL AND device_id = 'admin_panel';
UPDATE customer_payments SET
  receipt_date = ${numberedDate('$.receipt.date')},
  receipt_number = json_extract(payload, '$.receipt.number'),
  day = COALESCE(${numberedDate('$.receipt.date')}, ${instantDay})
WHERE json_valid(payload);
UPDATE customer_payments SET day = date(created_at, '-3 hours') WHERE day IS NULL;

ALTER TABLE cash_movements ADD COLUMN day TEXT;
UPDATE cash_movements SET day = ${instantDay} WHERE json_valid(payload);
UPDATE cash_movements SET day = date(created_at, '-3 hours') WHERE day IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_day ON sales (day, branch, point_of_sale);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_day ON customer_payments (day, branch, point_of_sale);
CREATE INDEX IF NOT EXISTS idx_cash_movements_day ON cash_movements (day, branch, point_of_sale);
`);
  },
};
```

> Solo se normalizan las cobranzas del admin (`device_id = 'admin_panel'`) sin `payments`: lo que
> mandó el POS no se reescribe nunca.

En `src/server/db/migrations/tenant.ts`, sumar el import
`import { v5VentasYCaja } from './tenant/v5-ventas-y-caja.ts';` y dejar
`migrations: [v2Indices, v3AnulacionCobranzas, v4Discrepancias, v5VentasYCaja],`.

En `test/tenant-migration-v3-v4.test.ts`, la migración ahora llega a la última versión:

```typescript
    expect(migrateDb(db, TENANT_SCHEMA)).toEqual({
      from: 2, to: 5, applied: ['v3 anulacion-cobranzas', 'v4 discrepancias', 'v5 ventas-y-caja'],
    });
    expect(readVersion(db)).toBe(5);
```

- [ ] **Paso 5: correr los tests y verlos pasar**

Correr `pnpm vitest run test/argentina-day.test.ts test/tenant-migration-v5.test.ts test/tenant-migration-v3-v4.test.ts test/migrations.test.ts test/run-migrations.test.ts`.
Esperado: PASS.

- [ ] **Paso 6: suite completa y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/shared/argentina-day.ts src/server/db/migrations/tenant.ts src/server/db/migrations/tenant/v5-ventas-y-caja.ts test/argentina-day.test.ts test/tenant-migration-v5.test.ts test/tenant-migration-v3-v4.test.ts
git commit -m "feat: día argentino y migración de comercio v5 de ventas y caja (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar para la revisión.

---

### Tarea 2: escritura con columnas (push, cobranza del admin y semilla)

**Archivos:**
- Crear: `src/server/sales/records.ts`.
- Modificar: `src/server/connector/push-events.ts`, `src/server/connector/connector-service.ts`
  (`applyEvent`, casos `sale`, `cash-movement` y `customer-payment`),
  `src/server/customer/customer-service.ts` (`registerPayment`),
  `src/server/seeds/demo-activity-generator.ts`.
- Test: `test/sales-records.test.ts` (nuevo).

**Interfaces:**
- Consume: `pickDay`, `argentinaToday`, `shiftDay` (Tarea 1).
- Produce:
  - `type DocumentOrigin = { deviceId: string | null; branch: string | null; pointOfSale: string | null }`;
  - `saveSale(db, sale: SaleRecord, origin: DocumentOrigin, receivedAt: string): void` (upsert);
  - `saveCustomerPayment(db, payment: CustomerPaymentRecord, origin, receivedAt): boolean` (`true` si
    la insertó);
  - `saveCashMovement(db, movement: CashMovementRecord, origin, receivedAt): void` (upsert);
  - `generateHistoricalDemoActivity(db, branchId, now = new Date())`.

- [ ] **Paso 1: escribir el test que falla**

`test/sales-records.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { generateHistoricalDemoActivity } from '../src/server/seeds/demo-activity-generator.ts';
import { argentinaToday } from '../src/shared/argentina-day.ts';

const origin = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };

describe('escritura de ventas, cobranzas y movimientos con columnas (#20)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let tenantManager: TenantManager;
  let token: string;
  let apiKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const owner = bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    token = owner.token;
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    const key = await request(app)
      .post(`/api/tenants/${tenantId}/api-keys`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    apiKey = (key.body as { rawKey: string }).rawKey;
  });

  const db = (): DatabaseSync => tenantManager.getTenantDb(tenantId);
  const push = (lotId: string, events: unknown[]) =>
    request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId: 'dev-1', events });

  it('el push completa día, cliente y números', async () => {
    await push('l1', [
      { id: 'e0', type: 'customer', createdAt: '2026-10-01T12:00:00.000Z', origin, customer: { id: 'c1', name: 'Ana' } },
      {
        id: 'e1', type: 'sale', createdAt: '2026-10-02T03:10:00.000Z', origin,
        sale: { id: 'v1', status: 'closed', total: 100, customerId: 'c1', createdAt: '2026-10-02T03:10:00.000Z', ticket: { date: '2026-10-01', number: 7 }, lines: [], payments: [{ method: 'cash', amount: 100 }] },
      },
      {
        id: 'e2', type: 'customer-payment', createdAt: '2026-10-01T15:00:00.000Z', origin,
        payment: { id: 'p1', customerId: 'c1', total: 50, createdAt: '2026-10-01T15:00:00.000Z', receipt: { date: '2026-10-01', number: 2 }, payments: [{ method: 'cash', amount: 50 }] },
      },
      {
        id: 'e3', type: 'cash-movement', createdAt: '2026-10-02T02:00:00.000Z', origin,
        movement: { id: 'm1', direction: 'in', amount: 10, concept: 'Fondo', source: 'manual', createdAt: '2026-10-02T02:00:00.000Z' },
      },
    ]);
    expect(db().prepare('SELECT day, customer_id, ticket_date, ticket_number FROM sales').get()).toEqual({
      day: '2026-10-01', customer_id: 'c1', ticket_date: '2026-10-01', ticket_number: 7,
    });
    expect(db().prepare('SELECT day, receipt_date, receipt_number FROM customer_payments').get()).toEqual({
      day: '2026-10-01', receipt_date: '2026-10-01', receipt_number: 2,
    });
    expect(db().prepare('SELECT day FROM cash_movements').get()).toEqual({ day: '2026-10-01' });
  });

  it('la cobranza del admin se guarda con la forma del contrato', async () => {
    await push('l1', [{ id: 'e0', type: 'customer', createdAt: '2026-10-01T12:00:00.000Z', origin, customer: { id: 'c1', name: 'Ana' } }]);
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/customers/c1/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 300, method: 'transfer', reference: 'op-9' });
    expect(res.status).toBe(200);
    const row = db().prepare('SELECT payload, day, device_id, branch, point_of_sale FROM customer_payments').get() as {
      payload: string; day: string; device_id: string; branch: string; point_of_sale: string;
    };
    expect(row).toMatchObject({ day: argentinaToday(new Date()), device_id: 'admin_panel', branch: 'ADMIN', point_of_sale: 'Oficina' });
    expect(JSON.parse(row.payload)).toMatchObject({
      customerId: 'c1', total: 300, payments: [{ method: 'transfer', amount: 300, reference: 'op-9' }],
    });
  });
});

describe('semilla de actividad con forma de contrato (#20)', () => {
  it('ventas numeradas, una anulación, una cobranza y movimientos del contrato; nada después de ahora', () => {
    const db = new DatabaseSync(':memory:');
    initTenantDb(db);
    const now = new Date('2026-10-02T21:00:00.000Z'); // 18:00 argentinas
    db.prepare("INSERT INTO branches (id, name, code, created_at) VALUES ('b1', 'Central', 'CENTRAL', ?)").run(now.toISOString());
    db.prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p1', 'S1', 'Alfajor', 500, ?, ?)").run(now.toISOString(), now.toISOString());
    db.prepare("INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES ('p1', 'b1', 100, ?)").run(now.toISOString());
    db.prepare("INSERT INTO customers (id, name, balance, created_at, updated_at) VALUES ('cust-juan', 'Juan', 0, ?, ?)").run(now.toISOString(), now.toISOString());

    generateHistoricalDemoActivity(db, 'b1', now);

    const ventas = db.prepare('SELECT payload, day, ticket_number, voids_sale_id, created_at FROM sales').all() as {
      payload: string; day: string | null; ticket_number: number | null; voids_sale_id: string | null; created_at: string;
    }[];
    expect(ventas.length).toBeGreaterThan(0);
    expect(ventas.every((v) => v.day !== null && v.ticket_number !== null)).toBe(true);
    expect(ventas.every((v) => v.created_at <= now.toISOString())).toBe(true);
    expect(ventas.filter((v) => v.voids_sale_id !== null)).toHaveLength(1);

    const cobranzas = db.prepare('SELECT payload FROM customer_payments').all() as { payload: string }[];
    expect(cobranzas).toHaveLength(1);
    expect(JSON.parse(cobranzas[0]?.payload ?? '')).toMatchObject({ customerId: 'cust-juan', payments: [{ method: 'cash' }] });

    const movimientos = (db.prepare('SELECT payload FROM cash_movements').all() as { payload: string }[]).map(
      (m) => JSON.parse(m.payload) as { direction?: string; concept?: string; source?: string },
    );
    expect(movimientos.length).toBeGreaterThan(0);
    expect(movimientos.every((m) => (m.direction === 'in' || m.direction === 'out') && typeof m.concept === 'string' && typeof m.source === 'string')).toBe(true);
    expect(movimientos.some((m) => m.source === 'count-adjustment')).toBe(true);
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/sales-records.test.ts`. Esperado: FAIL. Faltan las columnas
completadas, el payload del admin no tiene `payments`, la semilla no tiene anulación y
`generateHistoricalDemoActivity` no recibe `now`.

- [ ] **Paso 3: el módulo de escritura**

`src/server/sales/records.ts`:

```typescript
import type { DatabaseSync } from 'node:sqlite';
import { pickDay } from '../../shared/argentina-day.ts';

/**
 * Escritura de ventas, cobranzas y movimientos de caja (#20): el payload completo y las columnas
 * derivadas (día argentino, cliente y números) en un solo lugar. Lo usan el push, la cobranza del
 * admin y la semilla. La migración v5 aplica las mismas reglas en SQL.
 */

/** De dónde viene un documento: el equipo y la caja (sucursal + punto de venta del `origin`). */
export type DocumentOrigin = { deviceId: string | null; branch: string | null; pointOfSale: string | null };

type Numbered = { date: string; number: number };

export type SaleRecord = {
  id: string;
  total: number;
  customerId?: string | undefined;
  voidsSaleId?: string | undefined;
  ticket?: Numbered | undefined;
  createdAt?: string | undefined;
  [key: string]: unknown;
};

export type CustomerPaymentRecord = {
  id: string;
  customerId: string;
  total: number;
  voidsPaymentId?: string | undefined;
  receipt?: Numbered | undefined;
  createdAt?: string | undefined;
  [key: string]: unknown;
};

export type CashMovementRecord = { id: string; createdAt?: string | undefined; [key: string]: unknown };

/** `receivedAt` es el `created_at` de la fila: el `createdAt` del evento o, sin él, el momento del push. */
export function saveSale(db: DatabaseSync, sale: SaleRecord, origin: DocumentOrigin, receivedAt: string): void {
  db.prepare(
    `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at, day, customer_id, ticket_date, ticket_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       day = excluded.day,
       customer_id = excluded.customer_id,
       ticket_date = excluded.ticket_date,
       ticket_number = excluded.ticket_number`,
  ).run(
    sale.id,
    JSON.stringify(sale),
    origin.deviceId,
    origin.branch,
    origin.pointOfSale,
    sale.total,
    sale.voidsSaleId ?? null,
    receivedAt,
    pickDay(sale.ticket?.date, [sale.createdAt, receivedAt]),
    sale.customerId ?? null,
    sale.ticket?.date ?? null,
    sale.ticket?.number ?? null,
  );
}

/** Una cobranza nunca se reescribe: devuelve `false` si ya estaba. */
export function saveCustomerPayment(
  db: DatabaseSync,
  payment: CustomerPaymentRecord,
  origin: DocumentOrigin,
  receivedAt: string,
): boolean {
  const result = db
    .prepare(
      `INSERT INTO customer_payments (id, customer_id, payload, device_id, branch, point_of_sale, voids_payment_id, created_at, day, receipt_date, receipt_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(
      payment.id,
      payment.customerId,
      JSON.stringify(payment),
      origin.deviceId,
      origin.branch,
      origin.pointOfSale,
      payment.voidsPaymentId ?? null,
      receivedAt,
      pickDay(payment.receipt?.date, [payment.createdAt, receivedAt]),
      payment.receipt?.date ?? null,
      payment.receipt?.number ?? null,
    );
  return result.changes > 0;
}

export function saveCashMovement(
  db: DatabaseSync,
  movement: CashMovementRecord,
  origin: DocumentOrigin,
  receivedAt: string,
): void {
  db.prepare(
    `INSERT INTO cash_movements (id, payload, device_id, branch, point_of_sale, created_at, day)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, day = excluded.day`,
  ).run(
    movement.id,
    JSON.stringify(movement),
    origin.deviceId,
    origin.branch,
    origin.pointOfSale,
    receivedAt,
    pickDay(undefined, [movement.createdAt, receivedAt]),
  );
}
```

- [ ] **Paso 4: el push escribe con `records.ts`**

En `src/server/connector/push-events.ts`, sumar lo que ahora se lee:

```typescript
const numberedSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), number: z.number().int().min(1) });
```

- En `saleSchema`: `ticket: numberedSchema.optional()` en lugar del objeto inline, más
  `createdAt: z.string().optional()`.
- En `cashMovementSchema`: `z.object({ id: z.string().min(1), createdAt: z.string().optional() }).passthrough()`.
- En `customerPaymentSchema`: `createdAt: z.string().optional()` y `receipt: numberedSchema.optional()`.

En `src/server/connector/connector-service.ts`, importar
`import { saveCashMovement, saveCustomerPayment, saveSale } from '../sales/records.ts';` y, dentro de
`applyEvent`, construir el origen una vez, después de `where`:

```typescript
    const docOrigin = { deviceId, branch: originBranch, pointOfSale: originPos };
    const receivedAt = event.createdAt ?? now;
```

Reemplazar los tres `INSERT`:

```typescript
      case 'sale': {
        const sale = event.sale;
        saveSale(this.tenantDb, sale, docOrigin, receivedAt);
        // (sigue igual: cuenta corriente sin hold)
```

```typescript
      case 'cash-movement': {
        saveCashMovement(this.tenantDb, event.movement, docOrigin, receivedAt);
        return undefined;
      }
```

```typescript
      case 'customer-payment': {
        const payment = event.payment;
        if (!saveCustomerPayment(this.tenantDb, payment, docOrigin, receivedAt)) {
          return undefined;
        }
        // (sigue igual desde `const ref = …`)
```

- [ ] **Paso 5: la cobranza del admin con forma de contrato**

En `src/server/customer/customer-service.ts`, importar
`import { saveCustomerPayment } from '../sales/records.ts';` y reemplazar el bloque
`// 2. Registro formal en customer_payments` por:

```typescript
    // 2. Registro formal en customer_payments, con la forma del contrato (#20)
    saveCustomerPayment(
      this.db,
      {
        id: paymentId,
        customerId,
        payments: [
          {
            method: input.method ?? 'cash',
            amount: input.amount,
            ...(input.reference === undefined ? {} : { reference: input.reference }),
          },
        ],
        total: input.amount,
        createdAt: now,
      },
      { deviceId: 'admin_panel', branch: 'ADMIN', pointOfSale: 'Oficina' },
      now,
    );
```

- [ ] **Paso 6: la semilla con forma de contrato**

Reemplazar `src/server/seeds/demo-activity-generator.ts` entero:

```typescript
import { DatabaseSync } from 'node:sqlite';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import { applyToBalance } from '../customer/account-ledger.ts';
import { saveCashMovement, saveCustomerPayment, saveSale, type DocumentOrigin } from '../sales/records.ts';

const CAJA: DocumentOrigin = { deviceId: 'pos_caja_1', branch: 'CENTRAL', pointOfSale: 'Caja 1' };

type ProductLine = { kind: 'product'; productId: string; qty: number; unitPrice: number };

/** El instante del día argentino `day` a la hora indicada. */
function at(day: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${day}T${hh}:${mm}:00.000-03:00`).toISOString();
}

/**
 * Historial de los últimos 7 días con la forma del contrato (#20): ventas numeradas por día (alguna a
 * cuenta corriente), una anulación ayer, una cobranza, ingresos, egresos y un ajuste por arqueo. Es
 * del seed de desarrollo y de los tests (las demos no tienen historial). Nada queda después de `now`.
 */
export function generateHistoricalDemoActivity(
  db: DatabaseSync,
  branchId: string,
  now: Date = new Date(),
): { salesCreated: number; cashMovementsCreated: number } {
  const products = db
    .prepare('SELECT id, price FROM products ORDER BY id LIMIT 8')
    .all() as unknown as { id: string; price: number }[];
  if (products.length === 0) {
    return { salesCreated: 0, cashMovementsCreated: 0 };
  }

  const today = argentinaToday(now);
  const nowIso = now.toISOString();
  let salesCreated = 0;
  let cashMovementsCreated = 0;

  const moveStock = db.prepare(
    `INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, sale_id, device_id, branch, point_of_sale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pos_caja_1', 'CENTRAL', 'Caja 1', ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  const updateStock = db.prepare(
    'UPDATE stock SET quantity = MAX(0, quantity + ?), updated_at = ? WHERE product_id = ? AND branch_id = ?',
  );
  const applyLines = (saleId: string, lines: ProductLine[], reason: 'sale' | 'sale-void', when: string): void => {
    lines.forEach((line, index) => {
      moveStock.run(`stk_${saleId}_${String(index)}`, line.productId, branchId, -line.qty, reason, saleId, when);
      updateStock.run(-line.qty, when, line.productId, branchId);
    });
  };
  const cash = (id: string, when: string, movement: Record<string, unknown>): void => {
    if (when > nowIso) return;
    saveCashMovement(db, { ...movement, id, createdAt: when }, CAJA, when);
    cashMovementsCreated++;
  };

  for (let d = 6; d >= 0; d--) {
    const day = shiftDay(today, -d);
    let ticket = 0;

    cash(`csh_open_d${String(d)}`, at(day, 9, 0), { direction: 'in', amount: 15000, concept: 'Fondo inicial', source: 'manual' });

    const hours = [10, 12, 15, 17, 19];
    const salesCount = 3 + (d % 3);
    let firstSale: { id: string; lines: ProductLine[]; method: string; total: number } | undefined;

    for (let s = 0; s < salesCount; s++) {
      const saleAt = at(day, hours[s] ?? 14, (d * 7 + s * 11) % 50);
      if (saleAt > nowIso) continue;
      const saleId = `sale_demo_d${String(d)}_s${String(s)}`;

      const lines: ProductLine[] = [];
      const p1 = products[(d + s) % products.length];
      if (p1 !== undefined) lines.push({ kind: 'product', productId: p1.id, qty: 1 + (s % 2), unitPrice: p1.price });
      const p2 = products[(d + s + 1) % products.length];
      if (s === 1 && products.length > 1 && p2 !== undefined) lines.push({ kind: 'product', productId: p2.id, qty: 1, unitPrice: p2.price });
      const total = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);

      const isAccountSale = s === 2 && d % 2 === 0;
      const method = isAccountSale ? 'account' : s % 2 === 0 ? 'cash' : 'debit';
      ticket += 1;
      saveSale(
        db,
        {
          id: saleId,
          status: 'closed',
          lines,
          payments: [{ method, amount: total }],
          total,
          createdAt: saleAt,
          ticket: { date: day, number: ticket },
          ...(isAccountSale ? { customerId: 'cust-juan' } : {}),
        },
        CAJA,
        saleAt,
      );
      applyLines(saleId, lines, 'sale', saleAt);
      salesCreated++;
      if (isAccountSale) {
        applyToBalance(db, 'cust-juan', { type: 'sale', delta: total, description: `Venta en cuenta corriente ${saleId}`, saleId }, saleAt);
      }
      if (s === 0) firstSale = { id: saleId, lines, method, total };
    }

    // Ayer: anulación de la primera venta del día, a las 20:00
    const voidAt = at(day, 20, 0);
    if (d === 1 && firstSale !== undefined && voidAt <= nowIso) {
      const voidId = `${firstSale.id}_anulacion`;
      const voidLines = firstSale.lines.map((line) => ({ ...line, qty: -line.qty }));
      ticket += 1;
      saveSale(
        db,
        {
          id: voidId,
          status: 'closed',
          lines: voidLines,
          payments: [{ method: firstSale.method, amount: -firstSale.total }],
          total: -firstSale.total,
          createdAt: voidAt,
          ticket: { date: day, number: ticket },
          voidsSaleId: firstSale.id,
          voidReason: 'Error de carga',
        },
        CAJA,
        voidAt,
      );
      applyLines(voidId, voidLines, 'sale-void', voidAt);
      salesCreated++;
    }

    // Anteayer: Juan paga $5.000 en efectivo
    const paymentAt = at(day, 18, 0);
    if (d === 2 && paymentAt <= nowIso) {
      const paymentId = 'pay_demo_d2';
      saveCustomerPayment(
        db,
        { id: paymentId, customerId: 'cust-juan', payments: [{ method: 'cash', amount: 5000 }], total: 5000, createdAt: paymentAt, receipt: { date: day, number: 1 } },
        CAJA,
        paymentAt,
      );
      applyToBalance(db, 'cust-juan', { type: 'payment', delta: -5000, description: `Cobranza ${paymentId}` }, paymentAt);
    }

    if (d % 2 === 1) {
      cash(`csh_drop_d${String(d)}`, at(day, 16, 0), { direction: 'out', amount: 2500, concept: 'Artículos de limpieza', source: 'manual' });
    }
    if (d === 1) {
      cash('csh_count_d1', at(day, 21, 0), {
        direction: 'out', amount: 150, concept: 'Ajuste por arqueo', source: 'count-adjustment', count: { expected: 30000, counted: 29850 },
      });
    }
  }

  return { salesCreated, cashMovementsCreated };
}
```

> El cliente `cust-juan` existe en el seed de desarrollo (`insertDemoCustomers`). Si no está,
> `applyToBalance` devuelve `false` y no pasa nada.

- [ ] **Paso 7: correr el test y verlo pasar**

Correr `pnpm vitest run test/sales-records.test.ts test/connector-api.test.ts test/connector-discrepancies.test.ts test/connector-push-atomic.test.ts test/customer-and-accounts.test.ts test/dashboard-summary.test.ts test/push-events.test.ts`.
Esperado: PASS.

- [ ] **Paso 8: suite completa, e2e y commit**

Se tocó el push: va también el e2e.

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm test:e2e }
git add src/server/sales/records.ts src/server/connector/push-events.ts src/server/connector/connector-service.ts src/server/customer/customer-service.ts src/server/seeds/demo-activity-generator.ts test/sales-records.test.ts
git commit -m "feat: ventas, cobranzas y movimientos se guardan con día y números; cobranza del admin y semilla con forma de contrato (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar para la revisión.

---

### Tarea 3: resumen del día copiado del POS

**Archivos:**
- Crear: `src/shared/payment-methods.ts`, `src/shared/sales-types.ts`, `src/server/sales/day-summary.ts`.
- Test: `test/day-summary.test.ts` (nuevo).

**Interfaces:**
- Produce:
  - `PAYMENT_METHODS`, `isPaymentMethod(m: string): m is PaymentMethod`, `methodKey(m: string): MethodKey`;
  - los tipos de `src/shared/sales-types.ts` (abajo), que usan las Tareas 4 a 10;
  - `calculateDaySummary(params): DaySummary` con
    `params = { sales: readonly SummarySale[]; movements: readonly SummaryMovement[]; collections: readonly SummaryCollection[]; voidedSaleIds: ReadonlySet<string>; voidedPaymentIds: ReadonlySet<string> }`.

- [ ] **Paso 1: escribir el test que falla**

`test/day-summary.test.ts`. Los números están calculados a mano con las reglas del `/RESUMEN`
(`calculateDaySummary` de offline-pos):

```typescript
import { describe, it, expect } from 'vitest';
import { calculateDaySummary } from '../src/server/sales/day-summary.ts';
import { methodKey } from '../src/shared/payment-methods.ts';

const line = (qty: number, unitPrice: number) => ({ qty, unitPrice });
const pay = (method: string, amount: number) => ({ method, amount });

describe('resumen del día como el /RESUMEN del POS (#20)', () => {
  it('ventas, anulación, devolución, medio desconocido, movimientos y cobranzas', () => {
    const summary = calculateDaySummary({
      sales: [
        { id: 's1', total: 1000, lines: [line(2, 500)], payments: [pay('cash', 1000)] },
        // Descuento de línea: el ajuste del POS es total − Σ unitPrice·qty
        { id: 's2', total: 500, lines: [line(1, 550)], payments: [pay('debit', 500)] },
        { id: 's3', total: -1000, lines: [line(-2, 500)], payments: [pay('cash', -1000)] },
        { id: 's4', total: -200, lines: [line(-1, 200)], payments: [pay('cash', -200)] },
        { id: 's5', total: 300, lines: [line(3, 100)], payments: [pay('crypto', 300)] },
      ],
      movements: [
        { direction: 'in', amount: 2000, source: 'manual' },
        { direction: 'out', amount: 500, source: 'manual' },
        { direction: 'out', amount: 150, source: 'count-adjustment' },
        { direction: null, amount: 999, source: null },
      ],
      collections: [
        { id: 'c1', total: 700, payments: [pay('cash', 700)] },
        { id: 'c2', total: 300, payments: [pay('transfer', 300)] },
        { id: 'c3', total: -700, payments: [pay('cash', -700)] },
      ],
      voidedSaleIds: new Set(['s1']),
      voidedPaymentIds: new Set(['c1']),
    });

    expect(summary).toEqual({
      totalSold: 600,
      ticketCount: 5,
      voidedCount: 1,
      adjustmentTotal: -50,
      totalsByMethod: { cash: -200, debit: 500, credit: 0, transfer: 0, qr: 0, account: 0, other: 300 },
      otherPayments: 800,
      cash: { sales: -200, income: 2000, expense: 500, countAdjustments: -150, collections: 0 },
      collections: { total: 300, count: 3, voidedCount: 1 },
      collectionsByMethod: { cash: 0, debit: 0, credit: 0, transfer: 300, qr: 0, account: 0, other: 0 },
    });
  });

  it('redondea a 2 decimales y un día vacío da ceros', () => {
    const summary = calculateDaySummary({
      sales: [
        { id: 'a', total: 0.1, lines: [], payments: [pay('cash', 0.1)] },
        { id: 'b', total: 0.2, lines: [], payments: [pay('cash', 0.2)] },
      ],
      movements: [], collections: [], voidedSaleIds: new Set(), voidedPaymentIds: new Set(),
    });
    expect(summary.totalSold).toBe(0.3);
    expect(summary.cash.sales).toBe(0.3);
    expect(calculateDaySummary({ sales: [], movements: [], collections: [], voidedSaleIds: new Set(), voidedPaymentIds: new Set() }).ticketCount).toBe(0);
  });

  it('un medio que no está en el contrato es "other"', () => {
    expect(methodKey('qr')).toBe('qr');
    expect(methodKey('crypto')).toBe('other');
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/day-summary.test.ts`. Esperado: FAIL, porque el módulo no existe.

- [ ] **Paso 3: medios de pago y tipos compartidos**

`src/shared/payment-methods.ts`:

```typescript
/** Medios de pago del contrato (`Payment.method`). Uno desconocido cuenta como "otro" (4.4.0). */
export const PAYMENT_METHODS = ['cash', 'debit', 'credit', 'transfer', 'qr', 'account'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type MethodKey = PaymentMethod | 'other';

export function isPaymentMethod(method: string): method is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(method);
}

export function methodKey(method: string): MethodKey {
  return isPaymentMethod(method) ? method : 'other';
}
```

`src/shared/sales-types.ts`:

```typescript
import type { MethodKey } from './payment-methods.ts';

/** Tipos de la API de Ventas & Caja (#20): los arma el servidor y los lee el cliente. */

export type SaleKind = 'sale' | 'return' | 'void';
export type DocStatus = 'all' | 'valid' | 'voided';
export type Numbered = { date: string; number: number };
export type CustomerRef = { id: string; name?: string };
export type PaymentLine = { method: string; amount: number; reference?: string };

export type SaleListItem = {
  id: string;
  day: string;
  createdAt: string;
  ticket?: Numbered;
  branch: string | null;
  pointOfSale: string | null;
  customer?: CustomerRef;
  methods: string[];
  total: number;
  kind: SaleKind;
  voided: boolean;
  voidedBy?: string;
  voidsSaleId?: string;
};

export type SaleDetailLine = {
  kind: 'product' | 'freeform';
  productId?: string;
  name: string;
  qty: number;
  unitPrice: number;
  discount?: { type: 'amount' | 'percentage'; value: number };
  total: number;
};

export type SaleDetail = SaleListItem & {
  lines: SaleDetailLine[];
  subtotal: number;
  globalAdjustment: number;
  payments: PaymentLine[];
  voidReason?: string;
};

export type CustomerPaymentItem = {
  id: string;
  day: string;
  createdAt: string;
  receipt?: Numbered;
  branch: string | null;
  pointOfSale: string | null;
  customer: CustomerRef;
  payments: PaymentLine[];
  total: number;
  voided: boolean;
  voidedBy?: string;
  voidsPaymentId?: string;
};

export type CashMovementItem = {
  id: string;
  day: string;
  createdAt: string;
  branch: string | null;
  pointOfSale: string | null;
  direction: 'in' | 'out' | null;
  amount: number;
  concept: string;
  description?: string;
  source: string | null;
  count?: { expected: number; counted: number };
};

export type ListResult<T> = { items: T[]; count: number; page: number; pageSize: number; netTotal: number };

export type RegisterItem = { branch: string | null; pointOfSale: string | null };

/** El resumen del día, con la forma de `DaySummary` del POS más `other` en los medios. */
export type DaySummary = {
  totalSold: number;
  ticketCount: number;
  voidedCount: number;
  adjustmentTotal: number;
  totalsByMethod: Record<MethodKey, number>;
  otherPayments: number;
  cash: { sales: number; income: number; expense: number; countAdjustments: number; collections: number };
  collections: { total: number; count: number; voidedCount: number };
  collectionsByMethod: Record<MethodKey, number>;
};

export type CashSummaryTotals = {
  totalSold: number;
  ticketCount: number;
  voidedCount: number;
  collectionsTotal: number;
  cashIncome: number;
  cashExpense: number;
  cashCountAdjustments: number;
  cashNet: number;
};

export type CashSummaryRow = CashSummaryTotals & { day: string; branch: string | null; pointOfSale: string | null };

export type CashSummaryResult = { rows: CashSummaryRow[]; totals: CashSummaryTotals };

export type DayEntry =
  | { kind: 'sale'; at: string; sale: SaleListItem }
  | { kind: 'movement'; at: string; movement: CashMovementItem }
  | { kind: 'collection'; at: string; payment: CustomerPaymentItem };

export type DaySummaryResult = { day: string; summary: DaySummary; entries: DayEntry[] };
```

- [ ] **Paso 4: implementar `calculateDaySummary`**

`src/server/sales/day-summary.ts`:

```typescript
import { roundAmount } from '../dashboard/sale-lines.ts';
import { methodKey, type MethodKey } from '../../shared/payment-methods.ts';
import type { DaySummary } from '../../shared/sales-types.ts';

/**
 * Copia fiel de `calculateDaySummary` de offline-pos (`src/domain/day-summary.ts`, #20). El resumen
 * de mini tiene que cuadrar con el `/RESUMEN` del POS. Cambios: un medio desconocido suma en
 * `other` (reglas de evolución 4.4.0) y los totales por medio también se redondean. Una cobranza no
 * es una venta: tiene sus propios totales y su fila en el efectivo.
 */

type Money = { method: string; amount: number };
export type SummarySale = { id: string; total: number; lines: ReadonlyArray<{ qty: number; unitPrice: number }>; payments: readonly Money[] };
export type SummaryMovement = { direction: 'in' | 'out' | null; amount: number; source: string | null };
export type SummaryCollection = { id: string; total: number; payments: readonly Money[] };

function emptyByMethod(): Record<MethodKey, number> {
  return { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0, other: 0 };
}

function roundByMethod(totals: Record<MethodKey, number>): Record<MethodKey, number> {
  return {
    cash: roundAmount(totals.cash),
    debit: roundAmount(totals.debit),
    credit: roundAmount(totals.credit),
    transfer: roundAmount(totals.transfer),
    qr: roundAmount(totals.qr),
    account: roundAmount(totals.account),
    other: roundAmount(totals.other),
  };
}

export function calculateDaySummary(params: {
  sales: readonly SummarySale[];
  movements: readonly SummaryMovement[];
  collections: readonly SummaryCollection[];
  voidedSaleIds: ReadonlySet<string>;
  voidedPaymentIds: ReadonlySet<string>;
}): DaySummary {
  const totalsByMethod = emptyByMethod();
  let totalSold = 0;
  let adjustmentTotal = 0;
  for (const sale of params.sales) {
    totalSold += sale.total;
    adjustmentTotal += sale.total - sale.lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
    for (const payment of sale.payments) {
      totalsByMethod[methodKey(payment.method)] += payment.amount;
    }
  }

  let income = 0;
  let expense = 0;
  let countAdjustments = 0;
  for (const movement of params.movements) {
    if (movement.direction === null) continue;
    if (movement.source === 'count-adjustment') {
      countAdjustments += movement.direction === 'in' ? movement.amount : -movement.amount;
    } else if (movement.direction === 'in') {
      income += movement.amount;
    } else {
      expense += movement.amount;
    }
  }

  const collectionsByMethod = emptyByMethod();
  let collectionsTotal = 0;
  for (const collection of params.collections) {
    collectionsTotal += collection.total;
    for (const payment of collection.payments) {
      collectionsByMethod[methodKey(payment.method)] += payment.amount;
    }
  }

  const byMethod = roundByMethod(totalsByMethod);
  const collectionsRounded = roundByMethod(collectionsByMethod);
  return {
    totalSold: roundAmount(totalSold),
    ticketCount: params.sales.length,
    voidedCount: params.sales.filter((sale) => params.voidedSaleIds.has(sale.id)).length,
    adjustmentTotal: roundAmount(adjustmentTotal),
    totalsByMethod: byMethod,
    otherPayments: roundAmount(byMethod.debit + byMethod.credit + byMethod.transfer + byMethod.qr + byMethod.account + byMethod.other),
    cash: {
      sales: byMethod.cash,
      income: roundAmount(income),
      expense: roundAmount(expense),
      countAdjustments: roundAmount(countAdjustments),
      collections: collectionsRounded.cash,
    },
    collections: {
      total: roundAmount(collectionsTotal),
      count: params.collections.length,
      voidedCount: params.collections.filter((payment) => params.voidedPaymentIds.has(payment.id)).length,
    },
    collectionsByMethod: collectionsRounded,
  };
}
```

> El POS saltea las ventas con `status !== 'closed'` (anteriores a su Etapa 4). El contrato solo
> admite `closed`, así que mini no necesita esa rama.

- [ ] **Paso 5: correr el test y verlo pasar**

Correr `pnpm vitest run test/day-summary.test.ts`. Esperado: PASS.

- [ ] **Paso 6: suite completa y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/shared/payment-methods.ts src/shared/sales-types.ts src/server/sales/day-summary.ts test/day-summary.test.ts
git commit -m "feat: resumen del día copiado del /RESUMEN del POS (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar para la revisión.

---

### Tarea 4: consulta de ventas (lista, detalle y cajas)

**Archivos:**
- Crear: `src/server/sales/stored-documents.ts`, `src/server/sales/sales-query-service.ts`,
  `src/server/routes/sales-routes.ts`.
- Modificar: `src/server/di/container.ts`, `src/server/app.ts`, `test/permissions-api.test.ts`.
- Test: `test/sales-api.test.ts` (nuevo; las Tareas 5 y 6 le suman casos) y
  `test/helpers/sales-fixture.ts` (nuevo).

**Interfaces:**
- Consume: los tipos de `src/shared/sales-types.ts` (Tarea 3), `parseSaleLines`, `lineTotal` y
  `roundAmount` (`dashboard/sale-lines.ts`), `DAY_PATTERN` y `daysBetween` (Tarea 1).
- Produce:
  - `SalesQueryService` con `registers(): RegisterItem[]`,
    `listSales(filter: SalesFilter, paging: Paging): ListResult<SaleListItem>` y
    `getSale(id: string): SaleDetail`;
  - `salesQueryServiceDef`;
  - las rutas `GET /registers`, `GET /sales` y `GET /sales/:saleId`;
  - `readSale(payload)`, `readCustomerPayment(payload)` y `readCashMovement(payload)` en
    `stored-documents.ts`;
  - el fixture `seedSalesFixture(app, token, tenantId, tenantDb): Promise<void>`, que usan las
    Tareas 5 y 6.

- [ ] **Paso 1: el fixture compartido**

`test/helpers/sales-fixture.ts`. Arma por push lo que el criterio de aceptación pide: dos cajas, dos
días, ventas, una anulación al otro día, una devolución, un medio desconocido, una cobranza y su
anulación, y movimientos con arqueo.

```typescript
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';

export const D1 = '2026-10-01';
export const D2 = '2026-10-02';
const caja1 = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };
const caja2 = { branch: 'CENTRAL', pointOfSale: 'Caja 2' };

function ev(id: string, type: string, createdAt: string, origin: { branch: string; pointOfSale: string }, body: Record<string, unknown>) {
  return { id, type, createdAt, origin, ...body };
}

const sale = (id: string, createdAt: string, day: string, number: number, rest: Record<string, unknown>) => ({
  sale: { id, status: 'closed', createdAt, ticket: { date: day, number }, ...rest },
});

/**
 * Datos de Ventas & Caja (#20), por el Connector API (con una key de `CENTRAL · Caja 1`):
 * - D1, Caja 1: s1 (efectivo 1000, anulada en D2), s2 (débito 450, Ana, descuento de línea), cobranza
 *   cp1 (Ana, efectivo 700, anulada en D2), ingreso 2000, egreso 500 y arqueo −150.
 * - D1, Caja 2: s3 (medio desconocido 300, línea libre y un producto borrado).
 * - D2, Caja 1: s4 (anulación de s1), s5 (devolución −200 en efectivo), cp2 (anulación de cp1).
 */
export async function seedSalesFixture(app: Express, token: string, tenantId: string, tenantDb: DatabaseSync): Promise<void> {
  // El producto va directo a la base: el detalle del ticket busca su nombre por id
  const at = `${D1}T09:00:00.000Z`;
  tenantDb
    .prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p1', 'ALF-1', 'Alfajor', 500, ?, ?)")
    .run(at, at);
  const key = await request(app)
    .post(`/api/tenants/${tenantId}/api-keys`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
  const apiKey = (key.body as { rawKey: string }).rawKey;

  const events = [
    ev('e0', 'customer', `${D1}T10:00:00.000Z`, caja1, { customer: { id: 'c1', name: 'Ana' } }),
    ev('e1', 'sale', `${D1}T13:00:00.000Z`, caja1, sale('s1', `${D1}T13:00:00.000Z`, D1, 1, {
      total: 1000, lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 500 }], payments: [{ method: 'cash', amount: 1000 }],
    })),
    ev('e2', 'sale', `${D1}T14:00:00.000Z`, caja1, sale('s2', `${D1}T14:00:00.000Z`, D1, 2, {
      total: 450, customerId: 'c1',
      lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 500, discount: { type: 'amount', value: 50 } }],
      payments: [{ method: 'debit', amount: 450 }],
    })),
    ev('e3', 'sale', `${D1}T13:30:00.000Z`, caja2, sale('s3', `${D1}T13:30:00.000Z`, D1, 1, {
      total: 300,
      lines: [{ kind: 'freeform', description: 'Fotocopias', qty: 3, unitPrice: 100 }, { kind: 'product', productId: 'p-borrado', qty: 1, unitPrice: 0 }],
      payments: [{ method: 'crypto', amount: 300 }],
    })),
    ev('e4', 'sale', `${D2}T12:00:00.000Z`, caja1, sale('s4', `${D2}T12:00:00.000Z`, D2, 1, {
      total: -1000, voidsSaleId: 's1', voidReason: 'Error',
      lines: [{ kind: 'product', productId: 'p1', qty: -2, unitPrice: 500 }], payments: [{ method: 'cash', amount: -1000 }],
    })),
    ev('e5', 'sale', `${D2}T13:00:00.000Z`, caja1, sale('s5', `${D2}T13:00:00.000Z`, D2, 2, {
      total: -200, lines: [{ kind: 'freeform', description: 'Devolución', qty: -1, unitPrice: 200 }], payments: [{ method: 'cash', amount: -200 }],
    })),
    ev('e6', 'customer-payment', `${D1}T15:00:00.000Z`, caja1, {
      payment: { id: 'cp1', customerId: 'c1', total: 700, createdAt: `${D1}T15:00:00.000Z`, receipt: { date: D1, number: 1 }, payments: [{ method: 'cash', amount: 700 }] },
    }),
    ev('e7', 'customer-payment', `${D2}T14:00:00.000Z`, caja1, {
      payment: { id: 'cp2', customerId: 'c1', total: -700, voidsPaymentId: 'cp1', createdAt: `${D2}T14:00:00.000Z`, receipt: { date: D2, number: 1 }, payments: [{ method: 'cash', amount: -700 }] },
    }),
    ev('e8', 'cash-movement', `${D1}T11:00:00.000Z`, caja1, {
      movement: { id: 'm1', direction: 'in', amount: 2000, concept: 'Fondo', source: 'manual', createdAt: `${D1}T11:00:00.000Z` },
    }),
    ev('e9', 'cash-movement', `${D1}T16:00:00.000Z`, caja1, {
      movement: { id: 'm2', direction: 'out', amount: 500, concept: 'Proveedor', description: 'Pan', source: 'manual', createdAt: `${D1}T16:00:00.000Z` },
    }),
    ev('e10', 'cash-movement', `${D1}T21:00:00.000Z`, caja1, {
      movement: { id: 'm3', direction: 'out', amount: 150, concept: 'Ajuste por arqueo', source: 'count-adjustment', count: { expected: 3200, counted: 3050 }, createdAt: `${D1}T21:00:00.000Z` },
    }),
  ];
  const res = await request(app)
    .post('/connector/sync/push')
    .set('Authorization', `Bearer ${apiKey}`)
    .set('X-POS-Contract-Version', '4.4.0')
    .set('Idempotency-Key', 'fixture-ventas')
    .send({ deviceId: 'dev-1', events });
  if (res.status !== 200) {
    throw new Error(`El push del fixture falló: ${String(res.status)}`);
  }
}
```

> El fixture no manda movimientos de stock: las ventas no necesitan que el producto exista (`p-borrado`
> no existe a propósito).

- [ ] **Paso 2: escribir el test que falla**

`test/sales-api.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import type { ListResult, SaleDetail, SaleListItem } from '../src/shared/sales-types.ts';
import { D1, D2, seedSalesFixture } from './helpers/sales-fixture.ts';

describe('API de Ventas & Caja (#20)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let token: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const owner = bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    token = owner.token;
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    await seedSalesFixture(app, token, tenantId, tenantManager.getTenantDb(tenantId));
  });

  const get = (path: string) => request(app).get(`/api/tenants/${tenantId}${path}`).set('Authorization', `Bearer ${token}`);
  const sales = async (query: string) => (await get(`/sales?from=${D1}&to=${D2}${query}`)).body as ListResult<SaleListItem>;
  const ids = (list: ListResult<{ id: string }>) => list.items.map((i) => i.id);

  describe('ventas', () => {
    it('las cajas que aparecen en los datos', async () => {
      expect((await get('/registers')).body).toEqual([
        { branch: 'CENTRAL', pointOfSale: 'Caja 1' },
        { branch: 'CENTRAL', pointOfSale: 'Caja 2' },
      ]);
    });

    it('lista del rango: lo más nuevo primero, total neto y marcas', async () => {
      const list = await sales('');
      expect(ids(list)).toEqual(['s5', 's4', 's2', 's3', 's1']);
      expect(list).toMatchObject({ count: 5, page: 1, pageSize: 50, netTotal: 550 });
      const byId = new Map(list.items.map((i) => [i.id, i]));
      expect(byId.get('s1')).toEqual({
        id: 's1', day: D1, createdAt: `${D1}T13:00:00.000Z`, ticket: { date: D1, number: 1 }, branch: 'CENTRAL', pointOfSale: 'Caja 1',
        methods: ['cash'], total: 1000, kind: 'sale', voided: true, voidedBy: 's4',
      });
      expect(byId.get('s4')).toMatchObject({ kind: 'void', voidsSaleId: 's1', voided: false });
      expect(byId.get('s5')).toMatchObject({ kind: 'return' });
      expect(byId.get('s2')).toMatchObject({ customer: { id: 'c1', name: 'Ana' } });
      expect(byId.get('s3')).toMatchObject({ methods: ['crypto'] });
    });

    it.each([
      ['&pointOfSale=Caja%202', ['s3']],
      ['&method=other', ['s3']],
      ['&method=debit', ['s2']],
      ['&customerId=c1', ['s2']],
      ['&productId=p1', ['s4', 's2', 's1']],
      ['&kind=return', ['s5']],
      ['&kind=void', ['s4']],
      ['&status=valid', ['s5', 's2', 's3']],
      ['&status=voided', ['s1']],
      ['&branch=CENTRAL&pointOfSale=Caja%201', ['s5', 's4', 's2', 's1']],
    ])('filtro %s', async (query, expected) => {
      expect(ids(await sales(query))).toEqual(expected);
    });

    it('un día solo y paginación', async () => {
      expect(ids((await get(`/sales?from=${D2}&to=${D2}`)).body as ListResult<SaleListItem>)).toEqual(['s5', 's4']);
      const page2 = await sales('&page=2&pageSize=2');
      expect(ids(page2)).toEqual(['s2', 's3']);
      expect(page2).toMatchObject({ count: 5, page: 2, pageSize: 2, netTotal: 550 });
    });

    it('el detalle del ticket: líneas con su total, ajuste, pagos y anulación', async () => {
      const s2 = (await get('/sales/s2')).body as SaleDetail;
      expect(s2).toMatchObject({
        lines: [{ kind: 'product', productId: 'p1', name: 'Alfajor', qty: 1, unitPrice: 500, discount: { type: 'amount', value: 50 }, total: 450 }],
        subtotal: 450, globalAdjustment: 0, payments: [{ method: 'debit', amount: 450 }],
      });
      const s3 = (await get('/sales/s3')).body as SaleDetail;
      expect(s3.lines.map((l) => l.name)).toEqual(['Fotocopias', 'Producto eliminado']);
      expect((await get('/sales/s4')).body).toMatchObject({ voidReason: 'Error', voidsSaleId: 's1', kind: 'void' });
      expect((await get('/sales/nada')).status).toBe(404);
    });

    it.each([
      [`/sales?from=${D2}&to=${D1}`],
      ['/sales?from=2025-01-01&to=2026-10-02'],
      ['/sales?from=ayer&to=2026-10-02'],
      [`/sales?from=${D1}&to=${D2}&pageSize=500`],
      [`/sales?from=${D1}&to=${D2}&status=raro`],
    ])('%s da 400', async (path) => {
      expect((await get(path)).status).toBe(400);
    });
  });
});
```

En `test/permissions-api.test.ts`, sumar a `RUTAS`:

```typescript
  'GET /registers': 'tenant.use',
  'GET /sales': 'tenant.use',
  'GET /sales/:saleId': 'tenant.use',
```

- [ ] **Paso 3: correrlo y verlo fallar**

Correr `pnpm vitest run test/sales-api.test.ts test/permissions-api.test.ts`. Esperado: FAIL con 404
en las rutas nuevas.

- [ ] **Paso 4: lectura de los payloads guardados**

`src/server/sales/stored-documents.ts`:

```typescript
import { z } from 'zod';
import { DAY_PATTERN } from '../../shared/argentina-day.ts';
import type { Numbered, PaymentLine } from '../../shared/sales-types.ts';
import { parseSaleLines, type SaleLine } from '../dashboard/sale-lines.ts';

/**
 * Lectura tolerante de lo que se guardó (#20): cada campo se valida por separado y lo que no valida
 * se omite. Un payload roto nunca da un 500 en las consultas.
 */

const recordSchema = z.record(z.unknown());
const numberedSchema = z.object({ date: z.string().regex(DAY_PATTERN), number: z.number().int() });
const paymentSchema = z.object({ method: z.string(), amount: z.number(), reference: z.string().optional() });
const countSchema = z.object({ expected: z.number(), counted: z.number() });

function parseRecord(payload: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return {};
  }
  const parsed = recordSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numbered(value: unknown): Numbered | undefined {
  const parsed = numberedSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function payments(value: unknown): PaymentLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: unknown) => {
    const parsed = paymentSchema.safeParse(raw);
    if (!parsed.success) return [];
    const { method, amount, reference } = parsed.data;
    return [{ method, amount, ...(reference === undefined ? {} : { reference }) }];
  });
}

export type StoredSale = { createdAt?: string; ticket?: Numbered; payments: PaymentLine[]; lines: SaleLine[]; voidReason?: string };

export function readSale(payload: string): StoredSale {
  const raw = parseRecord(payload);
  const createdAt = text(raw['createdAt']);
  const ticket = numbered(raw['ticket']);
  const voidReason = text(raw['voidReason']);
  return {
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(ticket === undefined ? {} : { ticket }),
    payments: payments(raw['payments']),
    lines: parseSaleLines(payload),
    ...(voidReason === undefined ? {} : { voidReason }),
  };
}

export type StoredCustomerPayment = { createdAt?: string; receipt?: Numbered; payments: PaymentLine[] };

export function readCustomerPayment(payload: string): StoredCustomerPayment {
  const raw = parseRecord(payload);
  const createdAt = text(raw['createdAt']);
  const receipt = numbered(raw['receipt']);
  return {
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(receipt === undefined ? {} : { receipt }),
    payments: payments(raw['payments']),
  };
}

export type StoredCashMovement = {
  createdAt?: string;
  direction: 'in' | 'out' | null;
  amount: number;
  concept: string;
  description?: string;
  source: string | null;
  count?: { expected: number; counted: number };
};

export function readCashMovement(payload: string): StoredCashMovement {
  const raw = parseRecord(payload);
  const createdAt = text(raw['createdAt']);
  const description = text(raw['description']);
  const direction = raw['direction'];
  const amount = raw['amount'];
  const count = countSchema.safeParse(raw['count']);
  return {
    ...(createdAt === undefined ? {} : { createdAt }),
    direction: direction === 'in' || direction === 'out' ? direction : null,
    amount: typeof amount === 'number' ? amount : 0,
    concept: text(raw['concept']) ?? 'Movimiento sin concepto',
    ...(description === undefined ? {} : { description }),
    source: text(raw['source']) ?? null,
    ...(count.success ? { count: count.data } : {}),
  };
}
```

> `parseSaleLines` ya vive en `dashboard/sale-lines.ts` y exporta `SaleLine`. Si no exporta el
> tipo, exportarlo.

- [ ] **Paso 5: el servicio (ventas y cajas)**

`src/server/sales/sales-query-service.ts`:

```typescript
import type { DatabaseSync } from 'node:sqlite';
import { argentinaDay, daysBetween } from '../../shared/argentina-day.ts';
import { PAYMENT_METHODS } from '../../shared/payment-methods.ts';
import type {
  DocStatus, ListResult, RegisterItem, SaleDetail, SaleDetailLine, SaleKind, SaleListItem,
} from '../../shared/sales-types.ts';
import { lineTotal, roundAmount } from '../dashboard/sale-lines.ts';
import { DomainError } from '../errors.ts';
import { readSale } from './stored-documents.ts';

export type RegisterFilter = { branch?: string | undefined; pointOfSale?: string | undefined };
export type DayRange = { from: string; to: string };
export type Paging = { page: number; pageSize: number };
export type SalesFilter = DayRange & RegisterFilter & {
  method?: string | undefined;
  customerId?: string | undefined;
  productId?: string | undefined;
  kind?: SaleKind | undefined;
  status?: DocStatus | undefined;
};

type Params = Array<string | number>;
type Where = { clauses: string[]; params: Params };

type SaleRow = {
  id: string;
  payload: string;
  branch: string | null;
  point_of_sale: string | null;
  total: number;
  voids_sale_id: string | null;
  created_at: string;
  day: string | null;
  customer_id: string | null;
  customer_name: string | null;
  voided_by: string | null;
};

/** El payload, o `{}` si no es JSON: así `json_each` nunca tira "malformed JSON". */
export const safePayload = (alias: string): string => `CASE WHEN json_valid(${alias}.payload) THEN ${alias}.payload ELSE '{}' END`;

const KNOWN_METHODS = PAYMENT_METHODS.map((method) => `'${method}'`).join(', ');

/** Rango de días y caja. Un `branch` o `pointOfSale` vacío filtra los que no tienen. */
export function rangeAndRegister(alias: string, filter: DayRange & RegisterFilter): Where {
  const where: Where = { clauses: [`${alias}.day BETWEEN ? AND ?`], params: [filter.from, filter.to] };
  const columns: Array<[string, string | undefined]> = [['branch', filter.branch], ['point_of_sale', filter.pointOfSale]];
  for (const [column, value] of columns) {
    if (value === undefined) continue;
    if (value === '') {
      where.clauses.push(`(${alias}.${column} IS NULL OR ${alias}.${column} = '')`);
    } else {
      where.clauses.push(`${alias}.${column} = ?`);
      where.params.push(value);
    }
  }
  return where;
}

/** Algún pago con ese medio; `other` es cualquiera fuera del contrato. */
export function addMethod(where: Where, alias: string, method: string): void {
  const condition = method === 'other'
    ? `json_extract(p.value, '$.method') NOT IN (${KNOWN_METHODS})`
    : `json_extract(p.value, '$.method') = ?`;
  where.clauses.push(`EXISTS (SELECT 1 FROM json_each(${safePayload(alias)}, '$.payments') p WHERE ${condition})`);
  if (method !== 'other') where.params.push(method);
}

/** Valida el rango: hasta 366 días, `from` no posterior a `to`. */
export function assertRange(range: DayRange): void {
  const days = daysBetween(range.from, range.to);
  if (Number.isNaN(days) || days < 0) {
    throw new DomainError(400, 'La fecha "desde" no puede ser posterior a "hasta"');
  }
  if (days > 365) {
    throw new DomainError(400, 'El rango puede tener hasta 366 días');
  }
}

function saleKind(row: { voids_sale_id: string | null; total: number }): SaleKind {
  if (row.voids_sale_id !== null) return 'void';
  return row.total < 0 ? 'return' : 'sale';
}

const SALE_COLUMNS = `s.id, s.payload, s.branch, s.point_of_sale, s.total, s.voids_sale_id, s.created_at, s.day, s.customer_id,
  c.name AS customer_name,
  (SELECT v.id FROM sales v WHERE v.voids_sale_id = s.id ORDER BY v.created_at LIMIT 1) AS voided_by`;

/**
 * Consultas de Ventas & Caja (#20), de un comercio. Los tres roles las ven. La caja es siempre un
 * filtro, así la vista "mi caja" del portal (M10) llama a los mismos métodos con la caja fija.
 */
export class SalesQueryService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  registers(): RegisterItem[] {
    const rows = this.db
      .prepare(
        `SELECT branch, point_of_sale FROM sales
         UNION SELECT branch, point_of_sale FROM customer_payments
         UNION SELECT branch, point_of_sale FROM cash_movements
         ORDER BY 1, 2`,
      )
      .all() as { branch: string | null; point_of_sale: string | null }[];
    return rows.map((r) => ({ branch: r.branch, pointOfSale: r.point_of_sale }));
  }

  listSales(filter: SalesFilter, paging: Paging): ListResult<SaleListItem> {
    assertRange(filter);
    const where = this.salesWhere(filter);
    const sql = where.clauses.join(' AND ');
    const totals = this.db
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(s.total), 0) AS net FROM sales s WHERE ${sql}`)
      .get(...where.params) as { count: number; net: number };
    return {
      items: this.saleRows(filter, paging).map((row) => this.toSaleItem(row)),
      count: totals.count,
      page: paging.page,
      pageSize: paging.pageSize,
      netTotal: roundAmount(totals.net),
    };
  }

  getSale(id: string): SaleDetail {
    const row = this.db
      .prepare(`SELECT ${SALE_COLUMNS} FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`)
      .get(id) as SaleRow | undefined;
    if (row === undefined) {
      throw new DomainError(404, 'Venta no encontrada');
    }
    const stored = readSale(row.payload);
    const names = this.productNames(stored.lines.flatMap((l) => (l.kind === 'product' ? [l.productId] : [])));
    const lines: SaleDetailLine[] = stored.lines.map((line) => ({
      kind: line.kind,
      ...(line.kind === 'product' ? { productId: line.productId } : {}),
      name: line.kind === 'product' ? (names.get(line.productId) ?? 'Producto eliminado') : line.description,
      qty: line.qty,
      unitPrice: line.unitPrice,
      ...(line.discount === undefined ? {} : { discount: line.discount }),
      total: lineTotal(line),
    }));
    const subtotal = roundAmount(lines.reduce((sum, line) => sum + line.total, 0));
    return {
      ...this.toSaleItem(row),
      lines,
      subtotal,
      globalAdjustment: roundAmount(row.total - subtotal),
      payments: stored.payments,
      ...(stored.voidReason === undefined ? {} : { voidReason: stored.voidReason }),
    };
  }

  /** Las filas del filtro; sin `paging`, todas (para los resúmenes). */
  protected saleRows(filter: SalesFilter, paging?: Paging): SaleRow[] {
    const where = this.salesWhere(filter);
    const limit = paging === undefined ? '' : ' LIMIT ? OFFSET ?';
    const params = paging === undefined ? where.params : [...where.params, paging.pageSize, (paging.page - 1) * paging.pageSize];
    return this.db
      .prepare(
        `SELECT ${SALE_COLUMNS} FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE ${where.clauses.join(' AND ')}
         ORDER BY s.day DESC, s.created_at DESC, s.id DESC${limit}`,
      )
      .all(...params) as unknown as SaleRow[];
  }

  protected toSaleItem(row: SaleRow): SaleListItem {
    const stored = readSale(row.payload);
    const createdAt = stored.createdAt ?? row.created_at;
    return {
      id: row.id,
      day: row.day ?? argentinaDay(createdAt) ?? '',
      createdAt,
      ...(stored.ticket === undefined ? {} : { ticket: stored.ticket }),
      branch: row.branch,
      pointOfSale: row.point_of_sale,
      ...(row.customer_id === null
        ? {}
        : { customer: { id: row.customer_id, ...(row.customer_name === null ? {} : { name: row.customer_name }) } }),
      methods: [...new Set(stored.payments.map((p) => p.method))],
      total: row.total,
      kind: saleKind(row),
      voided: row.voided_by !== null,
      ...(row.voided_by === null ? {} : { voidedBy: row.voided_by }),
      ...(row.voids_sale_id === null ? {} : { voidsSaleId: row.voids_sale_id }),
    };
  }

  private salesWhere(filter: SalesFilter): Where {
    const where = rangeAndRegister('s', filter);
    if (filter.method !== undefined) addMethod(where, 's', filter.method);
    if (filter.customerId !== undefined) {
      where.clauses.push('s.customer_id = ?');
      where.params.push(filter.customerId);
    }
    if (filter.productId !== undefined) {
      where.clauses.push(
        `EXISTS (SELECT 1 FROM json_each(${safePayload('s')}, '$.lines') l
          WHERE json_extract(l.value, '$.kind') = 'product' AND json_extract(l.value, '$.productId') = ?)`,
      );
      where.params.push(filter.productId);
    }
    if (filter.kind === 'void') where.clauses.push('s.voids_sale_id IS NOT NULL');
    if (filter.kind === 'return') where.clauses.push('s.voids_sale_id IS NULL AND s.total < 0');
    if (filter.kind === 'sale') where.clauses.push('s.voids_sale_id IS NULL AND s.total >= 0');
    const voided = 'EXISTS (SELECT 1 FROM sales v WHERE v.voids_sale_id = s.id)';
    if (filter.status === 'voided') where.clauses.push(voided);
    if (filter.status === 'valid') where.clauses.push(`s.voids_sale_id IS NULL AND NOT ${voided}`);
    return where;
  }

  private productNames(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map();
    const rows = this.db
      .prepare(`SELECT id, name FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids) as unknown as { id: string; name: string }[];
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
```

> `saleRows` y `toSaleItem` son `protected` porque la Tarea 6 las usa desde la misma clase. Si el
> lint marca `protected` sin subclases, pasarlas a `private`.

- [ ] **Paso 6: rutas, contenedor y montaje**

`src/server/routes/sales-routes.ts`:

```typescript
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import { salesQueryServiceDef } from '../di/container.ts';
import type { SalesQueryService } from '../sales/sales-query-service.ts';
import { sendError } from '../errors.ts';
import { DAY_PATTERN } from '../../shared/argentina-day.ts';

const day = z.string().regex(DAY_PATTERN, 'La fecha tiene que ser AAAA-MM-DD');
const optionalText = z.string().optional();
const base = { from: day, to: day, branch: optionalText, pointOfSale: optionalText };
const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
};
const status = z.enum(['all', 'valid', 'voided']).optional();

export const salesQuerySchema = z.object({
  ...base,
  ...paging,
  method: optionalText,
  customerId: optionalText,
  productId: optionalText,
  kind: z.enum(['sale', 'return', 'void']).optional(),
  status,
});

function getService(req: AuthenticatedAdminRequest): SalesQueryService {
  if (req.tenantScope === undefined) {
    throw new Error('Scope del comercio no inicializado en la petición');
  }
  return req.tenantScope.use(salesQueryServiceDef);
}

/** Valida la query con `schema` y responde lo que devuelve `run`; un error de negocio va con su estado. */
function handle<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, run: (service: SalesQueryService, query: T) => unknown) {
  return (req: AuthenticatedAdminRequest, res: Response): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Consulta inválida' });
      return;
    }
    try {
      res.status(200).json(run(getService(req), parsed.data));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  };
}

/** Ventas & Caja (#20): consultas de solo lectura, para los tres roles. */
export function createSalesRoutes(): Router {
  const router = Router({ mergeParams: true });
  const use = requirePermission('tenant.use');

  router.get('/registers', use, handle(z.object({}), (service) => service.registers()));
  router.get('/sales', use, handle(salesQuerySchema, (service, q) => service.listSales(q, { page: q.page, pageSize: q.pageSize })));
  router.get('/sales/:saleId', use, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(200).json(getService(req).getSale(req.params['saleId'] ?? ''));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
```

En `src/server/di/container.ts`, importar `SalesQueryService` y sumar, junto a las otras
definiciones de comercio:

```typescript
export const salesQueryServiceDef = fn.scoped((c) => new SalesQueryService(c.use(tenantDbDef)));
```

En `src/server/app.ts`, importar `createSalesRoutes` y montarlo en la cadena de
`/api/tenants/:tenantId`, después de `createDashboardRoutes()`.

- [ ] **Paso 7: correr los tests y verlos pasar**

Correr `pnpm vitest run test/sales-api.test.ts test/permissions-api.test.ts test/ioc-container.test.ts`.
Esperado: PASS.

- [ ] **Paso 8: suite completa y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/server/sales/stored-documents.ts src/server/sales/sales-query-service.ts src/server/routes/sales-routes.ts src/server/di/container.ts src/server/app.ts src/server/dashboard/sale-lines.ts test/sales-api.test.ts test/helpers/sales-fixture.ts test/permissions-api.test.ts
git commit -m "feat: consulta de ventas con filtros, detalle del ticket y cajas (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar para la revisión.

---

### Tarea 5: consulta de cobranzas y movimientos de caja

**Archivos:**
- Modificar: `src/server/sales/sales-query-service.ts`, `src/server/routes/sales-routes.ts`,
  `test/sales-api.test.ts`, `test/permissions-api.test.ts`.

**Interfaces:**
- Consume: `rangeAndRegister`, `addMethod`, `assertRange` y `safePayload` (Tarea 4), y
  `readCustomerPayment` y `readCashMovement`.
- Produce:
  - `listCustomerPayments(filter: PaymentsFilter, paging: Paging): ListResult<CustomerPaymentItem>`;
  - `listCashMovements(filter: MovementsFilter, paging: Paging): ListResult<CashMovementItem>`;
  - los métodos protegidos `paymentRows`, `toPaymentItem`, `movementRows` y `toMovementItem`, que
    usa la Tarea 6;
  - las rutas `GET /customer-payments` y `GET /cash-movements`.

- [ ] **Paso 1: escribir los tests que fallan**

En `test/sales-api.test.ts`, sumar los imports `argentinaToday` (de `../src/shared/argentina-day.ts`) y
los tipos `CashMovementItem` y `CustomerPaymentItem`, y dentro del `describe` principal:

```typescript
  describe('cobranzas y movimientos', () => {
    it('cobranzas con recibo, cliente y anulación', async () => {
      const list = (await get(`/customer-payments?from=${D1}&to=${D2}`)).body as ListResult<CustomerPaymentItem>;
      expect(ids(list)).toEqual(['cp2', 'cp1']);
      expect(list).toMatchObject({ count: 2, netTotal: 0 });
      expect(list.items[1]).toEqual({
        id: 'cp1', day: D1, createdAt: `${D1}T15:00:00.000Z`, receipt: { date: D1, number: 1 }, branch: 'CENTRAL', pointOfSale: 'Caja 1',
        customer: { id: 'c1', name: 'Ana' }, payments: [{ method: 'cash', amount: 700 }], total: 700, voided: true, voidedBy: 'cp2',
      });
      expect(list.items[0]).toMatchObject({ voidsPaymentId: 'cp1', voided: false });
      const filtered = async (q: string) => ids((await get(`/customer-payments?from=${D1}&to=${D2}${q}`)).body as ListResult<CustomerPaymentItem>);
      expect(await filtered('&status=voided')).toEqual(['cp1']);
      expect(await filtered('&status=valid')).toEqual([]);
      expect(await filtered('&method=transfer')).toEqual([]);
      expect(await filtered('&customerId=c1')).toEqual(['cp2', 'cp1']);
    });

    it('la cobranza del admin aparece en la caja ADMIN', async () => {
      await request(app).post(`/api/tenants/${tenantId}/customers/c1/payments`).set('Authorization', `Bearer ${token}`).send({ amount: 100, method: 'transfer' });
      const today = argentinaToday(new Date());
      const list = (await get(`/customer-payments?from=${today}&to=${today}`)).body as ListResult<CustomerPaymentItem>;
      // Si hoy es D2, en la lista también está cp2: se busca por la caja
      const admin = list.items.find((p) => p.branch === 'ADMIN');
      expect(admin).toMatchObject({ pointOfSale: 'Oficina', payments: [{ method: 'transfer', amount: 100 }], total: 100 });
      expect(admin?.receipt).toBeUndefined();
      expect((await get(`/customer-payments?from=${today}&to=${today}&branch=ADMIN`)).body).toMatchObject({ count: 1 });
    });

    it('movimientos de caja con arqueo y total neto con signo', async () => {
      const list = (await get(`/cash-movements?from=${D1}&to=${D2}`)).body as ListResult<CashMovementItem>;
      expect(ids(list)).toEqual(['m3', 'm2', 'm1']);
      expect(list).toMatchObject({ count: 3, netTotal: 1350 });
      expect(list.items[0]).toEqual({
        id: 'm3', day: D1, createdAt: `${D1}T21:00:00.000Z`, branch: 'CENTRAL', pointOfSale: 'Caja 1', direction: 'out', amount: 150,
        concept: 'Ajuste por arqueo', source: 'count-adjustment', count: { expected: 3200, counted: 3050 },
      });
      const filtered = async (q: string) => ids((await get(`/cash-movements?from=${D1}&to=${D2}${q}`)).body as ListResult<CashMovementItem>);
      expect(await filtered('&direction=in')).toEqual(['m1']);
      expect(await filtered('&source=count-adjustment')).toEqual(['m3']);
      expect(await filtered('&source=manual&direction=out')).toEqual(['m2']);
      expect((await get(`/cash-movements?from=${D1}&to=${D2}&direction=lateral`)).status).toBe(400);
    });
  });
```

En `test/permissions-api.test.ts`:

```typescript
  'GET /customer-payments': 'tenant.use',
  'GET /cash-movements': 'tenant.use',
```

- [ ] **Paso 2: correrlos y verlos fallar**

Correr `pnpm vitest run test/sales-api.test.ts test/permissions-api.test.ts`. Esperado: FAIL con 404
en las rutas nuevas.

- [ ] **Paso 3: implementar en el servicio**

En `src/server/sales/sales-query-service.ts`, sumar los imports `CashMovementItem` y
`CustomerPaymentItem` (de `sales-types.ts`) y `readCashMovement` y `readCustomerPayment`, y los tipos
y el código:

```typescript
export type PaymentsFilter = DayRange & RegisterFilter & {
  method?: string | undefined;
  customerId?: string | undefined;
  status?: DocStatus | undefined;
};
export type MovementsFilter = DayRange & RegisterFilter & {
  direction?: 'in' | 'out' | undefined;
  source?: 'manual' | 'count-adjustment' | undefined;
};

type PaymentRow = {
  id: string;
  payload: string;
  branch: string | null;
  point_of_sale: string | null;
  customer_id: string;
  customer_name: string | null;
  voids_payment_id: string | null;
  created_at: string;
  day: string | null;
  total: number;
  voided_by: string | null;
};

type MovementRow = { id: string; payload: string; branch: string | null; point_of_sale: string | null; created_at: string; day: string | null };

const PAYMENT_COLUMNS = `cp.id, cp.payload, cp.branch, cp.point_of_sale, cp.customer_id, c.name AS customer_name, cp.voids_payment_id,
  cp.created_at, cp.day, COALESCE(json_extract(${safePayload('cp')}, '$.total'), 0) AS total,
  (SELECT v.id FROM customer_payments v WHERE v.voids_payment_id = cp.id ORDER BY v.created_at LIMIT 1) AS voided_by`;

const SIGNED_AMOUNT = (alias: string): string =>
  `CASE json_extract(${safePayload(alias)}, '$.direction')
     WHEN 'in' THEN json_extract(${safePayload(alias)}, '$.amount')
     WHEN 'out' THEN -json_extract(${safePayload(alias)}, '$.amount')
     ELSE 0 END`;

function paged(paging: Paging | undefined, params: Params): { limit: string; params: Params } {
  return paging === undefined
    ? { limit: '', params }
    : { limit: ' LIMIT ? OFFSET ?', params: [...params, paging.pageSize, (paging.page - 1) * paging.pageSize] };
}
```

Métodos nuevos de la clase:

```typescript
  listCustomerPayments(filter: PaymentsFilter, paging: Paging): ListResult<CustomerPaymentItem> {
    assertRange(filter);
    const where = this.paymentsWhere(filter);
    const totals = this.db
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(json_extract(${safePayload('cp')}, '$.total')), 0) AS net FROM customer_payments cp WHERE ${where.clauses.join(' AND ')}`)
      .get(...where.params) as { count: number; net: number };
    return {
      items: this.paymentRows(filter, paging).map((row) => this.toPaymentItem(row)),
      count: totals.count,
      page: paging.page,
      pageSize: paging.pageSize,
      netTotal: roundAmount(totals.net),
    };
  }

  listCashMovements(filter: MovementsFilter, paging: Paging): ListResult<CashMovementItem> {
    assertRange(filter);
    const where = this.movementsWhere(filter);
    const totals = this.db
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(${SIGNED_AMOUNT('m')}), 0) AS net FROM cash_movements m WHERE ${where.clauses.join(' AND ')}`)
      .get(...where.params) as { count: number; net: number };
    return {
      items: this.movementRows(filter, paging).map((row) => this.toMovementItem(row)),
      count: totals.count,
      page: paging.page,
      pageSize: paging.pageSize,
      netTotal: roundAmount(totals.net),
    };
  }

  protected paymentRows(filter: PaymentsFilter, paging?: Paging): PaymentRow[] {
    const where = this.paymentsWhere(filter);
    const page = paged(paging, where.params);
    return this.db
      .prepare(
        `SELECT ${PAYMENT_COLUMNS} FROM customer_payments cp LEFT JOIN customers c ON c.id = cp.customer_id
         WHERE ${where.clauses.join(' AND ')}
         ORDER BY cp.day DESC, cp.created_at DESC, cp.id DESC${page.limit}`,
      )
      .all(...page.params) as unknown as PaymentRow[];
  }

  protected toPaymentItem(row: PaymentRow): CustomerPaymentItem {
    const stored = readCustomerPayment(row.payload);
    const createdAt = stored.createdAt ?? row.created_at;
    return {
      id: row.id,
      day: row.day ?? argentinaDay(createdAt) ?? '',
      createdAt,
      ...(stored.receipt === undefined ? {} : { receipt: stored.receipt }),
      branch: row.branch,
      pointOfSale: row.point_of_sale,
      customer: { id: row.customer_id, ...(row.customer_name === null ? {} : { name: row.customer_name }) },
      payments: stored.payments,
      total: row.total,
      voided: row.voided_by !== null,
      ...(row.voided_by === null ? {} : { voidedBy: row.voided_by }),
      ...(row.voids_payment_id === null ? {} : { voidsPaymentId: row.voids_payment_id }),
    };
  }

  protected movementRows(filter: MovementsFilter, paging?: Paging): MovementRow[] {
    const where = this.movementsWhere(filter);
    const page = paged(paging, where.params);
    return this.db
      .prepare(
        `SELECT m.id, m.payload, m.branch, m.point_of_sale, m.created_at, m.day FROM cash_movements m
         WHERE ${where.clauses.join(' AND ')}
         ORDER BY m.day DESC, m.created_at DESC, m.id DESC${page.limit}`,
      )
      .all(...page.params) as unknown as MovementRow[];
  }

  protected toMovementItem(row: MovementRow): CashMovementItem {
    const { createdAt: storedAt, ...movement } = readCashMovement(row.payload);
    const createdAt = storedAt ?? row.created_at;
    return {
      id: row.id,
      day: row.day ?? argentinaDay(createdAt) ?? '',
      createdAt,
      branch: row.branch,
      pointOfSale: row.point_of_sale,
      ...movement,
    };
  }

  private paymentsWhere(filter: PaymentsFilter): Where {
    const where = rangeAndRegister('cp', filter);
    if (filter.method !== undefined) addMethod(where, 'cp', filter.method);
    if (filter.customerId !== undefined) {
      where.clauses.push('cp.customer_id = ?');
      where.params.push(filter.customerId);
    }
    const voided = 'EXISTS (SELECT 1 FROM customer_payments v WHERE v.voids_payment_id = cp.id)';
    if (filter.status === 'voided') where.clauses.push(voided);
    if (filter.status === 'valid') where.clauses.push(`cp.voids_payment_id IS NULL AND NOT ${voided}`);
    return where;
  }

  private movementsWhere(filter: MovementsFilter): Where {
    const where = rangeAndRegister('m', filter);
    if (filter.direction !== undefined) {
      where.clauses.push(`json_extract(${safePayload('m')}, '$.direction') = ?`);
      where.params.push(filter.direction);
    }
    if (filter.source !== undefined) {
      where.clauses.push(`json_extract(${safePayload('m')}, '$.source') = ?`);
      where.params.push(filter.source);
    }
    return where;
  }
```

Pasar `saleRows` a usar `paged` también, para no repetir el armado del `LIMIT`.

- [ ] **Paso 4: rutas**

En `src/server/routes/sales-routes.ts`:

```typescript
export const paymentsQuerySchema = z.object({ ...base, ...paging, method: optionalText, customerId: optionalText, status });
export const movementsQuerySchema = z.object({
  ...base,
  ...paging,
  direction: z.enum(['in', 'out']).optional(),
  source: z.enum(['manual', 'count-adjustment']).optional(),
});
```

y en `createSalesRoutes`:

```typescript
  router.get('/customer-payments', use, handle(paymentsQuerySchema, (service, q) => service.listCustomerPayments(q, { page: q.page, pageSize: q.pageSize })));
  router.get('/cash-movements', use, handle(movementsQuerySchema, (service, q) => service.listCashMovements(q, { page: q.page, pageSize: q.pageSize })));
```

- [ ] **Paso 5: correr los tests y verlos pasar**

Correr `pnpm vitest run test/sales-api.test.ts test/permissions-api.test.ts`. Esperado: PASS.

- [ ] **Paso 6: suite completa y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/server/sales/sales-query-service.ts src/server/routes/sales-routes.ts test/sales-api.test.ts test/permissions-api.test.ts
git commit -m "feat: consulta de cobranzas y movimientos de caja (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar para la revisión.

---

### Tarea 6: resumen por caja y día

**Archivos:**
- Modificar: `src/server/sales/sales-query-service.ts`, `src/server/routes/sales-routes.ts`,
  `test/sales-api.test.ts`, `test/permissions-api.test.ts`.

**Interfaces:**
- Consume: `calculateDaySummary` (Tarea 3) y las filas de las Tareas 4 y 5.
- Produce:
  - `cashSummary(filter: DayRange & RegisterFilter): CashSummaryResult`;
  - `daySummary(filter: { day: string } & RegisterFilter): DaySummaryResult`;
  - las rutas `GET /cash-summary` y `GET /cash-summary/day`.

- [ ] **Paso 1: escribir los tests que fallan (la prueba de cuadre)**

En `test/sales-api.test.ts`, importar `CashSummaryResult` y `DaySummaryResult`, y:

```typescript
  describe('resumen por caja y día', () => {
    it('una fila por día y caja, con totales', async () => {
      const res = (await get(`/cash-summary?from=${D1}&to=${D2}`)).body as CashSummaryResult;
      expect(res.rows).toEqual([
        { day: D2, branch: 'CENTRAL', pointOfSale: 'Caja 1', totalSold: -1200, ticketCount: 2, voidedCount: 0, collectionsTotal: -700, cashIncome: 0, cashExpense: 0, cashCountAdjustments: 0, cashNet: -1900 },
        { day: D1, branch: 'CENTRAL', pointOfSale: 'Caja 1', totalSold: 1450, ticketCount: 2, voidedCount: 1, collectionsTotal: 700, cashIncome: 2000, cashExpense: 500, cashCountAdjustments: -150, cashNet: 3050 },
        { day: D1, branch: 'CENTRAL', pointOfSale: 'Caja 2', totalSold: 300, ticketCount: 1, voidedCount: 0, collectionsTotal: 0, cashIncome: 0, cashExpense: 0, cashCountAdjustments: 0, cashNet: 0 },
      ]);
      expect(res.totals).toEqual({ totalSold: 550, ticketCount: 5, voidedCount: 1, collectionsTotal: 0, cashIncome: 2000, cashExpense: 500, cashCountAdjustments: -150, cashNet: 1150 });
      const soloCaja2 = (await get(`/cash-summary?from=${D1}&to=${D2}&pointOfSale=Caja%202`)).body as CashSummaryResult;
      expect(soloCaja2.rows).toHaveLength(1);
    });

    it('el día de una caja cuadra con el /RESUMEN y trae sus movimientos', async () => {
      const res = (await get(`/cash-summary/day?day=${D1}&branch=CENTRAL&pointOfSale=Caja%201`)).body as DaySummaryResult;
      // Calculado a mano con las reglas del /RESUMEN: s1 + s2 (la anulación de s1 es de D2), cp1, m1, m2 y m3
      expect(res.summary).toEqual({
        totalSold: 1450,
        ticketCount: 2,
        voidedCount: 1,
        adjustmentTotal: -50,
        totalsByMethod: { cash: 1000, debit: 450, credit: 0, transfer: 0, qr: 0, account: 0, other: 0 },
        otherPayments: 450,
        cash: { sales: 1000, income: 2000, expense: 500, countAdjustments: -150, collections: 700 },
        collections: { total: 700, count: 1, voidedCount: 1 },
        collectionsByMethod: { cash: 700, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0, other: 0 },
      });
      expect(res.entries.map((e) => `${e.kind}:${e.kind === 'sale' ? e.sale.id : e.kind === 'movement' ? e.movement.id : e.payment.id}`)).toEqual([
        'movement:m3', 'movement:m2', 'collection:cp1', 'sale:s2', 'sale:s1', 'movement:m1',
      ]);
      expect((await get('/cash-summary/day?day=ayer')).status).toBe(400);
    });
  });
```

En `test/permissions-api.test.ts`:

```typescript
  'GET /cash-summary': 'tenant.use',
  'GET /cash-summary/day': 'tenant.use',
```

- [ ] **Paso 2: correrlos y verlos fallar**

Correr `pnpm vitest run test/sales-api.test.ts test/permissions-api.test.ts`. Esperado: FAIL con 404.

- [ ] **Paso 3: implementar en el servicio**

Sumar los imports `calculateDaySummary` y los tipos `SummarySale`, `SummaryMovement` y
`SummaryCollection` (de `./day-summary.ts`), y `CashSummaryResult`, `CashSummaryRow`,
`CashSummaryTotals`, `DayEntry` y `DaySummaryResult` (de `sales-types.ts`). Métodos y ayudantes:

```typescript
type Documents = { sales: SaleRow[]; payments: PaymentRow[]; movements: MovementRow[] };

function emptyTotals(): CashSummaryTotals {
  return { totalSold: 0, ticketCount: 0, voidedCount: 0, collectionsTotal: 0, cashIncome: 0, cashExpense: 0, cashCountAdjustments: 0, cashNet: 0 };
}

function addTotals(a: CashSummaryTotals, b: CashSummaryTotals): CashSummaryTotals {
  return {
    totalSold: roundAmount(a.totalSold + b.totalSold),
    ticketCount: a.ticketCount + b.ticketCount,
    voidedCount: a.voidedCount + b.voidedCount,
    collectionsTotal: roundAmount(a.collectionsTotal + b.collectionsTotal),
    cashIncome: roundAmount(a.cashIncome + b.cashIncome),
    cashExpense: roundAmount(a.cashExpense + b.cashExpense),
    cashCountAdjustments: roundAmount(a.cashCountAdjustments + b.cashCountAdjustments),
    cashNet: roundAmount(a.cashNet + b.cashNet),
  };
}

/** Orden de las filas: día descendente; dentro del día, la caja ascendente (sin dato primero). */
function compareRows(a: CashSummaryRow, b: CashSummaryRow): number {
  return b.day.localeCompare(a.day) || (a.branch ?? '').localeCompare(b.branch ?? '') || (a.pointOfSale ?? '').localeCompare(b.pointOfSale ?? '');
}
```

```typescript
  cashSummary(filter: DayRange & RegisterFilter): CashSummaryResult {
    assertRange(filter);
    const docs = this.documents(filter);
    const groups = new Map<string, { day: string; branch: string | null; pointOfSale: string | null } & Documents>();
    const groupOf = (day: string | null, branch: string | null, pointOfSale: string | null) => {
      const key = JSON.stringify([day, branch, pointOfSale]);
      const existing = groups.get(key);
      if (existing !== undefined) return existing;
      const fresh = { day: day ?? '', branch, pointOfSale, sales: [], payments: [], movements: [] };
      groups.set(key, fresh);
      return fresh;
    };
    for (const row of docs.sales) groupOf(row.day, row.branch, row.point_of_sale).sales.push(row);
    for (const row of docs.payments) groupOf(row.day, row.branch, row.point_of_sale).payments.push(row);
    for (const row of docs.movements) groupOf(row.day, row.branch, row.point_of_sale).movements.push(row);

    const rows = [...groups.values()]
      .map((group): CashSummaryRow => ({ day: group.day, branch: group.branch, pointOfSale: group.pointOfSale, ...this.rowTotals(group) }))
      .sort(compareRows);
    const totals = rows.reduce<CashSummaryTotals>((sum, row) => addTotals(sum, row), emptyTotals());
    return { rows, totals };
  }

  daySummary(filter: { day: string } & RegisterFilter): DaySummaryResult {
    const docs = this.documents({ from: filter.day, to: filter.day, branch: filter.branch, pointOfSale: filter.pointOfSale });
    const entries: DayEntry[] = [
      ...docs.sales.map((row): DayEntry => {
        const sale = this.toSaleItem(row);
        return { kind: 'sale', at: sale.createdAt, sale };
      }),
      ...docs.movements.map((row): DayEntry => {
        const movement = this.toMovementItem(row);
        return { kind: 'movement', at: movement.createdAt, movement };
      }),
      ...docs.payments.map((row): DayEntry => {
        const payment = this.toPaymentItem(row);
        return { kind: 'collection', at: payment.createdAt, payment };
      }),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return { day: filter.day, summary: this.summaryOf(docs), entries };
  }

  private documents(filter: DayRange & RegisterFilter): Documents {
    return {
      sales: this.saleRows(filter),
      payments: this.paymentRows(filter),
      movements: this.movementRows(filter),
    };
  }

  private summaryOf(docs: Documents) {
    const sales: SummarySale[] = docs.sales.map((row) => {
      const stored = readSale(row.payload);
      return { id: row.id, total: row.total, lines: stored.lines, payments: stored.payments };
    });
    const movements: SummaryMovement[] = docs.movements.map((row) => {
      const stored = readCashMovement(row.payload);
      return { direction: stored.direction, amount: stored.amount, source: stored.source };
    });
    const collections: SummaryCollection[] = docs.payments.map((row) => ({
      id: row.id,
      total: row.total,
      payments: readCustomerPayment(row.payload).payments,
    }));
    return calculateDaySummary({
      sales,
      movements,
      collections,
      voidedSaleIds: new Set(docs.sales.flatMap((row) => (row.voided_by === null ? [] : [row.id]))),
      voidedPaymentIds: new Set(docs.payments.flatMap((row) => (row.voided_by === null ? [] : [row.id]))),
    });
  }

  private rowTotals(docs: Documents): CashSummaryTotals {
    const s = this.summaryOf(docs);
    return {
      totalSold: s.totalSold,
      ticketCount: s.ticketCount,
      voidedCount: s.voidedCount,
      collectionsTotal: s.collections.total,
      cashIncome: s.cash.income,
      cashExpense: s.cash.expense,
      cashCountAdjustments: s.cash.countAdjustments,
      cashNet: roundAmount(s.cash.sales + s.cash.income - s.cash.expense + s.cash.countAdjustments + s.cash.collections),
    };
  }
```

> Ventas con anulación: `voided_by` sale de la subconsulta de `SALE_COLUMNS`, que busca en toda la
> tabla. Una venta de D1 anulada en D2 cuenta como anulada en D1, como en el POS.

- [ ] **Paso 4: rutas**

En `src/server/routes/sales-routes.ts`:

```typescript
export const summaryQuerySchema = z.object(base);
export const dayQuerySchema = z.object({ day, branch: optionalText, pointOfSale: optionalText });
```

```typescript
  router.get('/cash-summary', use, handle(summaryQuerySchema, (service, q) => service.cashSummary(q)));
  router.get('/cash-summary/day', use, handle(dayQuerySchema, (service, q) => service.daySummary(q)));
```

- [ ] **Paso 5: correr los tests y verlos pasar**

Correr `pnpm vitest run test/sales-api.test.ts test/permissions-api.test.ts`. Esperado: PASS.

- [ ] **Paso 6: suite completa y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/server/sales/sales-query-service.ts src/server/routes/sales-routes.ts test/sales-api.test.ts test/permissions-api.test.ts
git commit -m "feat: resumen por caja y día que cuadra con el /RESUMEN del POS (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar para la revisión.

---

### Tarea 7: dashboard con día argentino y anulaciones como el POS

**Archivos:**
- Modificar: `src/server/dashboard/dashboard-service.ts`, `src/server/di/container.ts`
  (`dashboardSummaryServiceDef`), `test/dashboard-top-products.test.ts` (su `insertSale`).
- Test: `test/dashboard-argentina.test.ts` (nuevo).

**Interfaces:**
- Consume: `argentinaToday`, `argentinaHour`, `shiftDay` (Tarea 1); `readSale` (Tarea 4);
  `saveSale` (Tarea 2, en el test).
- Produce: `new DashboardService(db, now: () => Date = () => new Date())`. La respuesta mantiene la
  forma de hoy; `TimelinePoint.date` pasa a ser el día argentino (lo usa el drill-down del gráfico).

- [ ] **Paso 1: escribir el test que falla**

`test/dashboard-argentina.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { DashboardService } from '../src/server/dashboard/dashboard-service.ts';
import { saveSale } from '../src/server/sales/records.ts';

const caja = { deviceId: 'dev', branch: 'CENTRAL', pointOfSale: 'Caja 1' };
// 22:30 del 1/10 en Argentina; en UTC ya es el 2/10
const now = new Date('2026-10-02T01:30:00.000Z');

function sale(db: DatabaseSync, id: string, createdAt: string, total: number, lines: unknown[], extra: Record<string, unknown> = {}): void {
  saveSale(db, { id, status: 'closed', createdAt, total, lines, payments: [{ method: 'cash', amount: total }], ...extra }, caja, createdAt);
}

describe('dashboard con día argentino y anulaciones como el POS (#20)', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    initTenantDb(db);
    const at = now.toISOString();
    db.prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p1', 'S1', 'Alfajor', 1000, ?, ?)").run(at, at);
    db.prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p2', 'S2', 'Gaseosa', 500, ?, ?)").run(at, at);
    // Ayer: c, anulada hoy por d
    sale(db, 'c', '2026-09-30T15:00:00.000Z', 2000, [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 1000 }]);
    // Hoy (argentino): d anula c a las 19:00; a a las 20:00; b a las 21:30 (en UTC, 2/10)
    sale(db, 'd', '2026-10-01T22:00:00.000Z', -2000, [{ kind: 'product', productId: 'p1', qty: -2, unitPrice: 1000 }], { voidsSaleId: 'c' });
    sale(db, 'a', '2026-10-01T23:00:00.000Z', 1000, [{ kind: 'product', productId: 'p2', qty: 2, unitPrice: 500 }]);
    sale(db, 'b', '2026-10-02T00:30:00.000Z', 500, [{ kind: 'product', productId: 'p2', qty: 1, unitPrice: 500 }]);
  });

  it('hoy: neto de todos los tickets, vigentes para cantidad y promedio, ayer completo para comparar', () => {
    const res = new DashboardService(db, () => now).getSummary({ period: 'today' });
    expect(res.summary).toMatchObject({
      totalSales: -500,
      salesCount: 2,
      averageTicket: 750,
      previousTotalSales: 2000,
      changePercentage: -125,
    });
    expect(res.timeline).toHaveLength(8);
    expect(res.timeline.every((p) => p.date === '2026-10-01')).toBe(true);
    expect(res.timeline.find((p) => p.label === '18:00')).toMatchObject({ total: -1000, count: 1 });
    expect(res.timeline.find((p) => p.label === '21:00')).toMatchObject({ total: 500, count: 1 });
  });

  it('el ranking netea las anulaciones y muestra solo unidades positivas', () => {
    const res = new DashboardService(db, () => now).getSummary({ period: 'today' });
    expect(res.topProducts.map((p) => [p.productId, p.unitsSold])).toEqual([['p2', 3]]);
  });

  it('7 días: un punto por día argentino, el último es hoy', () => {
    const res = new DashboardService(db, () => now).getSummary({ period: 'week' });
    expect(res.timeline.map((p) => p.date)).toEqual([
      '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01',
    ]);
    expect(res.summary.totalSales).toBe(1500);
    expect(res.summary.salesCount).toBe(2);
    expect(res.timeline.at(-2)).toMatchObject({ total: 2000, count: 0 });
  });
});
```

> En la semana, `c` (ayer) y su anulación `d` (hoy) se cancelan: el total es 1000 + 500 = 1500 y `c`
> no cuenta como vigente. El punto de ayer suma 2000 con `count` 0, porque su único ticket está
> anulado.

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/dashboard-argentina.test.ts`. Esperado: FAIL. El constructor no recibe
el reloj, "hoy" sale de la hora del servidor y las anulaciones se descartan.

- [ ] **Paso 3: implementar**

En `src/server/dashboard/dashboard-service.ts`:

- Constructor:

```typescript
  private db: DatabaseSync;
  private now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }
```

- Reemplazar `SaleRow`, `getSummary`, `fetchValidSales`, `calculateDateRanges` y `buildTimeline`:

```typescript
type SaleRow = {
  id: string;
  payload: string;
  total: number;
  created_at: string;
  day: string;
  voids_sale_id: string | null;
  voided: number;
};

const PERIOD_DAYS: Record<DashboardPeriod, number> = { today: 1, week: 7, month: 30 };
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Vigente: ni anulación ni anulada (#20). La cantidad de tickets y el promedio cuentan solo estos. */
function isValid(sale: SaleRow): boolean {
  return sale.voids_sale_id === null && sale.voided === 0;
}

function dayLabel(day: string, withWeekday: boolean): string {
  const [, month = '', date = ''] = day.split('-');
  const weekday = WEEKDAYS[new Date(`${day}T12:00:00.000Z`).getUTCDay()] ?? '';
  return withWeekday ? `${weekday} ${date}/${month}` : `${date}/${month}`;
}
```

```typescript
  public getSummary(options?: { period?: DashboardPeriod | undefined; branchId?: string | undefined }): DashboardSummaryResponse {
    const period: DashboardPeriod = options?.period ?? 'today';
    const branchId = options?.branchId;

    // Días argentinos (#20): hoy, y el bloque de la misma cantidad de días justo antes
    const days = PERIOD_DAYS[period];
    const today = argentinaToday(this.now());
    const from = shiftDay(today, -(days - 1));
    const sales = this.fetchSales(from, today, branchId);
    const prevSales = this.fetchSales(shiftDay(from, -days), shiftDay(from, -1), branchId);

    // Como el POS: el total es el neto de todos los tickets; cantidad y promedio, de los vigentes
    const valid = sales.filter(isValid);
    const totalSales = roundAmount(sales.reduce((acc, s) => acc + s.total, 0));
    const salesCount = valid.length;
    const averageTicket = salesCount > 0 ? roundAmount(valid.reduce((acc, s) => acc + s.total, 0) / salesCount) : 0;
    const previousTotalSales = roundAmount(prevSales.reduce((acc, s) => acc + s.total, 0));
    const changePercentage =
      previousTotalSales !== 0
        ? Math.round(((totalSales - previousTotalSales) / Math.abs(previousTotalSales)) * 1000) / 10
        : 0;

    const timeline = period === 'today' ? this.hourlyTimeline(sales, today) : this.dailyTimeline(sales, from, days, period === 'week');
    const topProducts = this.calculateTopProducts(sales);
    const customerMetrics = this.calculateCustomerMetrics();
    const stockAlerts = this.calculateStockAlerts(branchId);

    return {
      period,
      ...(branchId === undefined ? {} : { branchId }),
      summary: {
        totalSales,
        salesCount,
        averageTicket,
        previousTotalSales,
        changePercentage,
        totalReceivables: customerMetrics.totalReceivables,
        debtorCount: customerMetrics.debtorCount,
        totalCustomers: customerMetrics.totalCustomers,
      },
      timeline,
      topProducts,
      stockAlerts,
    };
  }

  private fetchSales(from: string, to: string, branchId?: string): SaleRow[] {
    let sql = `
      SELECT s.id, s.payload, s.total, s.created_at, s.day, s.voids_sale_id,
        EXISTS (SELECT 1 FROM sales v WHERE v.voids_sale_id = s.id) AS voided
      FROM sales s
      WHERE s.day BETWEEN ? AND ?`;
    const params: string[] = [from, to];
    if (branchId !== undefined && branchId !== '') {
      sql += ' AND s.branch = ?';
      params.push(branchId);
    }
    return this.db.prepare(`${sql} ORDER BY s.created_at ASC`).all(...params) as unknown as SaleRow[];
  }

  /** "Hoy": tramos de 3 horas argentinas, sobre el `createdAt` de cada venta. */
  private hourlyTimeline(sales: SaleRow[], today: string): TimelinePoint[] {
    const points: TimelinePoint[] = [];
    for (let h = 0; h < 24; h += 3) {
      const inSlot = sales.filter((s) => {
        const hour = argentinaHour(readSale(s.payload).createdAt ?? s.created_at);
        return hour !== null && hour >= h && hour < h + 3;
      });
      points.push({
        date: today,
        label: `${String(h).padStart(2, '0')}:00`,
        total: roundAmount(inSlot.reduce((acc, s) => acc + s.total, 0)),
        count: inSlot.filter(isValid).length,
      });
    }
    return points;
  }

  private dailyTimeline(sales: SaleRow[], from: string, days: number, withWeekday: boolean): TimelinePoint[] {
    return Array.from({ length: days }, (_, i) => {
      const day = shiftDay(from, i);
      const inDay = sales.filter((s) => s.day === day);
      return {
        date: day,
        label: dayLabel(day, withWeekday),
        total: roundAmount(inDay.reduce((acc, s) => acc + s.total, 0)),
        count: inDay.filter(isValid).length,
      };
    });
  }
```

- En `calculateTopProducts`, después de armar `entries`, filtrar las unidades netas positivas antes
  de ordenar: `Array.from(entries.values()).filter((e) => e.units > 0).sort(...)`.
- Imports: `argentinaHour`, `argentinaToday` y `shiftDay` de `../../shared/argentina-day.ts`, y
  `readSale` de `../sales/stored-documents.ts`. Borrar lo que quede sin uso (`calculateDateRanges`).

En `src/server/di/container.ts`:

```typescript
export const dashboardSummaryServiceDef = fn.scoped((c) => new DashboardService(c.use(tenantDbDef), c.use(clockDef)));
```

En `test/dashboard-top-products.test.ts`, el `insertSale` del archivo tiene que completar el día.
Agregar la columna con el día argentino de hoy:

```typescript
import { argentinaToday } from '../src/shared/argentina-day.ts';

function insertSale(db: DatabaseSync, id: string, payload: string, total: number): void {
  db.prepare(
    `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at, day)
     VALUES (?, ?, 'pos_1', 'CENTRAL', 'Caja 1', ?, NULL, ?, ?)`,
  ).run(id, payload, total, new Date().toISOString(), argentinaToday(new Date()));
}
```

- [ ] **Paso 4: correr los tests y verlos pasar**

Correr `pnpm vitest run test/dashboard-argentina.test.ts test/dashboard-top-products.test.ts test/dashboard-summary.test.ts test/ioc-container.test.ts`.
Esperado: PASS.

Si un caso de `dashboard-top-products` dependía de que las anulaciones se descartaran, ajustar lo
esperado a la regla nueva (neto y solo positivos) y decirlo en la revisión.

- [ ] **Paso 5: suite completa y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }
git add src/server/dashboard/dashboard-service.ts src/server/di/container.ts test/dashboard-argentina.test.ts test/dashboard-top-products.test.ts
git commit -m "feat: el dashboard usa el día argentino y cuenta las anulaciones como el POS (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Frenar para la revisión.

---

### Tarea 8: cliente, sección Ventas & Caja con la solapa Ventas y el ticket

**Archivos:**
- Crear:
  - estado: `src/client/format.ts`, `src/client/state/sales-labels.ts`,
    `src/client/state/sales-state.ts`;
  - componentes: `src/client/components/ui/Pagination.tsx` y, en `src/client/components/sales/`,
    `SalesView.tsx`, `SalesTabs.tsx`, `SalesRangeBar.tsx`, `CustomerPicker.tsx`, `SalesTable.tsx`,
    `TicketDrawer.tsx` y `SaleBadges.tsx`.
- Modificar: `src/client/state/navigation-state.ts`, `src/client/state/permissions-state.ts`,
  `src/client/components/shell/Sidebar.tsx`, `src/client/App.tsx`.
- Test: `test/sales-client.test.ts` (nuevo).

**Interfaces:**
- Consume: los tipos de `src/shared/sales-types.ts`, `argentinaToday` y `shiftDay`, `PAYMENT_METHODS`
  y las rutas de las Tareas 4 a 6.
- Produce:
  - de `format.ts`: `formatMoney`, `formatQty`, `formatDay`, `formatDateTime` y `formatTime`, todas con
    `(valor, locale?: string | undefined)`;
  - de `sales-labels.ts`: `methodLabel`, `registerLabel(branch, pointOfSale)`,
    `customerLabel(customer?)`, `registerKey(choice)` y `parseRegisterKey(key)`;
  - de `sales-state.ts`:
    - signals: `salesTabSignal`, `rangePresetSignal`, `rangeSignal`, `registerSignal`,
      `salesFiltersSignal`, `paymentsFiltersSignal`, `movementsFiltersSignal`, `pageSignal`,
      `registersSignal`, `salesListSignal`, `paymentsListSignal`, `movementsListSignal`,
      `cashSummarySignal`, `ticketSignal`, `paymentDetailSignal`, `daySummarySignal`,
      `salesLoadingSignal` y `salesErrorSignal`;
    - funciones: `presetRange`, `buildQuery`, `endpointFor`, `loadTab`, `openTicket`, `closeTicket`,
      `applyPreset`, `setCustomRange`, `setRegister`, `setTab`, `setSalesFilters`,
      `setPaymentsFilters`, `setMovementsFilters`, `setPage`, `openSalesWith` y
      `registerSalesEffects`;
  - `ActiveNavView` con `'sales'`.

- [ ] **Paso 1: escribir el test que falla**

`test/sales-client.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDay, formatMoney, formatQty } from '../src/client/format.ts';
import { customerLabel, methodLabel, parseRegisterKey, registerKey, registerLabel } from '../src/client/state/sales-labels.ts';
import {
  buildQuery, endpointFor, loadTab, openSalesWith, openTicket, presetRange, rangeSignal, registerSignal,
  salesFiltersSignal, salesListSignal, salesTabSignal, ticketSignal, pageSignal, type SalesQueryInput,
} from '../src/client/state/sales-state.ts';
import { activeViewSignal } from '../src/client/state/navigation-state.ts';
import { tokenSignal, activeTenantIdSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';

const originalFetch = globalThis.fetch;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const input = (patch: Partial<SalesQueryInput> = {}): SalesQueryInput => ({
  tab: 'sales',
  range: { from: '2026-10-01', to: '2026-10-02' },
  register: {},
  sales: { status: 'all' },
  payments: { status: 'all' },
  movements: {},
  page: 1,
  ...patch,
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
  tokenSignal.value = 'tok';
  userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'T', status: 'active', role: 'member' }];
  activeTenantIdSignal.value = 't1';
});

describe('formato según el navegador (#20, #51)', () => {
  it('importes, cantidades y días sin correrse por la zona horaria', () => {
    expect(formatMoney(1234.5, 'es-AR')).toContain('1.234,50');
    expect(formatQty(0.333, 'es-AR')).toBe('0,333');
    expect(formatDay('2026-10-01', 'en-US')).toBe('Oct 1, 2026');
  });
});

describe('etiquetas (#20)', () => {
  it('medios, cajas y clientes', () => {
    expect(methodLabel('cash')).toBe('Efectivo');
    expect(methodLabel('crypto')).toBe('Otro');
    expect(registerLabel('CENTRAL', 'Caja 1')).toBe('CENTRAL · Caja 1');
    expect(registerLabel('CENTRAL', null)).toBe('CENTRAL · Sin punto de venta');
    expect(registerLabel('ADMIN', 'Oficina')).toBe('Admin');
    expect(customerLabel(undefined)).toBe('Consumidor final');
    expect(customerLabel({ id: 'c9' })).toBe('Cliente desconocido (c9)');
    expect(customerLabel({ id: 'c1', name: 'Ana' })).toBe('Ana');
  });

  it('la clave de una caja ida y vuelta, con el vacío como "sin dato"', () => {
    expect(registerKey({})).toBe('');
    expect(parseRegisterKey('')).toEqual({});
    expect(parseRegisterKey(registerKey({ branch: 'CENTRAL', pointOfSale: '' }))).toEqual({ branch: 'CENTRAL', pointOfSale: '' });
    expect(parseRegisterKey(registerKey({ branch: 'CENTRAL' }))).toEqual({ branch: 'CENTRAL' });
  });
});

describe('estado de Ventas & Caja (#20)', () => {
  it('rangos de los atajos', () => {
    expect(presetRange('today', '2026-10-02')).toEqual({ from: '2026-10-02', to: '2026-10-02' });
    expect(presetRange('yesterday', '2026-10-02')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(presetRange('week', '2026-10-02')).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(presetRange('month', '2026-10-02')).toEqual({ from: '2026-09-03', to: '2026-10-02' });
  });

  it('la query deja afuera lo indefinido y conserva el vacío (sin punto de venta)', () => {
    expect(buildQuery({ a: 'x', b: undefined, c: '', d: 2 })).toBe('a=x&c=&d=2');
  });

  it('el endpoint de cada solapa con sus filtros', () => {
    expect(endpointFor(input())).toBe('sales?from=2026-10-01&to=2026-10-02&page=1&pageSize=50');
    expect(endpointFor(input({ register: { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, sales: { status: 'voided', method: 'cash' }, page: 2 })))
      .toBe('sales?from=2026-10-01&to=2026-10-02&branch=CENTRAL&pointOfSale=Caja+1&method=cash&status=voided&page=2&pageSize=50');
    expect(endpointFor(input({ tab: 'payments', payments: { status: 'all', customerId: 'c1' } })))
      .toBe('customer-payments?from=2026-10-01&to=2026-10-02&customerId=c1&page=1&pageSize=50');
    expect(endpointFor(input({ tab: 'movements', movements: { direction: 'out' } })))
      .toBe('cash-movements?from=2026-10-01&to=2026-10-02&direction=out&page=1&pageSize=50');
    expect(endpointFor(input({ tab: 'summary' }))).toBe('cash-summary?from=2026-10-01&to=2026-10-02');
  });

  it('carga la solapa y abre el ticket', async () => {
    const list = { items: [], count: 0, page: 1, pageSize: 50, netTotal: 0 };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, list)).mockResolvedValueOnce(json(200, { id: 's1' }));
    globalThis.fetch = fetchMock;
    await loadTab(input());
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/tenants/t1/sales?from=2026-10-01&to=2026-10-02&page=1&pageSize=50');
    expect(salesListSignal.value).toEqual(list);
    await openTicket('s1');
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('/api/tenants/t1/sales/s1');
    expect(ticketSignal.value).toEqual({ id: 's1' });
  });

  it('el drill-down pone los filtros y navega a la sección', () => {
    pageSignal.value = 3;
    openSalesWith({ range: { from: '2026-09-26', to: '2026-10-02' }, branch: 'CENTRAL', status: 'valid', productId: 'p1' });
    expect(activeViewSignal.value).toBe('sales');
    expect(salesTabSignal.value).toBe('sales');
    expect(rangeSignal.value).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(registerSignal.value).toEqual({ branch: 'CENTRAL' });
    expect(salesFiltersSignal.value).toEqual({ status: 'valid', productId: 'p1' });
    expect(pageSignal.value).toBe(1);
  });
});
```

> Revisar en `test/discrepancy-client.test.ts` la forma de `userTenantsSignal` y que `apiFetch`
> arme `/api/<path>`; ajustar las URL esperadas si difieren.

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/sales-client.test.ts`. Esperado: FAIL, porque los módulos no existen.

- [ ] **Paso 3: formato y etiquetas**

`src/client/format.ts`:

```typescript
/**
 * Fechas, horas, cantidades e importes con la configuración del navegador (#51): su locale y su
 * preferencia de 12 o 24 horas. La moneda es siempre ARS. `locale` existe para los tests.
 */
export function formatMoney(amount: number, locale?: string | undefined): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'ARS' }).format(amount);
}

export function formatQty(qty: number, locale?: string | undefined): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(qty);
}

/** Un día `AAAA-MM-DD` (el día argentino de mini) se muestra tal cual, sin pasar por la zona horaria. */
export function formatDay(day: string, locale?: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00.000Z`));
}

export function formatDateTime(iso: string, locale?: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function formatTime(iso: string, locale?: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso));
}
```

`src/client/state/sales-labels.ts`:

```typescript
import { z } from 'zod';
import { methodKey, type MethodKey } from '../../shared/payment-methods.ts';
import type { CustomerRef, SaleKind } from '../../shared/sales-types.ts';

const METHOD_LABELS: Record<MethodKey, string> = {
  cash: 'Efectivo',
  debit: 'Débito',
  credit: 'Crédito',
  transfer: 'Transferencia',
  qr: 'QR',
  account: 'Cuenta corriente',
  other: 'Otro',
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[methodKey(method)];
}

export const KIND_LABELS: Record<SaleKind, string> = { sale: 'Venta', return: 'Devolución', void: 'Anulación' };

/** La caja como la ve el comerciante; la cobranza cargada en el admin es "Admin". */
export function registerLabel(branch: string | null, pointOfSale: string | null): string {
  if (branch === 'ADMIN') return 'Admin';
  const pos = pointOfSale === null || pointOfSale === '' ? 'Sin punto de venta' : pointOfSale;
  return branch === null || branch === '' ? pos : `${branch} · ${pos}`;
}

export function customerLabel(customer: CustomerRef | undefined): string {
  if (customer === undefined) return 'Consumidor final';
  return customer.name ?? `Cliente desconocido (${customer.id})`;
}

export type RegisterChoice = { branch?: string | undefined; pointOfSale?: string | undefined };

/** Clave de un `<select>` de cajas: `''` es "todas"; `null` adentro es "sin filtro" en ese campo. */
export function registerKey(choice: RegisterChoice): string {
  if (choice.branch === undefined && choice.pointOfSale === undefined) return '';
  return JSON.stringify([choice.branch ?? null, choice.pointOfSale ?? null]);
}

const keySchema = z.tuple([z.string().nullable(), z.string().nullable()]);

export function parseRegisterKey(key: string): RegisterChoice {
  if (key === '') return {};
  let raw: unknown;
  try {
    raw = JSON.parse(key);
  } catch {
    return {};
  }
  const parsed = keySchema.safeParse(raw);
  if (!parsed.success) return {};
  const [branch, pointOfSale] = parsed.data;
  return { ...(branch === null ? {} : { branch }), ...(pointOfSale === null ? {} : { pointOfSale }) };
}
```

- [ ] **Paso 4: estado de la sección**

`src/client/state/sales-state.ts`:

```typescript
import { signal, effect } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { activeViewSignal, navigateTo } from './navigation-state.ts';
import { customersSignal, fetchCustomers } from './customer-state.ts';
import type { RegisterChoice } from './sales-labels.ts';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import type {
  CashMovementItem, CashSummaryResult, CustomerPaymentItem, DaySummaryResult, DocStatus, ListResult, RegisterItem,
  SaleDetail, SaleKind, SaleListItem,
} from '../../shared/sales-types.ts';

export type SalesTab = 'sales' | 'payments' | 'movements' | 'summary';
export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
export type DayRange = { from: string; to: string };
export type SalesFilters = {
  method?: string | undefined;
  customerId?: string | undefined;
  productId?: string | undefined;
  kind?: SaleKind | undefined;
  status: DocStatus;
};
export type PaymentsFilters = { method?: string | undefined; customerId?: string | undefined; status: DocStatus };
export type MovementsFilters = { direction?: 'in' | 'out' | undefined; source?: 'manual' | 'count-adjustment' | undefined };

export const PAGE_SIZE = 50;

export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): DayRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yesterday = shiftDay(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'week':
      return { from: shiftDay(today, -6), to: today };
    case 'month':
      return { from: shiftDay(today, -29), to: today };
  }
}

// Filtros: rango y caja son compartidos por las cuatro solapas (#20)
export const salesTabSignal = signal<SalesTab>('sales');
export const rangePresetSignal = signal<RangePreset>('today');
export const rangeSignal = signal<DayRange>(presetRange('today', argentinaToday(new Date())));
export const registerSignal = signal<RegisterChoice>({});
export const salesFiltersSignal = signal<SalesFilters>({ status: 'all' });
export const paymentsFiltersSignal = signal<PaymentsFilters>({ status: 'all' });
export const movementsFiltersSignal = signal<MovementsFilters>({});
export const pageSignal = signal<number>(1);

// Datos
export const registersSignal = signal<RegisterItem[]>([]);
export const salesListSignal = signal<ListResult<SaleListItem> | null>(null);
export const paymentsListSignal = signal<ListResult<CustomerPaymentItem> | null>(null);
export const movementsListSignal = signal<ListResult<CashMovementItem> | null>(null);
export const cashSummarySignal = signal<CashSummaryResult | null>(null);
export const salesLoadingSignal = signal<boolean>(false);
export const salesErrorSignal = signal<string | null>(null);

// Drawers: abiertos cuando no son null
export const ticketSignal = signal<SaleDetail | null>(null);
export const paymentDetailSignal = signal<CustomerPaymentItem | null>(null);
export const daySummarySignal = signal<DaySummaryResult | null>(null);

/** Query string sin los `undefined`; el vacío se conserva (filtra "sin punto de venta"). */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}

export type SalesQueryInput = {
  tab: SalesTab;
  range: DayRange;
  register: RegisterChoice;
  sales: SalesFilters;
  payments: PaymentsFilters;
  movements: MovementsFilters;
  page: number;
};

const statusParam = (status: DocStatus): DocStatus | undefined => (status === 'all' ? undefined : status);

export function endpointFor(input: SalesQueryInput): string {
  const base = { from: input.range.from, to: input.range.to, branch: input.register.branch, pointOfSale: input.register.pointOfSale };
  const paging = { page: input.page, pageSize: PAGE_SIZE };
  switch (input.tab) {
    case 'sales': {
      const { method, customerId, productId, kind, status } = input.sales;
      return `sales?${buildQuery({ ...base, method, customerId, productId, kind, status: statusParam(status), ...paging })}`;
    }
    case 'payments': {
      const { method, customerId, status } = input.payments;
      return `customer-payments?${buildQuery({ ...base, method, customerId, status: statusParam(status), ...paging })}`;
    }
    case 'movements':
      return `cash-movements?${buildQuery({ ...base, ...input.movements, ...paging })}`;
    case 'summary':
      return `cash-summary?${buildQuery(base)}`;
  }
}

function session(): { tenantId: string; token: string } | null {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  return tenantId && token ? { tenantId, token } : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'No se pudieron cargar los datos';
}

export async function loadTab(input: SalesQueryInput): Promise<void> {
  const s = session();
  if (s === null) return;
  const path = `tenants/${s.tenantId}/${endpointFor(input)}`;
  salesLoadingSignal.value = true;
  salesErrorSignal.value = null;
  try {
    switch (input.tab) {
      case 'sales':
        salesListSignal.value = await apiFetch<ListResult<SaleListItem>>(path, { token: s.token });
        break;
      case 'payments':
        paymentsListSignal.value = await apiFetch<ListResult<CustomerPaymentItem>>(path, { token: s.token });
        break;
      case 'movements':
        movementsListSignal.value = await apiFetch<ListResult<CashMovementItem>>(path, { token: s.token });
        break;
      case 'summary':
        cashSummarySignal.value = await apiFetch<CashSummaryResult>(path, { token: s.token });
        break;
    }
  } catch (err: unknown) {
    salesErrorSignal.value = errorMessage(err);
  } finally {
    salesLoadingSignal.value = false;
  }
}

export async function fetchRegisters(): Promise<void> {
  const s = session();
  if (s === null) return;
  try {
    registersSignal.value = await apiFetch<RegisterItem[]>(`tenants/${s.tenantId}/registers`, { token: s.token });
  } catch (err: unknown) {
    salesErrorSignal.value = errorMessage(err);
  }
}

export async function openTicket(saleId: string): Promise<void> {
  const s = session();
  if (s === null) return;
  try {
    ticketSignal.value = await apiFetch<SaleDetail>(`tenants/${s.tenantId}/sales/${encodeURIComponent(saleId)}`, { token: s.token });
  } catch (err: unknown) {
    salesErrorSignal.value = errorMessage(err);
  }
}

export function closeTicket(): void {
  ticketSignal.value = null;
}

// Cambiar un filtro vuelve a la primera página
export function setTab(tab: SalesTab): void {
  salesTabSignal.value = tab;
  pageSignal.value = 1;
}

export function applyPreset(preset: Exclude<RangePreset, 'custom'>): void {
  rangePresetSignal.value = preset;
  rangeSignal.value = presetRange(preset, argentinaToday(new Date()));
  pageSignal.value = 1;
}

export function setCustomRange(range: DayRange): void {
  rangePresetSignal.value = 'custom';
  rangeSignal.value = range;
  pageSignal.value = 1;
}

export function setRegister(choice: RegisterChoice): void {
  registerSignal.value = choice;
  pageSignal.value = 1;
}

export function setSalesFilters(patch: Partial<SalesFilters>): void {
  salesFiltersSignal.value = { ...salesFiltersSignal.value, ...patch };
  pageSignal.value = 1;
}

export function setPaymentsFilters(patch: Partial<PaymentsFilters>): void {
  paymentsFiltersSignal.value = { ...paymentsFiltersSignal.value, ...patch };
  pageSignal.value = 1;
}

export function setMovementsFilters(patch: Partial<MovementsFilters>): void {
  movementsFiltersSignal.value = { ...movementsFiltersSignal.value, ...patch };
  pageSignal.value = 1;
}

export function setPage(page: number): void {
  pageSignal.value = page;
}

/** Drill-down del dashboard (#20): la lista de ventas con esos filtros, y nada más. */
export type SalesDrill = {
  range: DayRange;
  branch?: string | undefined;
  status?: DocStatus | undefined;
  productId?: string | undefined;
};

export function openSalesWith(drill: SalesDrill): void {
  salesTabSignal.value = 'sales';
  rangePresetSignal.value = 'custom';
  rangeSignal.value = drill.range;
  registerSignal.value = drill.branch === undefined ? {} : { branch: drill.branch };
  salesFiltersSignal.value = {
    status: drill.status ?? 'all',
    ...(drill.productId === undefined ? {} : { productId: drill.productId }),
  };
  pageSignal.value = 1;
  navigateTo('sales');
}

/**
 * Reactividad sin hooks, como el dashboard: las cajas y los clientes se piden al entrar a la sección;
 * la solapa activa, cada vez que cambia ella o un filtro.
 */
export function registerSalesEffects(): () => void {
  const disposeRegisters = effect(() => {
    if (activeViewSignal.value === 'sales' && session() !== null) {
      void fetchRegisters();
      if (customersSignal.peek().length === 0) void fetchCustomers();
    }
  });
  const disposeTab = effect(() => {
    const input: SalesQueryInput = {
      tab: salesTabSignal.value,
      range: rangeSignal.value,
      register: registerSignal.value,
      sales: salesFiltersSignal.value,
      payments: paymentsFiltersSignal.value,
      movements: movementsFiltersSignal.value,
      page: pageSignal.value,
    };
    if (activeViewSignal.value === 'sales' && session() !== null) {
      void loadTab(input);
    }
  });
  return () => {
    disposeRegisters();
    disposeTab();
  };
}

if (typeof window !== 'undefined') {
  registerSalesEffects();
}
```

- [ ] **Paso 5: menú, permisos y vista**

- `navigation-state.ts`: `ActiveNavView` suma `'sales'`.
- `permissions-state.ts`: `VIEW_CAPABILITY` suma `sales: 'tenant.use'`.
- `Sidebar.tsx`: un ítem nuevo después de `dashboard`, con el mismo estilo de ícono:

```tsx
  {
    id: 'sales',
    label: 'Ventas & Caja',
    icon: (active) => (
      <svg
        class={`w-5 h-5 ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
```

- `App.tsx`: `{currentView === 'sales' && <SalesView />}`, con su import.

- [ ] **Paso 6: componentes**

`src/client/components/ui/Pagination.tsx`:

```tsx
import { Button } from './Button.tsx';

export type PaginationProps = { page: number; pageSize: number; count: number; onPage: (page: number) => void };

export function Pagination(props: PaginationProps) {
  const first = props.count === 0 ? 0 : (props.page - 1) * props.pageSize + 1;
  const last = Math.min(props.page * props.pageSize, props.count);
  return (
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
      <span>
        {first}–{last} de {props.count}
      </span>
      <div class="flex gap-2">
        <Button size="sm" variant="secondary" disabled={props.page <= 1} onClick={() => { props.onPage(props.page - 1); }}>
          Anterior
        </Button>
        <Button size="sm" variant="secondary" disabled={last >= props.count} onClick={() => { props.onPage(props.page + 1); }}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}
```

`src/client/components/sales/SalesTabs.tsx` (mismo estilo que `SettingsTabs.tsx`; las Tareas 9 y 10
suman las otras solapas a `TABS`):

```tsx
import { salesTabSignal, setTab, type SalesTab } from '../../state/sales-state.ts';

export const TABS: Array<{ id: SalesTab; label: string }> = [{ id: 'sales', label: 'Ventas' }];

export function SalesTabs() {
  const active = salesTabSignal.value;
  return (
    <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => { setTab(t.id); }}
          class={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            active === t.id
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
              : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

`src/client/components/sales/SalesRangeBar.tsx`:

```tsx
import { applyPreset, rangePresetSignal, rangeSignal, registerSignal, registersSignal, setCustomRange, setRegister, type RangePreset } from '../../state/sales-state.ts';
import { parseRegisterKey, registerKey, registerLabel } from '../../state/sales-labels.ts';
import { Button } from '../ui/Button.tsx';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Input } from '../ui/Input.tsx';
import { Select } from '../ui/Select.tsx';

const PRESETS: Array<{ id: Exclude<RangePreset, 'custom'>; label: string }> = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'week', label: '7 días' },
  { id: 'month', label: '30 días' },
];

/** Rango de días y caja: compartidos por las cuatro solapas. */
export function SalesRangeBar() {
  const preset = rangePresetSignal.value;
  const range = rangeSignal.value;
  const current = registerKey(registerSignal.value);
  const options = registersSignal.value.map((r) => ({
    key: registerKey({ branch: r.branch ?? '', pointOfSale: r.pointOfSale ?? '' }),
    label: registerLabel(r.branch, r.pointOfSale),
  }));
  // El drill-down puede filtrar solo por sucursal: se ofrece como opción para que el select lo muestre
  const branchOnly = registerSignal.value.branch;
  if (current !== '' && !options.some((o) => o.key === current) && branchOnly !== undefined) {
    options.unshift({ key: current, label: `${branchOnly} · todas las cajas` });
  }

  return (
    <FilterToolbar>
      <div class="flex flex-col lg:flex-row lg:items-end gap-3">
        <div class="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant={preset === p.id ? 'primary' : 'secondary'} onClick={() => { applyPreset(p.id); }}>
              {p.label}
            </Button>
          ))}
        </div>
        <div class="grid grid-cols-2 gap-3 lg:w-80">
          <Input type="date" label="Desde" value={range.from} onChange={(e) => { setCustomRange({ from: e.currentTarget.value, to: range.to }); }} />
          <Input type="date" label="Hasta" value={range.to} onChange={(e) => { setCustomRange({ from: range.from, to: e.currentTarget.value }); }} />
        </div>
        <div class="lg:w-64">
          <Select label="Caja" value={current} onChange={(e) => { setRegister(parseRegisterKey(e.currentTarget.value)); }}>
            <option value="">Todas las cajas</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </FilterToolbar>
  );
}
```

`src/client/components/sales/CustomerPicker.tsx`:

```tsx
import { customersSignal } from '../../state/customer-state.ts';
import { Input } from '../ui/Input.tsx';

/** Cliente con búsqueda (datalist sobre los clientes que ya carga Clientes); vacío es "todos". */
export function CustomerPicker(props: { id: string; value: string | undefined; onChange: (customerId: string | undefined) => void }) {
  const customers = customersSignal.value;
  const selected = customers.find((c) => c.id === props.value);
  return (
    <div>
      <Input
        label="Cliente"
        list={props.id}
        placeholder="Todos"
        value={selected?.name ?? props.value ?? ''}
        onChange={(e) => {
          const name = e.currentTarget.value.trim();
          props.onChange(name === '' ? undefined : customers.find((c) => c.name === name)?.id);
        }}
      />
      <datalist id={props.id}>
        {customers.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
    </div>
  );
}
```

`src/client/components/sales/SaleBadges.tsx`:

```tsx
import type { SaleKind } from '../../../shared/sales-types.ts';

const tone = {
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  sky: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20',
};

function Badge(props: { tone: keyof typeof tone; label: string }) {
  return <span class={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tone[props.tone]}`}>{props.label}</span>;
}

/** Marcas de un ticket o de una cobranza: anulada, anulación y devolución. */
export function SaleBadges(props: { kind?: SaleKind | undefined; voided: boolean; isVoid?: boolean | undefined }) {
  return (
    <span class="inline-flex flex-wrap gap-1">
      {props.voided && <Badge tone="rose" label="Anulada" />}
      {(props.kind === 'void' || props.isVoid === true) && <Badge tone="amber" label="Anulación" />}
      {props.kind === 'return' && <Badge tone="sky" label="Devolución" />}
    </span>
  );
}

/** Los importes negativos van en rojo. */
export function amountClass(amount: number): string {
  return amount < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white';
}
```

`src/client/components/sales/SalesTable.tsx`:

```tsx
import { PAYMENT_METHODS } from '../../../shared/payment-methods.ts';
import type { DocStatus, SaleKind } from '../../../shared/sales-types.ts';
import { formatDateTime, formatMoney } from '../../format.ts';
import { customerLabel, methodLabel, registerLabel } from '../../state/sales-labels.ts';
import { openTicket, pageSignal, salesFiltersSignal, salesListSignal, salesLoadingSignal, setPage, setSalesFilters } from '../../state/sales-state.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Pagination } from '../ui/Pagination.tsx';
import { Select } from '../ui/Select.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { CustomerPicker } from './CustomerPicker.tsx';
import { SaleBadges, amountClass } from './SaleBadges.tsx';

const METHODS = [...PAYMENT_METHODS, 'other'] as const;
const KINDS: Array<{ id: SaleKind; label: string }> = [
  { id: 'sale', label: 'Ventas' },
  { id: 'return', label: 'Devoluciones' },
  { id: 'void', label: 'Anulaciones' },
];
const STATUSES: Array<{ id: DocStatus; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'valid', label: 'Vigentes' },
  { id: 'voided', label: 'Anuladas' },
];

const orUndefined = (value: string): string | undefined => (value === '' ? undefined : value);

export function SalesTable() {
  const list = salesListSignal.value;
  const filters = salesFiltersSignal.value;
  const items = list?.items ?? [];

  return (
    <div class="space-y-4">
      <FilterToolbar>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Select label="Medio de pago" value={filters.method ?? ''} onChange={(e) => { setSalesFilters({ method: orUndefined(e.currentTarget.value) }); }}>
            <option value="">Todos</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>{methodLabel(m)}</option>
            ))}
          </Select>
          <CustomerPicker id="ventas-clientes" value={filters.customerId} onChange={(customerId) => { setSalesFilters({ customerId }); }} />
          <Select
            label="Tipo"
            value={filters.kind ?? ''}
            onChange={(e) => { setSalesFilters({ kind: KINDS.find((k) => k.id === e.currentTarget.value)?.id }); }}
          >
            <option value="">Todos</option>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </Select>
          <Select
            label="Estado"
            value={filters.status}
            onChange={(e) => { setSalesFilters({ status: STATUSES.find((s) => s.id === e.currentTarget.value)?.id ?? 'all' }); }}
          >
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </div>
        {filters.productId !== undefined && (
          <button type="button" class="text-xs text-indigo-600 dark:text-indigo-400 cursor-pointer" onClick={() => { setSalesFilters({ productId: undefined }); }}>
            Solo tickets con el producto del ranking · quitar ✕
          </button>
        )}
      </FilterToolbar>

      <TableContainer>
        <div class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
          {list === null ? 'Cargando…' : `${String(list.count)} tickets · Total neto ${formatMoney(list.netTotal)}`}
          {salesLoadingSignal.value && list !== null && <span class="ml-2 text-xs text-slate-400">Actualizando…</span>}
        </div>
        <Table>
          <Thead>
            <Tr>
              <Th>Fecha</Th>
              <Th>Ticket</Th>
              <Th>Caja</Th>
              <Th>Cliente</Th>
              <Th>Medios</Th>
              <Th class="text-right">Total</Th>
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => (
              <Tr key={item.id} class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => { void openTicket(item.id); }}>
                <Td>{formatDateTime(item.createdAt)}</Td>
                <Td>
                  <span class="font-semibold">{item.ticket === undefined ? '—' : `#${String(item.ticket.number)}`}</span>{' '}
                  <SaleBadges kind={item.kind} voided={item.voided} />
                </Td>
                <Td>{registerLabel(item.branch, item.pointOfSale)}</Td>
                <Td>{customerLabel(item.customer)}</Td>
                <Td>{item.methods.map(methodLabel).join(', ')}</Td>
                <Td class={`text-right font-semibold ${amountClass(item.total)}`}>{formatMoney(item.total)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        {list !== null && items.length === 0 && <TableEmptyState message="No hay ventas con estos filtros" />}
        {list !== null && list.count > 0 && <Pagination page={pageSignal.value} pageSize={list.pageSize} count={list.count} onPage={setPage} />}
      </TableContainer>
    </div>
  );
}
```

`src/client/components/sales/TicketDrawer.tsx`:

```tsx
import { formatDateTime, formatMoney, formatQty } from '../../format.ts';
import { KIND_LABELS, customerLabel, methodLabel, registerLabel } from '../../state/sales-labels.ts';
import { closeTicket, openTicket, ticketSignal } from '../../state/sales-state.ts';
import { Drawer } from '../ui/Drawer.tsx';
import { SaleBadges, amountClass } from './SaleBadges.tsx';

const link = 'text-indigo-600 dark:text-indigo-400 font-semibold underline cursor-pointer';

/** El ticket completo (#20): líneas, subtotal, ajuste global, pagos y su anulación. */
export function TicketDrawer() {
  const t = ticketSignal.value;
  const title = t === null ? '' : `${KIND_LABELS[t.kind]} ${t.ticket === undefined ? 'sin número' : `#${String(t.ticket.number)}`}`;
  return (
    <Drawer
      isOpen={t !== null}
      onClose={closeTicket}
      title={title}
      subtitle={t === null ? '' : `${formatDateTime(t.createdAt)} · ${registerLabel(t.branch, t.pointOfSale)}`}
    >
      {t !== null && (
        <div class="space-y-5 text-sm text-slate-700 dark:text-slate-300">
          <div class="flex flex-wrap items-center gap-2">
            <span>Cliente: <strong>{customerLabel(t.customer)}</strong></span>
            <SaleBadges kind={t.kind} voided={t.voided} />
          </div>
          {t.voidsSaleId !== undefined && (
            <p>
              Anula el{' '}
              <button type="button" class={link} onClick={() => { void openTicket(t.voidsSaleId ?? ''); }}>ticket original</button>
              . Motivo: {t.voidReason ?? 'sin motivo'}
            </p>
          )}
          {t.voidedBy !== undefined && (
            <p>
              Anulada por{' '}
              <button type="button" class={link} onClick={() => { void openTicket(t.voidedBy ?? ''); }}>su anulación</button>
            </p>
          )}
          <table class="w-full text-left">
            <thead class="text-[11px] uppercase text-slate-500">
              <tr><th>Producto</th><th class="text-right">Cant.</th><th class="text-right">Precio</th><th class="text-right">Desc.</th><th class="text-right">Total</th></tr>
            </thead>
            <tbody>
              {t.lines.map((line, i) => (
                <tr key={i} class="border-t border-slate-100 dark:border-slate-800">
                  <td class="py-1.5">{line.name}</td>
                  <td class="text-right">{formatQty(line.qty)}</td>
                  <td class="text-right">{formatMoney(line.unitPrice)}</td>
                  <td class="text-right">
                    {line.discount === undefined ? '—' : line.discount.type === 'amount' ? formatMoney(line.discount.value) : `${formatQty(line.discount.value)} %`}
                  </td>
                  <td class={`text-right ${amountClass(line.total)}`}>{formatMoney(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl class="grid grid-cols-2 gap-y-1">
            <dt>Subtotal</dt><dd class="text-right">{formatMoney(t.subtotal)}</dd>
            <dt>Ajuste global</dt><dd class="text-right">{formatMoney(t.globalAdjustment)}</dd>
            <dt class="font-bold">Total</dt><dd class={`text-right font-bold ${amountClass(t.total)}`}>{formatMoney(t.total)}</dd>
          </dl>
          <div>
            <h3 class="text-xs font-bold uppercase text-slate-500 mb-1">Pagos</h3>
            <ul class="space-y-1">
              {t.payments.map((p, i) => (
                <li key={i} class="flex justify-between">
                  <span>{methodLabel(p.method)}{p.reference === undefined ? '' : ` · ${p.reference}`}</span>
                  <span class={amountClass(p.amount)}>{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Drawer>
  );
}
```

`src/client/components/sales/SalesView.tsx`:

```tsx
import { salesErrorSignal, salesTabSignal } from '../../state/sales-state.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { SalesRangeBar } from './SalesRangeBar.tsx';
import { SalesTable } from './SalesTable.tsx';
import { SalesTabs } from './SalesTabs.tsx';
import { TicketDrawer } from './TicketDrawer.tsx';

export function SalesView() {
  const tab = salesTabSignal.value;
  const error = salesErrorSignal.value;
  return (
    <div class="space-y-6">
      <PageHeader title="Ventas & Caja" description="Ventas, cobranzas, movimientos y el resumen de cada caja, tal como los manda el POS." />
      <SalesTabs />
      <SalesRangeBar />
      {error !== null && (
        <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}
      {tab === 'sales' && <SalesTable />}
      {/* El ticket va último: se abre también desde el resumen del día (Tarea 10) */}
      <TicketDrawer />
    </div>
  );
}
```

> Si `Drawer` no ocupa todo el ancho en el celular, pasarle `maxWidth="max-w-full sm:max-w-xl"` (o la
> clase que use su prop) para cumplir la spec.

- [ ] **Paso 7: correr los tests y verlos pasar**

Correr `pnpm vitest run test/sales-client.test.ts test/app-shell-and-navigation.test.ts test/permissions-client.test.ts test/brand.test.ts`.
Esperado: PASS. Si `app-shell-and-navigation` enumera los ítems del menú, sumar "Ventas & Caja"
donde corresponda.

- [ ] **Paso 8: suite completa, build y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }
git add src/client/format.ts src/client/state/sales-labels.ts src/client/state/sales-state.ts src/client/state/navigation-state.ts src/client/state/permissions-state.ts src/client/components/ui/Pagination.tsx src/client/components/sales src/client/components/shell/Sidebar.tsx src/client/App.tsx test/sales-client.test.ts
git commit -m "feat: sección Ventas & Caja con la lista de ventas y el ticket (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Antes de frenar, levantar `pnpm dev` y mirar la solapa en el navegador integrado (claro, oscuro y
ancho de celular). Frenar para la revisión.

---

### Tarea 9: cliente, solapas Cobranzas y Movimientos de caja

**Archivos:**
- Crear: `src/client/components/sales/PaymentsTable.tsx`, `src/client/components/sales/PaymentDrawer.tsx`,
  `src/client/components/sales/CashMovementsTable.tsx`.
- Modificar: `src/client/components/sales/SalesTabs.tsx`, `src/client/components/sales/SalesView.tsx`,
  `src/client/state/sales-state.ts`.
- Test: `test/sales-client.test.ts`.

**Interfaces:**
- Consume: lo de la Tarea 8.
- Produce: `openPayment(id: string): void` y `closePayment(): void` en `sales-state.ts`. Buscan la
  cobranza en la página cargada; si no está, no hacen nada.

- [ ] **Paso 1: escribir el test que falla**

En `test/sales-client.test.ts`, sumar `openPayment`, `closePayment`, `paymentsListSignal` y
`paymentDetailSignal` a los imports, y:

```typescript
describe('cobranzas en el cliente (#20)', () => {
  it('abre una cobranza de la página y navega a su anulación', () => {
    const base = { day: '2026-10-01', createdAt: '2026-10-01T15:00:00.000Z', branch: 'CENTRAL', pointOfSale: 'Caja 1', customer: { id: 'c1', name: 'Ana' } };
    paymentsListSignal.value = {
      items: [
        { ...base, id: 'cp2', payments: [{ method: 'cash', amount: -700 }], total: -700, voided: false, voidsPaymentId: 'cp1' },
        { ...base, id: 'cp1', payments: [{ method: 'cash', amount: 700 }], total: 700, voided: true, voidedBy: 'cp2' },
      ],
      count: 2, page: 1, pageSize: 50, netTotal: 0,
    };
    openPayment('cp1');
    expect(paymentDetailSignal.value?.id).toBe('cp1');
    openPayment(paymentDetailSignal.value?.voidedBy ?? '');
    expect(paymentDetailSignal.value?.id).toBe('cp2');
    openPayment('no-está');
    expect(paymentDetailSignal.value?.id).toBe('cp2');
    closePayment();
    expect(paymentDetailSignal.value).toBeNull();
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/sales-client.test.ts`. Esperado: FAIL, porque `openPayment` no existe.

- [ ] **Paso 3: estado**

En `src/client/state/sales-state.ts`:

```typescript
/** El recibo se abre con los datos de la lista; una cobranza fuera de la página no se abre. */
export function openPayment(id: string): void {
  const found = paymentsListSignal.value?.items.find((p) => p.id === id);
  if (found !== undefined) paymentDetailSignal.value = found;
}

export function closePayment(): void {
  paymentDetailSignal.value = null;
}
```

- [ ] **Paso 4: componentes**

En `SalesTabs.tsx`, `TABS` pasa a:

```tsx
export const TABS: Array<{ id: SalesTab; label: string }> = [
  { id: 'sales', label: 'Ventas' },
  { id: 'payments', label: 'Cobranzas' },
  { id: 'movements', label: 'Movimientos de caja' },
];
```

`src/client/components/sales/PaymentsTable.tsx`:

```tsx
import { PAYMENT_METHODS } from '../../../shared/payment-methods.ts';
import type { DocStatus } from '../../../shared/sales-types.ts';
import { formatDateTime, formatMoney } from '../../format.ts';
import { customerLabel, methodLabel, registerLabel } from '../../state/sales-labels.ts';
import { openPayment, pageSignal, paymentsFiltersSignal, paymentsListSignal, setPage, setPaymentsFilters } from '../../state/sales-state.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Pagination } from '../ui/Pagination.tsx';
import { Select } from '../ui/Select.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { CustomerPicker } from './CustomerPicker.tsx';
import { SaleBadges, amountClass } from './SaleBadges.tsx';

// La cobranza nunca es a cuenta corriente (contrato): sin `account`
const METHODS = [...PAYMENT_METHODS.filter((m) => m !== 'account'), 'other'];
const STATUSES: Array<{ id: DocStatus; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'valid', label: 'Vigentes' },
  { id: 'voided', label: 'Anuladas' },
];

export function PaymentsTable() {
  const list = paymentsListSignal.value;
  const filters = paymentsFiltersSignal.value;
  const items = list?.items ?? [];
  return (
    <div class="space-y-4">
      <FilterToolbar>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select label="Medio de pago" value={filters.method ?? ''} onChange={(e) => { const v = e.currentTarget.value; setPaymentsFilters({ method: v === '' ? undefined : v }); }}>
            <option value="">Todos</option>
            {METHODS.map((m) => (<option key={m} value={m}>{methodLabel(m)}</option>))}
          </Select>
          <CustomerPicker id="cobranzas-clientes" value={filters.customerId} onChange={(customerId) => { setPaymentsFilters({ customerId }); }} />
          <Select label="Estado" value={filters.status} onChange={(e) => { setPaymentsFilters({ status: STATUSES.find((s) => s.id === e.currentTarget.value)?.id ?? 'all' }); }}>
            {STATUSES.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
          </Select>
        </div>
      </FilterToolbar>
      <TableContainer>
        <div class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
          {list === null ? 'Cargando…' : `${String(list.count)} cobranzas · Total neto ${formatMoney(list.netTotal)}`}
        </div>
        <Table>
          <Thead>
            <Tr><Th>Fecha</Th><Th>Recibo</Th><Th>Caja</Th><Th>Cliente</Th><Th>Medios</Th><Th class="text-right">Total</Th></Tr>
          </Thead>
          <Tbody>
            {items.map((p) => (
              <Tr key={p.id} class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => { openPayment(p.id); }}>
                <Td>{formatDateTime(p.createdAt)}</Td>
                <Td>
                  <span class="font-semibold">{p.receipt === undefined ? '—' : `#${String(p.receipt.number)}`}</span>{' '}
                  <SaleBadges voided={p.voided} isVoid={p.voidsPaymentId !== undefined} />
                </Td>
                <Td>{registerLabel(p.branch, p.pointOfSale)}</Td>
                <Td>{customerLabel(p.customer)}</Td>
                <Td>{[...new Set(p.payments.map((x) => methodLabel(x.method)))].join(', ')}</Td>
                <Td class={`text-right font-semibold ${amountClass(p.total)}`}>{formatMoney(p.total)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        {list !== null && items.length === 0 && <TableEmptyState message="No hay cobranzas con estos filtros" />}
        {list !== null && list.count > 0 && <Pagination page={pageSignal.value} pageSize={list.pageSize} count={list.count} onPage={setPage} />}
      </TableContainer>
    </div>
  );
}
```

`src/client/components/sales/PaymentDrawer.tsx`:

```tsx
import { formatDateTime, formatMoney } from '../../format.ts';
import { customerLabel, methodLabel, registerLabel } from '../../state/sales-labels.ts';
import { closePayment, openPayment, paymentDetailSignal, paymentsListSignal } from '../../state/sales-state.ts';
import { Drawer } from '../ui/Drawer.tsx';
import { SaleBadges, amountClass } from './SaleBadges.tsx';

const link = 'text-indigo-600 dark:text-indigo-400 font-semibold underline cursor-pointer';

export function PaymentDrawer() {
  const p = paymentDetailSignal.value;
  const inPage = (id: string | undefined): boolean => id !== undefined && (paymentsListSignal.value?.items.some((x) => x.id === id) ?? false);
  return (
    <Drawer
      isOpen={p !== null}
      onClose={closePayment}
      title={p === null ? '' : `${p.voidsPaymentId === undefined ? 'Cobranza' : 'Anulación de cobranza'} ${p.receipt === undefined ? 'sin número' : `#${String(p.receipt.number)}`}`}
      subtitle={p === null ? '' : `${formatDateTime(p.createdAt)} · ${registerLabel(p.branch, p.pointOfSale)}`}
    >
      {p !== null && (
        <div class="space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <div class="flex flex-wrap items-center gap-2">
            <span>Cliente: <strong>{customerLabel(p.customer)}</strong></span>
            <SaleBadges voided={p.voided} isVoid={p.voidsPaymentId !== undefined} />
          </div>
          {p.voidsPaymentId !== undefined && (
            <p>Anula {inPage(p.voidsPaymentId) ? <button type="button" class={link} onClick={() => { openPayment(p.voidsPaymentId ?? ''); }}>la cobranza original</button> : 'una cobranza de otra página o de otro rango'}.</p>
          )}
          {p.voidedBy !== undefined && (
            <p>Anulada por {inPage(p.voidedBy) ? <button type="button" class={link} onClick={() => { openPayment(p.voidedBy ?? ''); }}>su anulación</button> : 'una cobranza de otra página o de otro rango'}.</p>
          )}
          <ul class="space-y-1">
            {p.payments.map((x, i) => (
              <li key={i} class="flex justify-between">
                <span>{methodLabel(x.method)}{x.reference === undefined ? '' : ` · ${x.reference}`}</span>
                <span class={amountClass(x.amount)}>{formatMoney(x.amount)}</span>
              </li>
            ))}
          </ul>
          <div class="flex justify-between font-bold"><span>Total</span><span class={amountClass(p.total)}>{formatMoney(p.total)}</span></div>
        </div>
      )}
    </Drawer>
  );
}
```

`src/client/components/sales/CashMovementsTable.tsx`:

```tsx
import type { CashMovementItem } from '../../../shared/sales-types.ts';
import { formatDateTime, formatMoney } from '../../format.ts';
import { registerLabel } from '../../state/sales-labels.ts';
import { movementsFiltersSignal, movementsListSignal, pageSignal, setMovementsFilters, setPage } from '../../state/sales-state.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Pagination } from '../ui/Pagination.tsx';
import { Select } from '../ui/Select.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { amountClass } from './SaleBadges.tsx';

function signed(m: CashMovementItem): number {
  return m.direction === 'out' ? -m.amount : m.amount;
}

function concept(m: CashMovementItem): string {
  return m.count === undefined
    ? m.concept
    : `${m.concept} (esperado ${formatMoney(m.count.expected)}, contado ${formatMoney(m.count.counted)})`;
}

export function CashMovementsTable() {
  const list = movementsListSignal.value;
  const filters = movementsFiltersSignal.value;
  const items = list?.items ?? [];
  return (
    <div class="space-y-4">
      <FilterToolbar>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Tipo" value={filters.direction ?? ''} onChange={(e) => { const v = e.currentTarget.value; setMovementsFilters({ direction: v === 'in' || v === 'out' ? v : undefined }); }}>
            <option value="">Ingresos y egresos</option>
            <option value="in">Ingresos</option>
            <option value="out">Egresos</option>
          </Select>
          <Select label="Origen" value={filters.source ?? ''} onChange={(e) => { const v = e.currentTarget.value; setMovementsFilters({ source: v === 'manual' || v === 'count-adjustment' ? v : undefined }); }}>
            <option value="">Todos</option>
            <option value="manual">Manuales</option>
            <option value="count-adjustment">Ajustes por arqueo</option>
          </Select>
        </div>
      </FilterToolbar>
      <TableContainer>
        <div class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
          {list === null ? 'Cargando…' : `${String(list.count)} movimientos · Neto ${formatMoney(list.netTotal)}`}
        </div>
        <Table>
          <Thead>
            <Tr><Th>Fecha</Th><Th>Caja</Th><Th>Tipo</Th><Th>Concepto</Th><Th>Descripción</Th><Th class="text-right">Importe</Th></Tr>
          </Thead>
          <Tbody>
            {items.map((m) => (
              <Tr key={m.id}>
                <Td>{formatDateTime(m.createdAt)}</Td>
                <Td>{registerLabel(m.branch, m.pointOfSale)}</Td>
                <Td>{m.direction === 'in' ? 'Ingreso' : m.direction === 'out' ? 'Egreso' : '—'}</Td>
                <Td>{concept(m)}</Td>
                <Td>{m.description ?? '—'}</Td>
                <Td class={`text-right font-semibold ${amountClass(signed(m))}`}>{formatMoney(signed(m))}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        {list !== null && items.length === 0 && <TableEmptyState message="No hay movimientos de caja con estos filtros" />}
        {list !== null && list.count > 0 && <Pagination page={pageSignal.value} pageSize={list.pageSize} count={list.count} onPage={setPage} />}
      </TableContainer>
    </div>
  );
}
```

En `SalesView.tsx`, sumar `{tab === 'payments' && <PaymentsTable />}`,
`{tab === 'movements' && <CashMovementsTable />}` y `<PaymentDrawer />` antes de `<TicketDrawer />`.

- [ ] **Paso 5: correr los tests y verlos pasar**

Correr `pnpm vitest run test/sales-client.test.ts`. Esperado: PASS.

- [ ] **Paso 6: suite completa, build y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }
git add src/client/components/sales src/client/state/sales-state.ts test/sales-client.test.ts
git commit -m "feat: solapas Cobranzas y Movimientos de caja (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Mirarlo en el navegador integrado y frenar para la revisión.

---

### Tarea 10: cliente, solapa Resumen y resumen del día

**Archivos:**
- Crear: `src/client/components/sales/CashSummaryTable.tsx`, `src/client/components/sales/DaySummaryDrawer.tsx`.
- Modificar: `SalesTabs.tsx`, `SalesView.tsx`, `src/client/state/sales-state.ts`.
- Test: `test/sales-client.test.ts`.

**Interfaces:**
- Produce: `openDaySummary(row: { day: string; branch: string | null; pointOfSale: string | null }): Promise<void>`
  y `closeDaySummary(): void`.

- [ ] **Paso 1: escribir el test que falla**

En `test/sales-client.test.ts`, sumar `openDaySummary` y `daySummarySignal` a los imports, y:

```typescript
describe('resumen del día en el cliente (#20)', () => {
  it('pide el día de esa caja; sin punto de venta va vacío', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { day: '2026-10-01', summary: {}, entries: [] }));
    globalThis.fetch = fetchMock;
    await openDaySummary({ day: '2026-10-01', branch: 'CENTRAL', pointOfSale: null });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/tenants/t1/cash-summary/day?day=2026-10-01&branch=CENTRAL&pointOfSale=');
    expect(daySummarySignal.value?.day).toBe('2026-10-01');
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/sales-client.test.ts`. Esperado: FAIL, porque `openDaySummary` no
existe.

- [ ] **Paso 3: estado**

```typescript
export async function openDaySummary(row: { day: string; branch: string | null; pointOfSale: string | null }): Promise<void> {
  const s = session();
  if (s === null) return;
  const query = buildQuery({ day: row.day, branch: row.branch ?? '', pointOfSale: row.pointOfSale ?? '' });
  try {
    daySummarySignal.value = await apiFetch<DaySummaryResult>(`tenants/${s.tenantId}/cash-summary/day?${query}`, { token: s.token });
  } catch (err: unknown) {
    salesErrorSignal.value = errorMessage(err);
  }
}

export function closeDaySummary(): void {
  daySummarySignal.value = null;
}
```

- [ ] **Paso 4: componentes**

`TABS` suma `{ id: 'summary', label: 'Resumen' }`.

`src/client/components/sales/CashSummaryTable.tsx`:

```tsx
import { formatDay, formatMoney } from '../../format.ts';
import { registerLabel } from '../../state/sales-labels.ts';
import { cashSummarySignal, openDaySummary } from '../../state/sales-state.ts';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { amountClass } from './SaleBadges.tsx';

/** Una fila por día y caja; el click abre el resumen del día, para comparar con el /RESUMEN del POS. */
export function CashSummaryTable() {
  const data = cashSummarySignal.value;
  const rows = data?.rows ?? [];
  return (
    <TableContainer>
      <Table>
        <Thead>
          <Tr>
            <Th>Día</Th><Th>Caja</Th><Th class="text-right">Vendido</Th><Th class="text-right">Tickets</Th>
            <Th class="text-right">Anuladas</Th><Th class="text-right">Cobranzas</Th><Th class="text-right">Efectivo neto</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={`${r.day}|${r.branch ?? ''}|${r.pointOfSale ?? ''}`} class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => { void openDaySummary(r); }}>
              <Td>{formatDay(r.day)}</Td>
              <Td>{registerLabel(r.branch, r.pointOfSale)}</Td>
              <Td class={`text-right font-semibold ${amountClass(r.totalSold)}`}>{formatMoney(r.totalSold)}</Td>
              <Td class="text-right">{r.ticketCount}</Td>
              <Td class="text-right">{r.voidedCount}</Td>
              <Td class={`text-right ${amountClass(r.collectionsTotal)}`}>{formatMoney(r.collectionsTotal)}</Td>
              <Td class={`text-right ${amountClass(r.cashNet)}`}>{formatMoney(r.cashNet)}</Td>
            </Tr>
          ))}
        </Tbody>
        {data !== null && rows.length > 0 && (
          <tfoot class="font-bold border-t-2 border-slate-200 dark:border-slate-700">
            <tr>
              <td class="px-4 py-3" colSpan={2}>Total</td>
              <td class="px-4 py-3 text-right">{formatMoney(data.totals.totalSold)}</td>
              <td class="px-4 py-3 text-right">{data.totals.ticketCount}</td>
              <td class="px-4 py-3 text-right">{data.totals.voidedCount}</td>
              <td class="px-4 py-3 text-right">{formatMoney(data.totals.collectionsTotal)}</td>
              <td class="px-4 py-3 text-right">{formatMoney(data.totals.cashNet)}</td>
            </tr>
          </tfoot>
        )}
      </Table>
      {data !== null && rows.length === 0 && <TableEmptyState message="No hay movimientos en este rango" />}
    </TableContainer>
  );
}
```

`src/client/components/sales/DaySummaryDrawer.tsx`:

```tsx
import type { ComponentChildren } from 'preact';
import { PAYMENT_METHODS } from '../../../shared/payment-methods.ts';
import type { DayEntry } from '../../../shared/sales-types.ts';
import { formatDay, formatMoney, formatTime } from '../../format.ts';
import { customerLabel, methodLabel } from '../../state/sales-labels.ts';
import { closeDaySummary, daySummarySignal, openTicket } from '../../state/sales-state.ts';
import { Drawer } from '../ui/Drawer.tsx';
import { amountClass } from './SaleBadges.tsx';

const METHODS = [...PAYMENT_METHODS, 'other'] as const;

function Row(props: { label: string; amount: number; strong?: boolean }) {
  return (
    <div class={`flex justify-between ${props.strong === true ? 'font-bold' : ''}`}>
      <span>{props.label}</span>
      <span class={amountClass(props.amount)}>{formatMoney(props.amount)}</span>
    </div>
  );
}

function Block(props: { title: string; children: ComponentChildren }) {
  return (
    <section class="space-y-1 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
      <h3 class="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{props.title}</h3>
      {props.children}
    </section>
  );
}

function entryText(e: DayEntry): { label: string; amount: number } {
  switch (e.kind) {
    case 'sale':
      return { label: `Ticket ${e.sale.ticket === undefined ? '' : `#${String(e.sale.ticket.number)}`} · ${customerLabel(e.sale.customer)}`, amount: e.sale.total };
    case 'movement':
      return { label: e.movement.concept, amount: e.movement.direction === 'out' ? -e.movement.amount : e.movement.amount };
    case 'collection':
      return { label: `Cobranza · ${customerLabel(e.payment.customer)}`, amount: e.payment.total };
  }
}

/** Los bloques del /RESUMEN del POS para una caja y un día, con sus movimientos. */
export function DaySummaryDrawer() {
  const data = daySummarySignal.value;
  const s = data?.summary;
  const cashNet = s === undefined ? 0 : s.cash.sales + s.cash.income - s.cash.expense + s.cash.countAdjustments + s.cash.collections;
  return (
    <Drawer isOpen={data !== null} onClose={closeDaySummary} title="Resumen del día" subtitle={data === null ? '' : formatDay(data.day)}>
      {data !== null && s !== undefined && (
        <div class="space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <Block title="Ventas">
            <Row label="Vendido" amount={s.totalSold} strong />
            <div class="flex justify-between"><span>Tickets</span><span>{s.ticketCount} ({s.voidedCount} anuladas)</span></div>
            <Row label="Ajustes" amount={s.adjustmentTotal} />
          </Block>
          <Block title="Por medio de pago">
            {METHODS.filter((m) => s.totalsByMethod[m] !== 0).map((m) => <Row key={m} label={methodLabel(m)} amount={s.totalsByMethod[m]} />)}
          </Block>
          <Block title="Efectivo">
            <Row label="Ventas" amount={s.cash.sales} />
            <Row label="Ingresos" amount={s.cash.income} />
            <Row label="Egresos" amount={-s.cash.expense} />
            <Row label="Ajustes por arqueo" amount={s.cash.countAdjustments} />
            <Row label="Cobranzas" amount={s.cash.collections} />
            <Row label="Neto del día" amount={cashNet} strong />
          </Block>
          <Block title="Cobranzas">
            <div class="flex justify-between"><span>Cobranzas</span><span>{s.collections.count} ({s.collections.voidedCount} anuladas)</span></div>
            {METHODS.filter((m) => s.collectionsByMethod[m] !== 0).map((m) => <Row key={m} label={methodLabel(m)} amount={s.collectionsByMethod[m]} />)}
            <Row label="Total" amount={s.collections.total} strong />
          </Block>
          <Block title="Movimientos">
            <ul class="divide-y divide-slate-100 dark:divide-slate-800">
              {data.entries.map((e) => {
                const { label, amount } = entryText(e);
                const id = e.kind === 'sale' ? e.sale.id : e.kind === 'movement' ? e.movement.id : e.payment.id;
                return (
                  <li key={id} class="py-1.5 flex justify-between gap-3">
                    <span>
                      <span class="text-slate-400 mr-2">{formatTime(e.at)}</span>
                      {e.kind === 'sale' ? (
                        <button type="button" class="underline cursor-pointer" onClick={() => { void openTicket(e.sale.id); }}>{label}</button>
                      ) : label}
                    </span>
                    <span class={amountClass(amount)}>{formatMoney(amount)}</span>
                  </li>
                );
              })}
            </ul>
          </Block>
        </div>
      )}
    </Drawer>
  );
}
```

> Las etiquetas de los bloques salen de `CashSummaryPanel` del POS. Antes de escribirlas, abrir
> offline-pos `src/ui/components/` (lo que renderiza `DaySummary`) y copiar sus textos: así el
> comerciante ve los mismos nombres en los dos lados. Solo se lee, no se toca código del POS.

En `SalesView.tsx`, sumar `{tab === 'summary' && <CashSummaryTable />}` y `<DaySummaryDrawer />`
antes de `<TicketDrawer />` (el ticket se abre encima del resumen).

- [ ] **Paso 5: correr los tests y verlos pasar**

Correr `pnpm vitest run test/sales-client.test.ts`. Esperado: PASS.

- [ ] **Paso 6: suite completa, build y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }
git add src/client/components/sales src/client/state/sales-state.ts test/sales-client.test.ts
git commit -m "feat: resumen por caja y día con el detalle del /RESUMEN (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Mirarlo en el navegador integrado y frenar para la revisión.

---

### Tarea 11: drill-down del dashboard

**Archivos:**
- Crear: `src/client/state/dashboard-drill.ts`.
- Modificar:
  - `src/client/components/ui/StatCard.tsx` (prop `onClick` opcional);
  - en `src/client/components/dashboard/`: `KpiCards.tsx`, `SalesChart.tsx`, `TopProductsTable.tsx`
    y `StockAlertsCard.tsx`.
- Test: `test/sales-client.test.ts`.

**Interfaces:**
- Consume: `openSalesWith` y `presetRange` (Tarea 8), `selectedPeriodSignal` y
  `selectedBranchSignal` (dashboard), `customerDebtorsOnlySignal` y `customerSearchSignal`
  (clientes), `stockSearchSignal` y `stockStatusFilterSignal` (stock).
- Produce:
  - `periodRange(period: DashboardPeriod, today: string): DayRange`;
  - `drillToSales(options: { status?: DocStatus | undefined; productId?: string | undefined; day?: string | undefined }, today?: string): void`;
  - `drillToDebtors(): void`;
  - `drillToStockProduct(name: string): void`.

- [ ] **Paso 1: escribir el test que falla**

En `test/sales-client.test.ts`:

```typescript
import { drillToDebtors, drillToSales, drillToStockProduct, periodRange } from '../src/client/state/dashboard-drill.ts';
import { selectedBranchSignal, selectedPeriodSignal } from '../src/client/state/dashboard-state.ts';
import { customerDebtorsOnlySignal } from '../src/client/state/customer-state.ts';
import { stockSearchSignal } from '../src/client/state/stock-state.ts';

describe('drill-down del dashboard (#20)', () => {
  it('el período del dashboard es un rango de días argentinos', () => {
    expect(periodRange('today', '2026-10-02')).toEqual({ from: '2026-10-02', to: '2026-10-02' });
    expect(periodRange('week', '2026-10-02')).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(periodRange('month', '2026-10-02')).toEqual({ from: '2026-09-03', to: '2026-10-02' });
  });

  it('un KPI lleva a Ventas con el período, la sucursal y el estado', () => {
    selectedPeriodSignal.value = 'week';
    selectedBranchSignal.value = 'CENTRAL';
    drillToSales({ status: 'valid' }, '2026-10-02');
    expect(activeViewSignal.value).toBe('sales');
    expect(rangeSignal.value).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(registerSignal.value).toEqual({ branch: 'CENTRAL' });
    expect(salesFiltersSignal.value).toEqual({ status: 'valid' });
  });

  it('un punto del gráfico lleva a su día; un producto del ranking, a sus tickets', () => {
    selectedBranchSignal.value = '';
    drillToSales({ day: '2026-09-28' }, '2026-10-02');
    expect(rangeSignal.value).toEqual({ from: '2026-09-28', to: '2026-09-28' });
    expect(registerSignal.value).toEqual({});
    drillToSales({ productId: 'p1' }, '2026-10-02');
    expect(salesFiltersSignal.value).toEqual({ status: 'all', productId: 'p1' });
  });

  it('deuda lleva a Clientes deudores; una alerta, a Stock con el producto', () => {
    drillToDebtors();
    expect(activeViewSignal.value).toBe('customers');
    expect(customerDebtorsOnlySignal.value).toBe(true);
    drillToStockProduct('Alfajor');
    expect(activeViewSignal.value).toBe('stock');
    expect(stockSearchSignal.value).toBe('Alfajor');
  });
});
```

- [ ] **Paso 2: correrlo y verlo fallar**

Correr `pnpm vitest run test/sales-client.test.ts`. Esperado: FAIL, porque el módulo no existe.

- [ ] **Paso 3: implementar**

`src/client/state/dashboard-drill.ts`:

```typescript
import { argentinaToday } from '../../shared/argentina-day.ts';
import type { DocStatus } from '../../shared/sales-types.ts';
import { customerDebtorsOnlySignal, customerSearchSignal } from './customer-state.ts';
import { selectedBranchSignal, selectedPeriodSignal, type DashboardPeriod } from './dashboard-state.ts';
import { navigateTo } from './navigation-state.ts';
import { openSalesWith, presetRange, type DayRange } from './sales-state.ts';
import { stockSearchSignal, stockStatusFilterSignal } from './stock-state.ts';

/** Drill-down del dashboard (#20): cada KPI, gráfico y ranking lleva a la consulta que lo explica. */
export function periodRange(period: DashboardPeriod, today: string): DayRange {
  return presetRange(period, today);
}

export function drillToSales(
  options: { status?: DocStatus | undefined; productId?: string | undefined; day?: string | undefined },
  today: string = argentinaToday(new Date()),
): void {
  const branch = selectedBranchSignal.value;
  openSalesWith({
    range: options.day === undefined ? periodRange(selectedPeriodSignal.value, today) : { from: options.day, to: options.day },
    ...(branch === '' ? {} : { branch }),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.productId === undefined ? {} : { productId: options.productId }),
  });
}

export function drillToDebtors(): void {
  customerSearchSignal.value = '';
  customerDebtorsOnlySignal.value = true;
  navigateTo('customers');
}

export function drillToStockProduct(name: string): void {
  stockStatusFilterSignal.value = 'all';
  stockSearchSignal.value = name;
  navigateTo('stock');
}
```

> `presetRange` acepta `'today' | 'yesterday' | 'week' | 'month'`, y `DashboardPeriod` es
> `'today' | 'week' | 'month'`, así que entra sin conversión.

`StatCard.tsx`: sumar `onClick?: (() => void) | undefined` a las props. Si viene:
- el contenedor lleva `role="button"`, `tabIndex={0}`, `title="Ver el detalle"`,
  `cursor-pointer hover:ring-2 hover:ring-indigo-500/40`, el `onClick` y un `onKeyDown` que lo llama
  con Enter o Espacio;
- si no viene, queda como hoy.

`KpiCards.tsx`, importando `drillToSales` y `drillToDebtors`:
- Facturación Total: `onClick={() => { drillToSales({}); }}`;
- Tickets Emitidos y Ticket Promedio: `onClick={() => { drillToSales({ status: 'valid' }); }}`;
- Deuda en Cuenta Cte: `onClick={drillToDebtors}`.

`SalesChart.tsx`: en el `<rect>` de cada punto (la zona de hover, cerca de la línea 138), sumar
`onClick={() => { drillToSales({ day: p.item.date }); }}` y la clase `cursor-pointer`.

`TopProductsTable.tsx`: en la fila de cada ítem, si `item.kind === 'product' && item.productId !== undefined`,
hacerla clickeable con `onClick={() => { drillToSales({ productId: item.productId }); }}` y
`cursor-pointer`. Las líneas libres quedan sin link.

`StockAlertsCard.tsx`: cada producto de `lowProducts` pasa a ser un `<button type="button">` (o una
fila con `onClick`) que llama a `drillToStockProduct(p.name)`. "Ver todo" queda como está.

- [ ] **Paso 4: correr los tests y verlos pasar**

Correr `pnpm vitest run test/sales-client.test.ts test/dashboard-client.test.ts test/customer-client.test.ts test/stock-client.test.ts`.
Esperado: PASS.

- [ ] **Paso 5: suite completa, build y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }
git add src/client/state/dashboard-drill.ts src/client/components/ui/StatCard.tsx src/client/components/dashboard test/sales-client.test.ts
git commit -m "feat: drill-down del dashboard a Ventas & Caja, Clientes y Stock (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Probar cada click en el navegador integrado y frenar para la revisión.

---

### Tarea 12: e2e, documentación, versión 0.6.0 e informe

**Archivos:**
- Crear: `e2e/sales-cash.spec.ts`.
- Modificar: `AGENTS.md`, `docs/superpowers/specs/2026-10-02-m4-ventas-caja-design.md` (el detalle
  del ranking), `package.json` (versión).

- [ ] **Paso 1: el e2e del criterio de aceptación**

`e2e/sales-cash.spec.ts`:

```typescript
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { argentinaToday } from '../src/shared/argentina-day.ts';

/**
 * Criterio de aceptación de #20: con ventas, una anulación y una cobranza hechas desde el POS, el owner
 * encuentra cada una con los filtros, ve el ticket completo y el resumen del día; un click en el
 * dashboard lleva a la lista.
 */
test('ventas, anulación y cobranza del POS en Ventas & Caja, con su resumen y el drill-down', async ({ page, request }) => {
  const id = randomUUID().slice(0, 8);
  const alta = await request.post('/api/alta', {
    data: { name: 'Owner E2E', email: `ventas-${id}@local.test`, password: 'clave-owner-1', businessName: `Kiosco Ventas ${id}`, template: 'kiosco' },
  });
  expect(alta.status()).toBe(201);
  const { token, tenant, posKey } = (await alta.json()) as {
    token: string; tenant: { id: string }; posKey: { key: string; branch: string; pointOfSale: string };
  };
  const products = await request.get(`/api/tenants/${tenant.id}/products`, { headers: { Authorization: `Bearer ${token}` } });
  const [product] = (await products.json()) as { id: string; name: string; price: number }[];
  if (product === undefined) throw new Error('El alta no sembró productos');

  const today = argentinaToday(new Date());
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const origin = { branch: posKey.branch, pointOfSale: posKey.pointOfSale };
  const line = (qty: number) => ({ kind: 'product', productId: product.id, qty, unitPrice: 1000 });
  const events = [
    { id: 'e0', type: 'customer', createdAt: at(30), origin, customer: { id: `c-${id}`, name: 'Ana E2E' } },
    { id: 'e1', type: 'sale', createdAt: at(20), origin, sale: { id: `s1-${id}`, status: 'closed', createdAt: at(20), ticket: { date: today, number: 1 }, total: 1000, lines: [line(1)], payments: [{ method: 'cash', amount: 1000 }] } },
    { id: 'e2', type: 'sale', createdAt: at(15), origin, sale: { id: `s2-${id}`, status: 'closed', createdAt: at(15), ticket: { date: today, number: 2 }, total: -1000, voidsSaleId: `s1-${id}`, voidReason: 'Prueba', lines: [line(-1)], payments: [{ method: 'cash', amount: -1000 }] } },
    { id: 'e3', type: 'sale', createdAt: at(10), origin, sale: { id: `s3-${id}`, status: 'closed', createdAt: at(10), ticket: { date: today, number: 3 }, total: 2000, customerId: `c-${id}`, lines: [line(2)], payments: [{ method: 'debit', amount: 2000 }] } },
    { id: 'e4', type: 'customer-payment', createdAt: at(5), origin, payment: { id: `p1-${id}`, customerId: `c-${id}`, createdAt: at(5), receipt: { date: today, number: 1 }, total: 700, payments: [{ method: 'cash', amount: 700 }] } },
  ];
  const push = await request.post('/connector/sync/push', {
    headers: { Authorization: `Bearer ${posKey.key}`, 'X-POS-Contract-Version': '4.4.0', 'Idempotency-Key': `e2e-ventas-${id}` },
    data: { deviceId: `dev-${id}`, events },
  });
  expect(push.status()).toBe(200);

  await page.addInitScript(
    ([t, tenantId]) => {
      window.localStorage.setItem('mini_erp_token', t);
      window.localStorage.setItem('mini_erp_tenant_id', tenantId);
    },
    [token, tenant.id] as const,
  );
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Ventas & Caja' }).click();

  // Ventas de hoy: los tres tickets
  await expect(page.getByText(/^3 tickets/)).toBeVisible();
  // El ticket a Ana, completo
  await page.getByRole('row', { name: /Ana E2E/ }).click();
  await expect(page.getByText('Venta #3')).toBeVisible();
  await expect(page.getByText(product.name)).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar panel' }).click();

  // Filtro de anuladas: solo el ticket 1
  await page.getByLabel('Estado').selectOption('voided');
  await expect(page.getByText(/^1 ticket ·/)).toBeVisible();

  // Cobranzas: la de Ana
  await page.getByRole('tab', { name: 'Cobranzas' }).click();
  await expect(page.getByRole('row', { name: /Ana E2E/ })).toBeVisible();

  // Resumen del día de la caja: vendido neto 2000 (1000 − 1000 + 2000)
  await page.getByRole('tab', { name: 'Resumen' }).click();
  await page.getByRole('row', { name: new RegExp(posKey.pointOfSale) }).click();
  await expect(page.getByText('Resumen del día')).toBeVisible();
  await expect(page.getByText(/2[.,]000[.,]00/).first()).toBeVisible();

  // Drill-down: Facturación del dashboard lleva a la lista
  await page.getByRole('button', { name: 'Cerrar panel' }).click();
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: /Facturación Total/ }).click();
  await expect(page.getByText(/^3 tickets/)).toBeVisible();
});
```

> Antes de correrlo, revisar en `Drawer.tsx` cómo se llama el botón de cierre (ajustar
> `/cerrar/i`; si no tiene nombre accesible, darle `aria-label="Cerrar"`, que además mejora la
> accesibilidad). Revisar también la forma de la respuesta de `GET /products` (lista o `{ items }`).

- [ ] **Paso 2: correr el e2e**

Correr `pnpm test:e2e`. Esperado: PASS los tres specs.

- [ ] **Paso 3: documentación**

`AGENTS.md`:

- En "Arquitectura", un ítem nuevo después de "Demos aisladas":

```markdown
- **Ventas & Caja** (#20, spec `docs/superpowers/specs/2026-10-02-m4-ventas-caja-design.md`):
  - **El día de un comercio es el día argentino** (UTC−3 fijo): `src/shared/argentina-day.ts` en TS
    y `date(x, '-3 hours')` en SQL. Ventas y cobranzas van por `ticket.date` y `receipt.date` si
    vienen, como el `/RESUMEN` del POS. Nunca la hora del servidor.
  - **Escritura**: ventas, cobranzas y movimientos de caja se escriben solo con
    `src/server/sales/records.ts`, que completa las columnas derivadas (`day`, `customer_id`,
    números). Lo usan el push, la cobranza del admin y la semilla.
  - **Caja** = sucursal + punto de venta del `origin`. La cobranza del admin es `ADMIN · Oficina`
    ("Admin").
  - **Consultas**: `SalesQueryService` (de comercio). El resumen es una copia fiel de
    `calculateDaySummary` del POS (`sales/day-summary.ts`): si el POS lo cambia, se copia el cambio.
  - **Anulaciones como en el POS**, también en el dashboard: el total es el neto de todos los tickets
    y la cantidad cuenta los vigentes.
```

- En "Cliente", donde dice "Hoy varios componentes fijan `es-AR`: unificarlo es #51.", sumar: "Lo
  nuevo usa `src/client/format.ts`."
- En "Estado": M4 ventas y caja (#20) pasa a hecha.

En la spec, sección Dashboard, en el ítem del ranking, sumar: "Solo se muestran los productos con
unidades netas positivas (una anulación de un período anterior no deja un producto en negativo)."

- [ ] **Paso 4: versión**

```powershell
pnpm version minor --no-git-tag-version
```

Esperado: `package.json` en `0.6.0`.

- [ ] **Paso 5: verificación completa y commit**

```powershell
pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }; if ($?) { pnpm test:e2e }
git add e2e/sales-cash.spec.ts AGENTS.md docs/superpowers/specs/2026-10-02-m4-ventas-caja-design.md package.json src/client/components/ui/Drawer.tsx
git commit -m "docs: ventas y caja en AGENTS.md, e2e del criterio de aceptación y versión 0.6.0 (#20)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Paso 6: informe final**

En el chat, un informe con:

- qué se hizo, tarea por tarea;
- el resultado de la verificación completa;
- la **prueba manual como checklist**, con una acción precisa y una verificación por paso (memoria
  "Guías como checklist"). Cubre:
  - levantar `pnpm dev` y entrar con el seed;
  - hacer desde el POS local (`/pos/<versión>/`) dos ventas, una anulación y una cobranza;
  - encontrar cada una con los filtros de Ventas & Caja;
  - abrir el ticket;
  - comparar el Resumen del día con el `/RESUMEN` del POS, número por número;
  - cada click del dashboard;
  - celular y modo oscuro.

Después, frenar y pedir la aprobación para abrir el PR (rama `claude/m4-ventas-caja`, merge commit,
cuerpo con "Closes #20").
