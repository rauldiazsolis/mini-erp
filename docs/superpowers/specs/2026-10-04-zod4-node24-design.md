# Zod 4 y @types/node 24 (#6)

## Problema

offline-pos ya usa `zod ^4` y `@types/node ^24`. El mini-erp sigue con `zod ^3.24.2` y
`@types/node ^22.13.4`, aunque `engines.node` pide `>=24`. La etapa es un cambio de versión **sin cambio
de comportamiento**, con una sola excepción decidida: los mensajes por defecto de Zod pasan a estar en
castellano.

## Inventario

Zod se usa en 26 archivos: 22 del servidor, 1 del cliente (`src/client/state/sales-labels.ts`, un
`z.tuple`), 1 compartido (`src/shared/password.ts`) y 2 scripts
(`contract-source.ts`, `create-root.ts`). Los tests no importan Zod.

| Zod 3 | Dónde | Cantidad |
|---|---|---|
| `error.errors` | rutas de `/api` y del connector, `create-root.ts` | ~40 |
| `z.record(valor)` | `io-routes.ts`, `stored-documents.ts` | 2 |
| `.passthrough()` | `push-events.ts` (9), `pos-assets.ts` (2), `connector-routes.ts` (1) | 12 |
| `required_error`, `invalid_type_error`, `errorMap` | `alta`, `io`, `bulk`, `customer`, `stock` y `platform-routes.ts` | 8 |
| `z.ZodType<T, z.ZodTypeDef, unknown>` | `handle` de `platform-routes.ts` y de `sales-routes.ts` | 2 |
| `.email()` y `z.ZodIssueCode` (obsoletos en Zod 4) | `auth-routes.ts`, `alta-routes.ts`, `create-root.ts` | 4 |

En Zod 4, `required_error`, `invalid_type_error` y `errorMap` ya no existen. Lo obsoleto
(`.email()`, `.passthrough()`, `ZodIssueCode`, el parámetro `message`) igual se cambia, porque el lint
(`strictTypeChecked`) incluye `@typescript-eslint/no-deprecated`.

## Lo que se verificó con Zod 4.6.5 (spike descartable)

- **Opcionales**: `z.infer` sigue dando `x?: T | undefined`; asignarlo a `{ x?: T }` falla con
  `exactOptionalPropertyTypes`, igual que con Zod 3. **La convención de AGENTS.md no cambia**; solo se
  corrige "Zod 3 infiere así" por "Zod infiere así". offline-pos dice lo mismo
  (`src/sync/connector.ts`).
- **Push**: `z.looseObject(...).extend(...)` adentro de un `z.discriminatedUnion` conserva los campos
  desconocidos, y `option.shape.type.value` sigue andando.
- **Mensajes propios** (`.min(2, 'texto')`, `{ error: '…' }`): se mantienen tal cual.
- **Mensajes por defecto**: cambian igual (`"Required"` pasa a ser
  `"Invalid input: expected string, received undefined"`). Con `z.locales.es()` quedan, por ejemplo,
  `"Entrada inválida: se esperaba texto, recibido indefinido"`.
- **Sin cambios** en: `z.coerce.number()` con `''` (sigue fallando), `z.number()` con `Infinity`
  (lo rechaza), `z.tuple` con `nullable`, y `.partial().strict()` con una clave de más (falla).
- **Defaults dentro de `.partial()`**: Zod 4 los aplica, pero el único `.partial()`
  (`billingSettingsPatchSchema`) no tiene defaults.
- **Email**: `z.string().trim().email()` hoy recorta antes de validar; con `z.email()` el recorte va
  antes, con `.pipe`.

## Decisiones

### Mensajes por defecto en castellano: `src/shared/zod.ts`

`src/shared/zod.ts` hace `z.config(z.locales.es())` y reexporta `z`. Todo `src/` (servidor, cliente y
compartido) y `scripts/` importa de ahí. Una regla `no-restricted-imports` de `'zod'` (con excepción
para ese archivo) impide que alguien importe directo y se saltee el castellano. Como `z.config` es
global al proceso, alcanza con que el módulo se cargue antes del primer parse, y el import lo
garantiza.

Esos mensajes se ven en los `400` de `/api` (el admin muestra `error` tal cual,
`src/client/api/client.ts`), en los `400` del Connector API y en los `issues` de los lotes del push. Son
solo para personas: ni mini ni offline-pos interpretan su texto (el POS decide con `status`).

Se descartaron:
- dejar los textos nuevos en inglés;
- un texto propio en cada esquema (~100: un diff mucho más grande).

Que el idioma sea configurable es #74.

### Zod sigue en el cliente

Los formularios del admin validan hoy a mano y la idea es que usen los esquemas compartidos. Eso es
#75, aparte: mover esquemas a `src/shared/`, cambiar ~10 stores y sus tests. En esta etapa,
`sales-labels.ts` importa de `src/shared/zod.ts`, así el cliente queda con el mismo locale. Se mide el
bundle del cliente antes y después; si crece mucho, se discute en la revisión.

### Migración de la API, sin cambiar textos

| Zod 3 | Zod 4 |
|---|---|
| `error.errors[0]?.message` | `error.issues[0]?.message` |
| `{ errorMap: () => ({ message: M }) }` | `{ error: M }` |
| `{ required_error: A, invalid_type_error: B }` | `{ error: (iss) => (iss.input === undefined ? A : B) }` |
| `{ required_error: A }` | `{ error: (iss) => (iss.input === undefined ? A : undefined) }` (el resto, mensaje por defecto) |
| `{ invalid_type_error: B }` | `{ error: (iss) => (iss.input === undefined ? undefined : B) }` |
| el mismo texto en ambos (WhatsApp) | `{ error: WHATSAPP_MESSAGE }` |
| `z.object({...}).passthrough()` | `z.looseObject({...})` |
| `z.string().trim().email(M)` | `z.string().trim().pipe(z.email(M))` |
| `z.ZodIssueCode.custom` | `'custom'` |
| `z.record(v)` | `z.record(z.string(), v)` |
| `z.ZodType<T, z.ZodTypeDef, unknown>` | `z.ZodType<T>` |

Un detalle de Zod 3 que se conserva: `errorMap` en un `z.enum` reemplazaba todos los mensajes de ese
esquema, también el de "falta". `{ error: M }` hace lo mismo.

Los emails del seed (`dueno-a@local.test` y los demás de `local.test`) validan con `z.email()`.

### El push del Connector API

`push-events.ts` cambia `.passthrough()` por `z.looseObject` y nada más. `parseBatchEvent` conserva
su forma: el sobre, el tipo conocido y el evento completo, y todo lo que falla es un `issue` del lote
(con su `eventId` si lo tiene). Ningún evento inválido hace rechazar el lote. Los textos de los
`issues` (`Evento inválido: …`, `Evento <tipo> inválido: <ruta>: <mensaje>`) mantienen su forma; lo de
Zod adentro pasa a estar en castellano.

### @types/node 24

Pasa de `^22.13.4` a `^24.19.1`, en una tarea propia, antes de tocar Zod, para que sus errores de tsc
(`node:sqlite`: `DatabaseSync`, `StatementSync`, u otros) queden aislados.

## Verificación

Tests escritos **antes** de migrar, en verde con Zod 3, que tienen que seguir verdes con Zod 4:

- **Textos propios** que hoy no fija ningún test: alta (nombre del comercio, email con espacios
  alrededor que se acepta, email inválido), importación (`csv` y `dryRun` ausentes), bulk (acción
  inválida), ajuste de cuenta corriente (tipo inválido), ajuste de stock (tipo inválido y cantidad no
  numérica), plataforma (importe de otro tipo). Ya están fijados: el rubro, el WhatsApp y el importe
  mayor que 0.
- **Push**: un evento con campos desconocidos en todos los niveles (sobre, `origin`, venta, pago,
  cliente, `blocked`, movimiento de caja) los guarda; un lote con eventos inválidos de cada tipo, un
  no-objeto y un tipo desconocido responde `200` y los reporta como `issues`, y aplica los válidos.

Y uno que falla con Zod 3 (el cambio decidido): un `400` de `/api` sin texto propio y un `issue` del
push vienen en castellano.

Al cerrar: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm build` y `pnpm test:e2e`.

## Docs y versión

- **AGENTS.md**:
  - Zod 4 se importa de `src/shared/zod.ts` (locale `es`, #74 y #75).
  - "Zod 3 infiere así" pasa a "Zod infiere así".
  - En el push, `z.looseObject` en lugar de `passthrough`.
- **Versión**: `0.11.2` (patch).

## Fuera de alcance

- El idioma configurable (#74).
- La validación de formularios con esquemas compartidos (#75).
