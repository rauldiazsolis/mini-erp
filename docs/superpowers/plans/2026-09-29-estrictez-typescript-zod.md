# Estrictez de TypeScript y Zod: plan de implementación

> **Para agentes:** se ejecuta con `superpowers:executing-plans`, **inline y tarea por tarea** en la
> misma conversación (AGENTS.md: nunca un subagente por tarea). Al terminar cada tarea: verificación
> completa, commit y **freno** para que el usuario la revise. Pasos con checkbox (`- [ ]`).

**Objetivo:** cerrar rauldiazsolis/mini-erp#1 (Etapa 3 del epic rauldiazsolis/offline-pos#161): el
mini-erp con la misma estrictez de TypeScript y lint que offline-pos, y los siete tipos de evento del
push validados con Zod.

**Arquitectura:** TypeScript 6.0.3 sigue en modo `noEmit` (Node 24 stripea con su propio parser; la
versión de `typescript` solo afecta al typecheck), y `erasableSyntaxOnly` hace cumplir por compilador
lo que el strip-only ya exige. Los eventos del push se validan en un módulo nuevo,
`src/server/connector/push-events.ts`: sobre común + un esquema por tipo (unión discriminada por
`type`), cada uno con lo que el mini-erp lee y `passthrough` para el resto. `ConnectorService` recibe
`unknown[]` y aplica solo eventos ya parseados, sin `as`.

**Stack:** TypeScript 6.0.3, Zod 3 (sin cambio de versión), ESLint 10 + typescript-eslint 8.71 +
eslint-plugin-react-hooks 7.1.1, Vitest 3.

**Spec:** no hay spec aparte; el alcance es el issue #1 más las decisiones tomadas en la
conversación de planificación (abajo).

## Decisiones tomadas

1. **Zod de los eventos: "lo que usa + passthrough"**, como ya hace `sale`. Se exige lo que el
   mini-erp lee; el resto viaja tal cual al payload guardado. Los enums abiertos del contrato
   (`Payment.method`, `StockMovement.reason`) quedan como `z.string()` por las reglas de evolución
   del contrato. Un evento de un POS anterior sin `origin` ni `createdAt` se sigue aceptando.
2. **Un elemento que ni siquiera es un evento** (no es objeto, o le falta `id`/`type`) **es un issue
   del lote**, no un `400`: la ruta acepta `events: z.array(z.unknown())`. El issue lleva `eventId`
   si el elemento tenía un `id` string no vacío.
3. **Hooks:** `eslint-plugin-react-hooks` como en offline-pos, más `no-restricted-imports` de
   `preact/hooks`, `preact/compat` y `react`, para que la regla de AGENTS.md ("sin hooks") la haga
   cumplir el lint.
4. **Zod 4 y `@types/node` 24 quedan afuera**: rauldiazsolis/mini-erp#6.

## Estado medido (2026-09-29)

| Opción | TS 5.7.3 | TS 6.0.3 |
|---|---|---|
| sin cambios | 0 | 1 (`main.tsx` importa `./index.css`; TS 6 valida imports de efecto secundario) |
| `exactOptionalPropertyTypes` | 35 | 35 (+ el del CSS) |
| `noUnusedLocals` | 2 (`dashboard-state.ts:136-137`) | 2 |
| `noUnusedParameters` | 0 | 0 |
| `erasableSyntaxOnly` | no existe | 0 |

## Restricciones globales

- Todo en español: código nuevo, comentarios, mensajes de issue del lote, commits.
- `any` prohibido; `unknown` solo en fronteras y validado con Zod en la línea siguiente.
- Sin parameter properties, sin `enum`, imports relativos con extensión `.ts`.
- **No cambia el contrato implementado** (sigue 4.2.0) ni el comportamiento de un lote válido.
- Cada tarea termina con, desde **PowerShell**:
  `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }; if ($?) { pnpm build }`
  todo en verde, y un commit convencional con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Rama: `claude/mini-erp-typescript-zod-45a351` (la del worktree). PR recién después de la revisión.

## Mapa de archivos

| Archivo | Cambio |
|---|---|
| `package.json`, `pnpm-lock.yaml` | `typescript` `6.0.3`; `eslint-plugin-react-hooks` `^7.1.1` |
| `tsconfig.json` | `types: ["node", "vite/client"]`; `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` |
| `eslint.config.js` | plugin react-hooks + `no-restricted-imports` |
| `src/client/state/dashboard-state.ts` | sin las variables `_p`/`_b` |
| `src/server/connector/push-events.ts` | **nuevo**: esquemas Zod de los siete eventos, `parseBatchEvent`, `summarizeForLog` |
| `src/server/connector/connector-service.ts` | recibe `unknown[]`, aplica `PushEvent` tipados, sin `as` en eventos |
| `src/server/routes/connector-routes.ts` | `events: z.array(z.unknown())`, log sin casts |
| `test/push-events.test.ts` | **nuevo**: unitarios de `parseBatchEvent` |
| `test/connector-api.test.ts` | casos HTTP de lotes con eventos inválidos |
| ~20 archivos de `src/server/**` y 2 tests | ajustes de `exactOptionalPropertyTypes` (Tarea 4) |
| `AGENTS.md`, `PLAN.md` | reflejar lo nuevo; sacar #1 de pendientes |

---

### Tarea 0: commit del plan aprobado

- [ ] `git add docs/superpowers/plans/2026-09-29-estrictez-typescript-zod.md` y commit
  `docs: plan de estrictez de TypeScript y Zod` (con `Refs #1` y el Co-Authored-By).

---

### Tarea 1: TypeScript 6.0.3

Sin cambio de comportamiento: la verificación es la suite completa.

**Archivos:** `package.json`, `pnpm-lock.yaml`, `tsconfig.json`.

- [ ] **Paso 1:** instalar la versión exacta, alineada con offline-pos (que usa `~6.0.2`, resuelta a 6.0.3):

```powershell
pnpm add -D typescript@~6.0.3
```

- [ ] **Paso 2:** confirmar el error esperado:

```powershell
pnpm typecheck
```

Esperado: 1 error, `src/client/main.tsx(3,8): error TS2882 ... './index.css'`.

- [ ] **Paso 3:** en `tsconfig.json`, sumar los tipos de Vite (declaran `*.css`, como en offline-pos):

```json
    "types": ["node", "vite/client"],
```

- [ ] **Paso 4:** verificación completa (lint, typecheck 0 errores, tests, build). Si
  typescript-eslint avisa por la versión de TS, revisar: su peer es `>=4.8.4 <6.1.0`, así que 6.0.3
  entra.
- [ ] **Paso 5:** commit.

```bash
git add package.json pnpm-lock.yaml tsconfig.json
git commit -F - <<'EOF'
build: TypeScript 6.0.3

Mismo major que offline-pos. Los tipos de vite/client declaran el import de
index.css, que TS 6 ahora valida.

Refs #1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 2: `noUnusedLocals`, `noUnusedParameters` y `erasableSyntaxOnly`

**Archivos:** `tsconfig.json`, `src/client/state/dashboard-state.ts:134-142`.

- [ ] **Paso 1:** en `tsconfig.json`, después de `noFallthroughCasesInSwitch`:

```json
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
```

- [ ] **Paso 2:** `pnpm typecheck` → esperado: 2 errores TS6133 (`_p`, `_b` en `dashboard-state.ts`).
- [ ] **Paso 3:** las dos lecturas existen solo para suscribir el `effect` a los filtros. Se
  reemplazan por lecturas que sí se usan: el effect le pasa los filtros a una función de carga. En
  `dashboard-state.ts`, el segundo effect queda:

```typescript
  effect(() => {
    // Recargar cuando cambian los filtros (período o sucursal): leerlos acá suscribe el effect.
    const filters = { period: selectedPeriodSignal.value, branch: selectedBranchSignal.value };
    const tenantId = effectiveTenantIdSignal.value;
    if (tenantId && tokenSignal.value) {
      void fetchDashboardData(filters);
    }
  });
```

  y `fetchDashboardData` acepta los filtros como parámetro opcional, con los signals como valor por
  defecto (así las otras llamadas, sin argumentos, no cambian):

```typescript
export async function fetchDashboardData(
  filters: { period: DashboardPeriod; branch: string } = {
    period: selectedPeriodSignal.value,
    branch: selectedBranchSignal.value,
  },
): Promise<void> {
```

  y en las líneas 103-104 (`const period = …; const branch = …;`) se leen `filters.period` y
  `filters.branch` en lugar de los signals.

- [ ] **Paso 4:** verificación completa. Los effects solo corren con `window`, así que el recargar al
  cambiar filtros entra en la prueba manual del informe final.
- [ ] **Paso 5:** commit `build: noUnusedLocals, noUnusedParameters y erasableSyntaxOnly` (con
  `Refs #1` y el Co-Authored-By), archivos `tsconfig.json` y `src/client/state/dashboard-state.ts`.

---

### Tarea 3: los siete eventos del push validados con Zod

TDD: primero los tests (fallan), después el módulo y la integración.

**Archivos:**
- Crear: `src/server/connector/push-events.ts`, `test/push-events.test.ts`
- Modificar: `src/server/connector/connector-service.ts`, `src/server/routes/connector-routes.ts`,
  `test/connector-api.test.ts`

**Interfaces que produce** (`push-events.ts`):

```typescript
export type LotIssue = { message: string; eventId?: string };
export type PushEvent = z.infer<typeof pushEventSchema>; // unión discriminada por `type`
export type ParsedBatchEvent = { ok: true; event: PushEvent } | { ok: false; issue: LotIssue };
export function parseBatchEvent(raw: unknown): ParsedBatchEvent;
export function summarizeForLog(raw: unknown): { type: string; id: string; detail?: string };
```

`ConnectorService.processPushLot` pasa a recibir
`{ lotId: string; deviceId: string; events: unknown[]; defaultBranchId?: string | undefined }`.

- [ ] **Paso 1: tests unitarios** en `test/push-events.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseBatchEvent } from '../src/server/connector/push-events.ts';

const createdAt = '2026-09-29T12:00:00.000Z';
const envelope = { createdAt, origin: { branch: 'CENTRAL', pointOfSale: 'POS-01' } };

const validEvents = {
  sale: {
    id: 'e-sale',
    type: 'sale',
    ...envelope,
    sale: { id: 's1', total: 100, status: 'closed', lines: [], payments: [{ method: 'cash', amount: 100 }], createdAt },
  },
  'stock-movement': {
    id: 'e-sm',
    type: 'stock-movement',
    ...envelope,
    movement: { id: 'm1', productId: 'p1', delta: -1, reason: 'sale', createdAt },
  },
  customer: { id: 'e-c', type: 'customer', ...envelope, customer: { id: 'c1', name: 'Ana', createdAt } },
  'account-hold-confirm': { id: 'e-hc', type: 'account-hold-confirm', ...envelope, holdId: 'h1', saleId: 's1' },
  'account-hold-release': { id: 'e-hr', type: 'account-hold-release', ...envelope, holdId: 'h1' },
  'cash-movement': {
    id: 'e-cm',
    type: 'cash-movement',
    ...envelope,
    movement: { id: 'cm1', direction: 'in', amount: 10, concept: 'Cambio', source: 'manual', createdAt },
  },
  'customer-payment': {
    id: 'e-cp',
    type: 'customer-payment',
    ...envelope,
    payment: { id: 'cp1', customerId: 'c1', payments: [{ method: 'cash', amount: 5 }], total: 5, createdAt },
  },
};

// Por tipo, un evento con un campo que el mini-erp lee roto o faltante.
const brokenEvents = {
  sale: { ...validEvents.sale, sale: { ...validEvents.sale.sale, total: 'cien' } },
  'stock-movement': {
    ...validEvents['stock-movement'],
    movement: { id: 'm1', productId: 'p1', reason: 'sale', createdAt },
  },
  customer: { ...validEvents.customer, customer: { id: 'c1', createdAt } },
  'account-hold-confirm': { id: 'e-hc', type: 'account-hold-confirm', ...envelope, holdId: 'h1' },
  'account-hold-release': { id: 'e-hr', type: 'account-hold-release', ...envelope },
  'cash-movement': { ...validEvents['cash-movement'], movement: { direction: 'in', amount: 10 } },
  'customer-payment': {
    ...validEvents['customer-payment'],
    payment: { id: 'cp1', customerId: 'c1', total: '5', createdAt },
  },
};

describe('parseBatchEvent (#1)', () => {
  it.each(Object.entries(validEvents))('acepta un evento %s válido', (type, raw) => {
    expect(parseBatchEvent(raw)).toMatchObject({ ok: true, event: { id: raw.id, type } });
  });

  it.each(Object.entries(brokenEvents))('un evento %s inválido es un issue con su eventId', (type, raw) => {
    expect(parseBatchEvent(raw)).toMatchObject({
      ok: false,
      issue: { eventId: raw.id, message: expect.stringContaining(`Evento ${type} inválido`) as unknown },
    });
  });

  it('conserva los campos que no valida (passthrough)', () => {
    expect(parseBatchEvent(validEvents.sale)).toMatchObject({
      ok: true,
      event: { origin: { branch: 'CENTRAL' }, sale: { status: 'closed', lines: [], createdAt } },
    });
  });

  it('acepta un medio de pago o un motivo que no conoce (reglas de evolución)', () => {
    const sale = { ...validEvents.sale, sale: { ...validEvents.sale.sale, payments: [{ method: 'cripto', amount: 100 }] } };
    const movement = { ...validEvents['stock-movement'], movement: { ...validEvents['stock-movement'].movement, reason: 'merma' } };
    expect(parseBatchEvent(sale)).toMatchObject({ ok: true });
    expect(parseBatchEvent(movement)).toMatchObject({ ok: true });
  });

  it('acepta un evento de un POS anterior, sin origin ni createdAt', () => {
    expect(parseBatchEvent({ id: 'e-old', type: 'account-hold-release', holdId: 'h1' })).toMatchObject({ ok: true });
  });

  it('un tipo desconocido es un issue "no reconocido" con su eventId', () => {
    expect(parseBatchEvent({ id: 'e-x', type: 'session-open', ...envelope })).toEqual({
      ok: false,
      issue: { message: 'Tipo de evento no reconocido: session-open', eventId: 'e-x' },
    });
  });

  it.each([null, 42, 'venta', [], { type: 'sale' }, { id: '', type: 'sale' }])(
    'un elemento sin sobre válido (%j) es un issue sin eventId',
    (raw) => {
      const result = parseBatchEvent(raw);
      expect(result).toMatchObject({ ok: false, issue: { message: expect.stringContaining('Evento inválido') as unknown } });
      expect(result.ok ? undefined : result.issue.eventId).toBeUndefined();
    },
  );

  it('un sobre sin type conserva el eventId', () => {
    expect(parseBatchEvent({ id: 'e-sin-tipo' })).toMatchObject({ ok: false, issue: { eventId: 'e-sin-tipo' } });
  });
});
```

- [ ] **Paso 2:** `pnpm test test/push-events.test.ts` → esperado: FALLA porque el módulo no existe.

- [ ] **Paso 3: tests HTTP** en `test/connector-api.test.ts`. Primero, subir `pushAndPull` y
  `storedSale` del `describe('venta con número de ticket…')` al `describe` de afuera (debajo del
  `beforeEach`), sin cambiarlos, para compartirlos. Después sumar, antes de
  `describe('POST /connector/account-holds')`:

```typescript
  describe('validación de los eventos del push (#1)', () => {
    const now = new Date().toISOString();
    const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };
    const validSale = {
      id: 'e-sale-ok',
      type: 'sale',
      createdAt: now,
      origin,
      sale: { id: 'sale-ok', total: 100, status: 'closed', lines: [], payments: [{ method: 'cash', amount: 100 }] },
    };

    it('un elemento que no es un evento no rechaza el lote: es un aviso y el resto se aplica', async () => {
      const lot = await pushAndPull('lot-no-evento', [42, validSale]);

      expect(lot?.status).toBe('issues');
      expect(lot?.issues).toHaveLength(1);
      expect(lot?.issues?.[0]?.eventId).toBeUndefined();
      expect(storedSale('sale-ok')).toBeDefined();
    });

    it('una liberación de bloqueo sin holdId es un aviso del lote', async () => {
      const lot = await pushAndPull('lot-release-sin-hold', [
        { id: 'e-release', type: 'account-hold-release', createdAt: now, origin },
      ]);

      expect(lot?.status).toBe('issues');
      expect(lot?.issues?.map((issue) => issue.eventId)).toEqual(['e-release']);
    });

    it('un movimiento de stock sin delta es un aviso y no toca el stock', async () => {
      const stockOf = () =>
        (tenantManager
          .getTenantDb(tenantId)
          .prepare("SELECT SUM(quantity) AS total FROM stock WHERE product_id = 'prod-coca-500'")
          .get() as { total: number | null }).total;
      const before = stockOf();

      const lot = await pushAndPull('lot-mov-sin-delta', [
        {
          id: 'e-mov',
          type: 'stock-movement',
          createdAt: now,
          origin,
          movement: { id: 'mov-sin-delta', productId: 'prod-coca-500', reason: 'sale' },
        },
      ]);

      expect(lot?.issues?.map((issue) => issue.eventId)).toEqual(['e-mov']);
      expect(stockOf()).toBe(before);
    });
  });
```

- [ ] **Paso 4:** `pnpm test test/connector-api.test.ts` → esperado: fallan los tres nuevos (el
  primero por el `400` de la ruta, el segundo porque hoy da `ok`, el tercero porque aplica el
  movimiento o tira un error). Los existentes siguen en verde.

- [ ] **Paso 5: el módulo** `src/server/connector/push-events.ts`:

```typescript
import { z } from 'zod';

/**
 * Eventos del push del Connector API 4.2.0 (`OutboxBatchItem`). Cada tipo valida lo que el mini-erp
 * lee y deja pasar el resto (`passthrough`), así el ERP guarda el evento completo aunque el contrato
 * sume campos. Los enums abiertos (medio de pago, motivo de stock) son `string` por las reglas de
 * evolución del contrato. Un evento inválido es un `LotIssue` del lote, nunca un error del request.
 */

export type LotIssue = { message: string; eventId?: string };

/** Sobre común. Un POS anterior puede mandar un evento sin `origin` ni `createdAt`. */
const envelopeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    createdAt: z.string().optional(),
    origin: z
      .object({ branch: z.string().optional(), pointOfSale: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const paymentSchema = z
  .object({ method: z.string(), amount: z.number(), reference: z.string().optional() })
  .passthrough();

/** Venta: total, cliente, anulación, pagos y el número de ticket (4.1.0). */
const saleSchema = z
  .object({
    id: z.string().min(1),
    total: z.number(),
    customerId: z.string().optional(),
    voidsSaleId: z.string().optional(),
    payments: z.array(paymentSchema),
    ticket: z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), number: z.number().int().min(1) })
      .optional(),
  })
  .passthrough();

const stockMovementSchema = z
  .object({
    id: z.string().min(1),
    productId: z.string().min(1),
    delta: z.number(),
    reason: z.string(),
    saleId: z.string().optional(),
  })
  .passthrough();

const customerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    document: z.string().optional(),
    phone: z.string().optional(),
    creditLimit: z.number().optional(),
    margin: z.number().optional(),
    balance: z.number().optional(),
    unrestricted: z.boolean().optional(),
    blocked: z.object({ reason: z.string() }).passthrough().optional(),
  })
  .passthrough();

/** Movimiento de caja: el mini-erp lo guarda completo; solo necesita el id. */
const cashMovementSchema = z.object({ id: z.string().min(1) }).passthrough();

const customerPaymentSchema = z
  .object({ id: z.string().min(1), customerId: z.string().min(1), total: z.number() })
  .passthrough();

const pushEventSchema = z.discriminatedUnion('type', [
  envelopeSchema.extend({ type: z.literal('sale'), sale: saleSchema }),
  envelopeSchema.extend({ type: z.literal('stock-movement'), movement: stockMovementSchema }),
  envelopeSchema.extend({ type: z.literal('customer'), customer: customerSchema }),
  envelopeSchema.extend({
    type: z.literal('account-hold-confirm'),
    holdId: z.string().min(1),
    saleId: z.string().min(1),
  }),
  envelopeSchema.extend({ type: z.literal('account-hold-release'), holdId: z.string().min(1) }),
  envelopeSchema.extend({ type: z.literal('cash-movement'), movement: cashMovementSchema }),
  envelopeSchema.extend({ type: z.literal('customer-payment'), payment: customerPaymentSchema }),
]);

export type PushEvent = z.infer<typeof pushEventSchema>;

export type ParsedBatchEvent = { ok: true; event: PushEvent } | { ok: false; issue: LotIssue };

const knownTypes: ReadonlySet<string> = new Set(pushEventSchema.options.map((option) => option.shape.type.value));

function describeError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/** El `id` del elemento, si es un string no vacío (para el `eventId` del issue). */
function eventIdOf(raw: unknown): { eventId?: string } {
  if (typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string' && raw.id !== '') {
    return { eventId: raw.id };
  }
  return {};
}

export function parseBatchEvent(raw: unknown): ParsedBatchEvent {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return { ok: false, issue: { message: `Evento inválido: ${describeError(envelope.error)}`, ...eventIdOf(raw) } };
  }
  const { id, type } = envelope.data;
  if (!knownTypes.has(type)) {
    return { ok: false, issue: { message: `Tipo de evento no reconocido: ${type}`, eventId: id } };
  }
  const event = pushEventSchema.safeParse(raw);
  if (!event.success) {
    return { ok: false, issue: { message: `Evento ${type} inválido: ${describeError(event.error)}`, eventId: id } };
  }
  return { ok: true, event: event.data };
}

function detailOf(event: PushEvent): string | undefined {
  switch (event.type) {
    case 'sale':
      return `$${String(event.sale.total)}`;
    case 'stock-movement':
      return `${event.movement.productId} (${String(event.movement.delta)})`;
    case 'customer':
      return event.customer.name;
    default:
      return undefined;
  }
}

/** Resumen de un elemento del lote para el log del push; un evento inválido figura como tal. */
export function summarizeForLog(raw: unknown): { type: string; id: string; detail?: string } {
  const parsed = parseBatchEvent(raw);
  if (!parsed.ok) {
    return { type: 'inválido', id: parsed.issue.eventId ?? '?' };
  }
  const detail = detailOf(parsed.event);
  return {
    type: parsed.event.type,
    id: parsed.event.id,
    ...(detail === undefined ? {} : { detail }),
  };
}
```

  Nota de Zod 3: `.extend()` conserva el `passthrough` del sobre. Si al implementar no lo conserva,
  el test "conserva los campos que no valida" lo detecta; en ese caso se agrega `.passthrough()` a
  cada rama.

- [ ] **Paso 6: `connector-service.ts`**:
  - Borrar `BatchEvent`, `saleEventSchema`, el `import { z }` y el `LotIssue` local; importar
    `import { parseBatchEvent, type LotIssue, type PushEvent } from './push-events.ts';` y reexportar
    `export type { LotIssue };` (lo usa el pull).
  - `processPushLot` recibe `events: unknown[]` (y `defaultBranchId?: string | undefined`). El bucle:

```typescript
    for (const raw of params.events) {
      const parsed = parseBatchEvent(raw);
      if (!parsed.ok) {
        issues.push(parsed.issue);
        continue;
      }
      const issue = this.applyEvent(parsed.event, params.deviceId, resolvedBranchId, now);
      if (issue !== undefined) {
        issues.push(issue);
      }
    }
```

  - `applyEvent(event: PushEvent, …)`: cada `case` usa `event.sale`, `event.movement`,
    `event.customer`, `event.holdId`, `event.saleId`, `event.payment` directamente, sin `as` ni
    `String(...)`. El `case 'sale'` pierde su `safeParse` (ya viene parseado) y queda
    `const sale = event.sale;`. El `default` desaparece: el switch es exhaustivo sobre la unión y el
    tipo desconocido ya lo reporta `parseBatchEvent`. `applyEvent` sigue devolviendo
    `LotIssue | undefined` (hoy ningún caso devuelve issue; se mantiene la firma).

- [ ] **Paso 7: `connector-routes.ts`**:
  - `pushBatchSchema`: `events: z.array(z.unknown())`.
  - `processPushLot({ …, events: parseResult.data.events, … })`, sin `as BatchEvent[]`.
  - El bloque `eventsForLog` se reemplaza por
    `const eventsForLog = parseResult.data.events.map(summarizeForLog);` (importado de
    `../connector/push-events.ts`); se borra el import de `BatchEvent`.

- [ ] **Paso 8:** `pnpm test test/push-events.test.ts test/connector-api.test.ts test/e2e-pos-sync-lifecycle.test.ts`
  → todo en verde. El e2e manda un `cash-movement` y un `customer-payment` con formas viejas que no
  son las del contrato; siguen pasando porque solo se exige lo que el mini-erp lee (si alguno falla,
  frenar y consultar antes de tocar el fixture).
- [ ] **Paso 9:** `grep -n " as " src/server/connector/connector-service.ts src/server/routes/connector-routes.ts`
  → los únicos `as` que quedan son sobre filas de SQLite (`.get(...) as {...}`), ninguno sobre eventos.
- [ ] **Paso 10:** verificación completa y commit:

```bash
git add src/server/connector/push-events.ts src/server/connector/connector-service.ts \
  src/server/routes/connector-routes.ts test/push-events.test.ts test/connector-api.test.ts
git commit -F - <<'EOF'
feat: validar con Zod los siete tipos de evento del push

Cada tipo valida lo que el mini-erp lee y deja pasar el resto. Un evento
inválido, de tipo desconocido o que ni siquiera es un objeto queda como
issue del lote, sin rechazar el request ni el resto de los eventos.

Refs #1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 4: `exactOptionalPropertyTypes`

Sin cambio de comportamiento: el typecheck es el test. ~35 errores, casi todos del mismo patrón: Zod 3
infiere `x?: T | undefined` y los servicios declaran `x?: T`.

**Regla para arreglarlos** (se anota en AGENTS.md en la Tarea 6):
- **Entradas** de servicios que vienen de Zod o de query params (`CreateBranchInput`, filtros de
  listados, `ContainerDependencies`, etc.): el tipo del servicio declara `x?: T | undefined`. Es la
  verdad: el servicio ya trata `undefined` igual que ausente.
- **Resultados** que arma el propio código (`PushLotResult`, `ImportIssue`, `DashboardData`,
  argumentos de `posLog`): no se pone la propiedad si no hay valor, con
  `...(x === undefined ? {} : { x })`, o se tipa `x?: T | undefined` si el resultado es un DTO que
  viaja por JSON y el cliente ya lo lee así (`DashboardData.branchId`).
- Nunca `as` ni `!` para callar el error.

**Archivos** (según la medición de hoy): `src/client/api/client.ts`,
`src/client/components/settings/PosKeysSection.tsx`, `src/server/app.ts`,
`src/server/connector/connector-service.ts`, `src/server/dashboard/dashboard-service.ts`,
`src/server/io/import-export-service.ts`, `src/server/routes/{bulk,catalog,connector,customer,dashboard,io,stock}-routes.ts`
(o los tipos de los servicios que esas rutas llaman), `test/dashboard-client.test.ts`,
`test/onboarding-wizard.test.ts`.

- [ ] **Paso 1:** activar `"exactOptionalPropertyTypes": true` en `tsconfig.json` y guardar la lista:
  `pnpm typecheck` → anotar el conteo de partida.
- [ ] **Paso 2:** servidor, rutas → servicios: ampliar los tipos de entrada de los servicios con
  `| undefined` según la regla. `pnpm typecheck` después de cada archivo.
- [ ] **Paso 3:** servidor, resultados propios (`connector-service.ts` `PushLotResult` en líneas 61 y
  94, `import-export-service.ts` `ImportIssue`, `dashboard-service.ts`, `app.ts`).
- [ ] **Paso 4:** cliente (`client.ts:39`, `PosKeysSection.tsx:263`) y tests
  (`dashboard-client.test.ts:59`, `onboarding-wizard.test.ts:151`).
- [ ] **Paso 5:** `pnpm typecheck` → 0 errores; verificación completa.
- [ ] **Paso 6:** commit `refactor: exactOptionalPropertyTypes` (con `Refs #1` y el Co-Authored-By;
  cuerpo con la regla de entradas/resultados en dos líneas), con los archivos tocados.

---

### Tarea 5: lint de hooks

**Archivos:** `package.json`, `pnpm-lock.yaml`, `eslint.config.js`.

- [ ] **Paso 1:** `pnpm add -D eslint-plugin-react-hooks@^7.1.1`
- [ ] **Paso 2: test que falla primero**: crear `src/client/_hooks-probe.tsx`:

```tsx
import { useState } from 'preact/hooks';

export function Probe() {
  const [count] = useState(0);
  return <span>{count}</span>;
}
```

  `pnpm lint` → esperado: **verde** (hoy nada lo prohíbe). Esto demuestra la falta.

- [ ] **Paso 3:** `eslint.config.js`:

```javascript
import reactHooks from 'eslint-plugin-react-hooks';
// …
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // AGENTS.md: el estado del admin vive en signals; sin hooks de React ni de Preact.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'preact/hooks', message: 'Sin hooks: usar signals (AGENTS.md).' },
            { name: 'preact/compat', message: 'Sin compat de React: Preact directo (AGENTS.md).' },
            { name: 'react', message: 'Es Preact: importar de preact (AGENTS.md).' },
          ],
        },
      ],
      // …las reglas de typescript-eslint que ya están
    },
```

- [ ] **Paso 4:** `pnpm lint` → esperado: error `no-restricted-imports` en `_hooks-probe.tsx`.
- [ ] **Paso 5:** borrar `src/client/_hooks-probe.tsx`; verificación completa en verde.
- [ ] **Paso 6:** commit `build: lint de hooks y prohibición de preact/hooks` (con `Refs #1` y el
  Co-Authored-By), archivos `package.json`, `pnpm-lock.yaml`, `eslint.config.js`.

---

### Tarea 6: documentación

**Archivos:** `AGENTS.md`, `PLAN.md`.

- [ ] **Paso 1: `AGENTS.md`**:
  - "Convenciones de TypeScript y Node": cambiar "Endurecer esto (…) es #1." por las opciones que
    rigen (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`,
    `noUnusedParameters`, `erasableSyntaxOnly`; TypeScript 6) y la regla de la Tarea 4 (entradas
    `?: T | undefined`, resultados sin la propiedad; nunca `as`/`!`).
  - "Connector API": "Hoy se valida solo `sale` (…) en #1." → "Los siete tipos se validan en
    `src/server/connector/push-events.ts`: lo que el mini-erp lee, `passthrough` para el resto; un
    elemento inválido o desconocido es un `issue` del lote."
  - "Admin": "Sin hooks de React" → agregar "(lo hace cumplir el lint)".
  - "Estado": sacar #1 de la lista de lo que sigue (queda #2 y #3) y mencionar #6.
- [ ] **Paso 2: `PLAN.md`**: sumar al final "## 10. FASE 8 (Estrictez de TypeScript y Zod)
  [COMPLETADA]" con tres o cuatro viñetas (TS 6, opciones, eventos con Zod, lint de hooks) y la
  cantidad de tests, en el estilo de las fases anteriores. En el "Mapa de Fases" (sección 2), sumar
  la fila de la Fase 8 si la tabla lista las fases.
- [ ] **Paso 3:** verificación completa y commit `docs: estrictez de TypeScript y Zod en AGENTS.md y PLAN.md`
  (con `Refs #1` y el Co-Authored-By).

---

## Cierre (después de la revisión del usuario)

1. Informe final con la prueba manual (abajo).
2. Con el visto bueno: push y PR a `main` con "Closes #1" (y mención de #6), merge commit.
3. Después del merge: verificar que #1 se cerró; tildar la Etapa 3 en
   rauldiazsolis/offline-pos#161 con "— PR rauldiazsolis/mini-erp#N", vía
   `gh api -X PATCH repos/rauldiazsolis/offline-pos/issues/161 -F body=@archivo`.

### Prueba manual prevista para el informe

- `pnpm dev`, entrar al admin, dashboard: cambiar período y sucursal → recarga los números (Tarea 2).
- Con una API key de terminal, `curl` a `/connector/sync/push` con un lote `[42, <venta válida>]` →
  `200`; `/connector/sync/pull` con ese lote en `pendingLotIds` → `status: "issues"`, un issue sin
  `eventId`, y la venta aparece en el admin. En la consola del servidor, el log del lote muestra
  `inválido` y `sale ($100)`.
- Lote con `account-hold-release` sin `holdId` → issue con su `eventId`.
