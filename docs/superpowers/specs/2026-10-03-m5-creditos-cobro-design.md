# M5 · Créditos y cobro: caja con equipo, cargos, pagados y regalados (#21)

Fecha: 2026-10-03. Issue: rauldiazsolis/mini-erp#21 (epic #17, hito 1). Versión: 0.7.0.

## Contexto

El MVP (`2026-10-01-mvp-mini-contax-design.md`, sección "Créditos y cobro") fija el producto: un cargo
por caja y por día con ventas, dinero pagado del owner titular, créditos regalados por comercio, deuda
con gracia y restricción del admin, pagos registrados por root o soporte y la pantalla "Créditos".

Criterio de aceptación de #21:

- Con un comercio nuevo (con bono de alta) y dos cajas, vender en las dos el mismo día genera dos
  cargos, y los días sin ventas no generan ninguno.
- Una venta offline sincronizada al día siguiente se cobra en su día.
- Después de registrar un pago, los cargos siguientes se reparten según la proporción.
- Sin saldo aparecen los avisos en el POS y, pasada la gracia, el admin queda restringido mientras el
  POS sigue sincronizando.

Así está hoy:

- **La caja es la key.** `tenant_api_keys` (sistema) tiene `branch` y `point_of_sale`; no hay
  entidad caja ni equipo. M4 agrupa por sucursal + punto de venta del `origin` de cada evento.
- **El `deviceId`** viaja en el body: obligatorio en el push, opcional en el pull. La auth del POS
  solo ve la key.
- **Las ventas** (`sales`, comercio v5) guardan `device_id`, `branch`, `point_of_sale` y `day`
  (`ticket.date` o el día argentino del `createdAt`), pero no la key ni la caja.
- **`noticesFor`** (M3) solo ve la base del comercio.
- **Producción tiene datos**: comercio en v5, sistema en v4. Nada de reinicios; todo por migración
  (la spec del MVP decía que reiniciar producción era aceptable: deja de serlo y se corrige).

## Decisiones

1. **Caja = entidad propia** (`registers`, sistema): sucursal, punto de venta, nombre y el equipo
   ligado. Una caja tiene keys (a lo sumo una activa): rotar la key no cambia la caja ni su equipo.
2. **Equipo ligado**: la caja se liga al primer `deviceId` que la usa después del deploy (push o pull
   con `deviceId`). Otro equipo con la misma key **cobra aparte**: su propio cargo por día, como
   "Caja · otro equipo". Sus ventas se aplican igual (el backend nunca rechaza un lote). El owner o un
   admin pasa la caja a ese equipo o le crea una caja.
3. **El día del cargo es `sales.day`** (el de M4: `ticket.date` o el día argentino del `createdAt`,
   nunca el del sync). El consumo de "Créditos" cuadra con Ventas & Caja y el `/RESUMEN`. Una venta
   anulada, una devolución o cualquier ticket que no sea anulación genera el cargo; un día con solo
   anulaciones, no.
4. **Sin cargos retroactivos**: solo cobran las ventas con caja (`sales.register_id`), que el push
   empieza a completar con M5. Las demos nunca cobran.
5. **Bono de alta**: $50.000 que vencen a los 90 días (configurables). La migración se lo da a los
   comercios existentes, con vencimiento a 90 días del deploy.
6. **Reparto de cada cargo**:
   - con saldo pagado del titular > 0, la proporción configurada (50 % pagado por defecto); el
     faltante de una fuente se toma de la otra;
   - con pagado en 0, 100 % regalado;
   - los regalados del comercio, por vencimiento más próximo;
   - lo que no cubre ninguna fuente es deuda del comercio;
   - pesos enteros: la parte pagada se redondea y el regalado completa;
   - el cargo guarda el reparto y la regla (precio y proporción vigentes).
7. **Deuda y gracia**: la gracia son **10 días corridos** (configurables) desde el día del cargo en
   deuda más antiguo sin cancelar. Root o soporte la extienden fijando una fecha límite por comercio.
   Pasada la fecha, el comercio queda **restringido**. Un pago cancela primero la deuda; un crédito
   regalado nuevo **no** la cancela.
8. **Restricción**: el admin del comercio queda en Créditos y exportar; el POS sigue vendiendo,
   sincronizando y pidiendo `account-holds`. Root y soporte impersonando **no** quedan restringidos
   (ven una franja).
9. **El pagado es de la persona**: cambiar el titular no mueve saldo. Con varios comercios de un
   titular, solo se restringe el que debe.
10. **Plataforma mínima**: lo de un comercio, en su Créditos (root y soporte impersonando ven
    "Acciones de plataforma"); lo global, en una vista "Plataforma" con Cobranzas y Configuración. El
    panel completo es M7.
11. **El contrato no cambia**: `BackendNotice` alcanza. Lo que el POS haga distinto con un `critical`
    va como issue en offline-pos.

## Datos

### Migración de sistema v5 `creditos-y-cobro`

`src/server/db/migrations/system/v5-creditos-y-cobro.ts` (la carpeta `system/` es nueva; `system.ts`
pasa a listarla):

- **`registers`**: `id`, `tenant_id` (FK con cascade), `name`, `branch`, `point_of_sale`,
  `device_id` (nulo hasta ligarse), `bound_at`, `last_seen_at` (la última vez que se vio el equipo
  ligado), `active` y `created_at`.
- **`tenant_api_keys.register_id`**: cada key existente genera su caja, con su nombre, sucursal y
  punto de venta, activa si la key lo está. Sin equipo ligado.
- **`register_devices`**: `register_id`, `device_id`, `first_seen_at`, `last_seen_at`; PK
  `(register_id, device_id)`.
- **`tenants.holder_user_id`** y **`tenants.grace_until`**: el titular se llena con el owner activo
  más antiguo; los tenants de `demo_sessions` quedan sin titular.
- **`billing_settings`** (`key`, `value` JSON, `updated_by`, `updated_at`): vacía; los valores por
  defecto viven en código (`src/server/billing/settings.ts`).
- **`paid_movements`**: `id`, `user_id`, `kind` (`payment`, `charge`, `debt-settlement`, `refund`),
  `amount` (con signo), `tenant_id`, `charge_id`, `payment_ref` (único, nulo salvo en la planilla),
  `day` (fecha del pago o del cargo), `info`, `created_by`, `created_at`. Índice por `user_id`.
- **`gift_credits`**: `id`, `tenant_id`, `amount`, `expires_at`, `origin` (`signup`, `grant`),
  `granted_by`, `reason`, `voided_at`, `voided_by`, `void_reason`, `created_at`.
- **`gift_consumptions`**: `charge_id`, `credit_id`, `amount`.
- **`charges`**: `id`, `tenant_id`, `register_id`, `device_id` (`''` = el de la caja), `day`,
  `amount`, `paid_amount`, `gift_amount`, `debt_amount`, `debt_settled_at`, `rule` (JSON), `created_at`;
  `UNIQUE (register_id, device_id, day)` e índice `(tenant_id, day)`.
- **Bono a los comercios existentes** (con titular): un `gift_credits` `signup` de 50.000 que vence
  a los 90 días del momento de la migración (constantes del código de la migración).
- **Test** (`test/system-migration-v5.test.ts`): desde una base v4 con usuarios, comercios con varios
  owners, una demo, keys activas y revocadas. Verifica cajas, titular, bono y que los datos de v4
  sobreviven.

### Migración de comercio v6 `caja-de-venta`

`src/server/db/migrations/tenant/v6-caja-de-venta.ts`: `sales.register_id TEXT` y
`sales.charge_device TEXT` (a qué equipo se cobró la venta al recibirla: `''` = la caja, si no el
equipo ajeno; así el barrido no confunde un equipo que después pasó a ser el ligado), nulos en las
ventas anteriores, e índice `(register_id, charge_device, day)`. Test desde una base v5 con ventas.

### Escritura

`DocumentOrigin` suma `registerId: string | null` y `chargeDevice: string | null`. El push los
completa con la caja de la key y el resultado del ligado; `saveSale` los guarda (en el `ON CONFLICT`
no se pisan si ya estaban). La cobranza del
admin y la semilla lo dejan nulo.

## Cajas (`src/server/registers/`)

`RegisterService` (de sistema, contenedor raíz):

- `create({ tenantId, name, branch, pointOfSale })` → caja + key (reemplaza a
  `ApiKeyService.createApiKey` para el admin; el alta y las demos también crean una caja).
- `rotateKey(registerId)`: key nueva, revoca la anterior.
- `seen(registerId, deviceId, at)`: liga si no hay equipo; si es otro, actualiza `register_devices`.
  Devuelve `'bound' | 'foreign'`.
- `transferTo(registerId, deviceId)`, `unbind(registerId)`, `deactivate(registerId)` (revoca keys).
- `list(tenantId)`: con equipo, `lastSeenAt`, prefijo de la key activa y otros equipos vistos.

`validateApiKey` devuelve además `registerId`. Las rutas del Connector llaman a `seen` en el push y en
el pull con `deviceId`. Un `deviceId` vacío no liga.

Todo cambio de caja queda en `audit_log`.

## Cobro (`src/server/billing/`)

`BillingService` (de sistema), con reloj inyectable (`clockDef`):

- `charge(tenantId, registerId, deviceId, days[])`: por cada día, en orden y en una transacción de
  sistema, si no existe el cargo `(registerId, deviceId | '', day)`, lo crea con el reparto de la
  decisión 6 (pura, en `allocation.ts`). `deviceId` es `''` si es el equipo ligado o si no se
  identifica.
- `state(tenantId, today)`: saldo pagado del titular, regalados vigentes del comercio, deuda, fecha
  límite, días cubiertos y `state` (`ok` | `low` | `debt` | `restricted`).
- `registerPayment`, `grantCredits`, `voidCredit`, `setGrace`, `refund`, `setHolder`, `settings`
  y `updateSettings`.
- Un pago: cancela la deuda de los comercios del titular, del cargo más antiguo al más nuevo
  (`debt-settlement`, partiendo un cargo cubierto a medias), y lo que sobra queda de saldo.

**Cuándo nace el cargo**: la ruta del push, después de `processPushLot`, pide a la base del comercio
los días con ventas no anulación de ese lote (`register_id`, `device_id`, `day`) y llama a `charge`.
`ConnectorService.processPushLot` devuelve esos días.

**Barrido** (`startBillingSweeper`, un timer propio al lado del de demos, al arrancar y cada 15
minutos): para cada comercio con titular, los `(register_id, charge_device, day)` de sus ventas no
anulación sin cargo → `charge`.

**Días cubiertos**: disponible (pagado del titular + regalados vigentes del comercio) ÷ (precio ×
cajas o equipos con cargos en los últimos 7 días, mínimo 1). `low` si es menor que el umbral (7).

### Configuración (`billing_settings`)

| Clave | Por defecto |
|---|---|
| `pricePerRegisterDay` | 1000 |
| `signupBonus` | 50000 |
| `signupBonusDays` | 90 |
| `paidShare` | 0.5 |
| `graceDays` | 10 |
| `lowBalanceDays` | 7 |
| `paymentAlias`, `paymentCbu`, `paymentHolder` | vacío |
| `supportWhatsapp` | vacío |

## Avisos

`noticesFor(db, { deviceId, billing, register })` suma, a los de discrepancias:

| id | Cuándo | Severidad | Mensaje | A quién |
|---|---|---|---|---|
| `credits:low` | Cubre menos de 7 días | `warning` | "Te quedan créditos para unos N días. Cargá saldo desde mini → Créditos." | Todos los equipos |
| `credits:debt` | Deuda dentro de la gracia | `critical` | "mini contax: sin créditos, debés $X. Pagá antes del DD/MM para que mini siga funcionando. El POS sigue vendiendo." | Todos |
| `credits:restricted` | Pasó la gracia | `critical` | "mini contax está restringido por deuda de $X. El POS sigue vendiendo y sincronizando. Pagá desde mini → Créditos." | Todos |
| `register:foreign-device` | El equipo no es el ligado | `warning` | "Esta caja está ligada a otro equipo: tus ventas se cobran aparte. Pedile al dueño que te pase la caja o te cree una." | Ese equipo |
| `register:shared-key` | Otro equipo usó la key en los últimos 7 días | `warning` | "Otro equipo está usando la key de esta caja." | El ligado |

Los tres de créditos son excluyentes. Las demos no tienen avisos de créditos. Los importes van en
pesos argentinos con formato fijo del servidor (`$ 12.345`) y la fecha como `DD/MM`.

## API

### Del comercio (`/api/tenants/:tenantId`)

Capacidad nueva `credits.view` (owner, admin) en `src/shared/permissions.ts`.

| Ruta | Capacidad | Devuelve |
|---|---|---|
| `GET /credits` | `credits.view` | Estado, saldo pagado, regalados vigentes, deuda, fecha límite, días cubiertos, titular y "Cómo pagar" |
| `GET /credits/charges` | `credits.view` | Cargos paginados con `from`/`to`: día, caja (u "otro equipo"), importe y reparto. Totales del filtro |
| `GET /credits/movements` | `credits.view` | Pagos, devoluciones y créditos otorgados o anulados del comercio |
| `GET /credits/gifts` | `credits.view` | Regalados con origen, quién, motivo, vencimiento y remanente |
| `GET /billing-status` | `tenant.use` | `{ state, debt, deadline }` para la franja |
| `GET /pos-registers` | `settings.manage` | Cajas (sección "Cajas"); `/registers` ya es la lista de cajas de Ventas & Caja (M4) |
| `POST /pos-registers` | `settings.manage` | Crea caja y devuelve la key una vez |
| `POST /pos-registers/:id/rotate-key` | `settings.manage` | Key nueva, una vez |
| `POST /pos-registers/:id/transfer` | `settings.manage` | `{ deviceId }` de un equipo visto |
| `POST /pos-registers/:id/unbind`, `DELETE /pos-registers/:id` | `settings.manage` | Desligar y desactivar |

`/api-keys` se va (lo usa solo el cliente).

### Restricción

Middleware `requireBillingOk` después de `requireTenantContext`: si el comercio está `restricted` y el
rol no es de impersonación, `402 { code: 'billing-restricted', debt, deadline }`, salvo `/credits*`,
`/billing-status` y `/export/*`. Un test recorre la tabla de permisos y verifica cuáles quedan
abiertas.

### De plataforma (`/api/platform`)

Middleware `requirePlatformRole(...roles)`. Todo queda en `audit_log`.

| Ruta | Rol |
|---|---|
| `POST /tenants/:id/payments` (`{ day, amount, info? }`) | root, soporte |
| `POST /tenants/:id/gift-credits` (`{ amount, expiresAt, reason? }`) | root, soporte |
| `DELETE /tenants/:id/gift-credits/:creditId` (`{ reason }`) | root, soporte |
| `POST /tenants/:id/grace` (`{ until }`) | root, soporte |
| `POST /tenants/:id/refunds` (`{ amount, info? }`; ≤ saldo) | root |
| `PUT /tenants/:id/holder` (`{ userId }`, owner activo) | root, soporte |
| `POST /payments/import[?dryRun=1]` (JSON `{ csv }`) | root, soporte |
| `GET /payments` | root, soporte |
| `GET /settings` / `PUT /settings` | root y soporte / root |

**Planilla**: columnas `fecha`, `comercio` (slug), `importe`, `info`; detecta `;` o `,` y la coma
decimal. Cada fila: `ok`, `duplicate` (su sha256 normalizado ya está en `payment_ref`) o `error` con
el motivo. Las filas son independientes.

## Pantallas

- **Créditos** (owner y admin): tarjetas (saldo pagado con la promesa de devolución, regalados con el
  próximo vencimiento, deuda y fecha límite, días cubiertos); "Cómo pagar" (alias o CBU con copiar,
  titular, botón a `wa.me` con el mensaje armado); solapas Consumo, Movimientos y Regalados. Root y
  soporte impersonando ven la barra "Acciones de plataforma" con sus modales.
- **Franja** (`CreditsBanner`, en el shell): `low`, `debt` o `restricted`, con link a Créditos; a un
  member, solo "avisale al dueño". Impersonando, "Comercio restringido por deuda".
- **Pantalla restringida**: reemplaza a las vistas bloqueadas (por estado o por un `402`).
- **Configuración → Cajas**: reemplaza a la solapa de keys, con las acciones de la sección "Cajas".
- **Plataforma** (root y soporte): solapas Cobranzas (planilla con vista previa, resultado por fila y
  lista de pagos) y Configuración (solo root).
- **Alta**: bono y titular; la promesa de devolución en el formulario.
- Fechas e importes con `src/client/format.ts` (#51).

## Casos de borde

| Caso | Comportamiento |
|---|---|
| Venta offline sincronizada al día siguiente | Cobra en su `day` |
| Lote repetido | Sin cargos dobles (`UNIQUE`) |
| Lote con varios días | Un cargo por día, en orden |
| Solo anulaciones en el día | Sin cargo |
| Venta sin `deviceId` utilizable | Cargo de la caja |
| Caída entre el commit y el cargo | Lo crea el barrido |
| Cambio de precio o proporción | Solo los cargos nuevos |
| Crédito vencido con remanente | No cuenta; se ve "vencido" |
| Demo | Sin cargos ni avisos de créditos |
| Comercio sin titular | No cobra y lo loguea |
| Planilla con slug inexistente, fecha inválida o importe ≤ 0 | Error en esa fila |
| Devolución mayor que el saldo | `400` |
| Titular nuevo que no es owner activo | `400` |

## Pruebas

- **Vitest con TDD**: migraciones (sistema v5, comercio v6, con datos); `allocation` con su tabla de
  casos; cargos, deuda, gracia, pago que cancela, estado y días cubiertos con reloj fijo; ligado y
  transferencia de caja; avisos; restricción; permisos y plataforma; planilla; alta con bono.
- **e2e** (`pnpm test:e2e`): ventas por push en dos cajas, dos cargos en Créditos y el aviso del otro
  equipo en el pull.
- Antes de cada commit: `pnpm lint && pnpm typecheck && pnpm test`, más `pnpm build` si se toca el
  cliente.

## Etapas

1. Migraciones de sistema v5 y de comercio v6.
2. Cajas: servicio, ligado en push y pull, `register_id` y `charge_device` en `records.ts`, rutas `/pos-registers`.
3. `BillingService`: reparto, cargo después del push, deuda, gracia, estado y barrido.
4. Pagos, otorgamientos, devoluciones, gracia, titular y configuración (rutas de plataforma con
   auditoría); bono en el alta.
5. Planilla CSV.
6. Avisos, restricción y rutas de Créditos (`credits.view`).
7. Cliente: Cajas.
8. Cliente: Créditos, franja y pantalla restringida.
9. Cliente: acciones de plataforma y vista Plataforma.
10. e2e, AGENTS.md, corrección de la spec del MVP, issue en offline-pos, 0.7.0 e informe con la
    prueba manual en checklist.

## Afuera de M5

- Panel de plataforma con comercios y usuarios (M7).
- Mercado Pago, regalos automáticos por escala y cortar el procesamiento por deuda (backlog del MVP).
- Cómo el POS destaca un `critical` (issue en offline-pos).
