# M8 · Demos v2: un comercio por rubro, una caja por visitante y reinicios (#24)

Etapa M8 del MVP (epic #17). Parte de la spec del MVP (`2026-10-01-mvp-mini-contax-design.md`,
"Demos" y "Accesos anónimos") y reemplaza el tenant por visitante de #9
(`2026-09-30-demo-y-alta-pos-publicado-design.md`). Adelanta de M10 (#26) la capacidad `portal` y
el canje de su link: el POS publicado ya la usa (rauldiazsolis/offline-pos#179, P6).

## Contexto

- Hoy cada `POST /connector/demo-sessions` crea un tenant `demo-xxxx` sin dueño, sembrado con el
  catálogo del rubro y sin historial. `demo_sessions` (una fila por tenant) es a la vez **la marca
  de "esto es demo"** (la usan cobro, plataforma, suspensión, impersonación, backup y la planilla
  con `NOT IN (SELECT tenant_id FROM demo_sessions)`) y **el registro de vencimiento**. El barrido
  borra el tenant a las `DEMO_TTL_HOURS` del último uso.
- Desde el contrato 4.5.0 el backend puede **revocar** una demo cuando quiera: `401` a todo pedido
  con su key, y el POS en demo lo toma como "la demo terminó" y ofrece otro `POST /demo-sessions`
  con la misma plantilla (comentarios de #24). Una key inactiva ya da `401` (`validateApiKey`).
- El POS solo abre dos URL del backend: `onboarding.url` (el botón `/ALTA`) y, con la capacidad
  `portal` (4.6.0), la que devuelve `POST /portal-links`. El POS publicado en `/v4/` ya implementa
  el portal.
- Una sesión del admin exige un usuario (`sessions` JOIN `users`) y el rol sale de la membresía.
- El contrato no cambia: implementamos 4.6.0.

## Decisiones

| Tema | Decisión |
|---|---|
| Demos por visitante vivas al deployar | Se borran al arrancar: sus keys dan `401`, el POS ofrece una demo nueva y el visitante cae en el comercio fijo. |
| Foto inicial | No hay archivo: el reinicio total vacía el comercio y vuelve a correr la semilla con fechas relativas a ese momento. |
| Reinicio parcial | Productos, stock y clientes como la semilla; conserva ventas, cobranzas, caja, saldos, cajas y sesiones. |
| Reposición de stock | En el barrido de 15 minutos, con un movimiento en el kardex. |
| Registro de sesiones | Solo lo de la demo (rubro, caja, fechas, revocación). Nada del visitante: ni IP ni navegador. |
| Acceso anónimo | Una tabla propia de sesiones anónimas, no un usuario sintético. Se abre desde el POS con el portal. |
| Portal | Adelantado de M10: declarado siempre. Key de demo: link de un uso y 60 s al admin anónimo. Key real: el login de mini. |
| Reinicio automático | A las `DEMO_RESET_HOUR` (4 por defecto) hora argentina, desde el barrido. |
| Botones | Solapa Demos de `/plataforma`, para root y soporte. |
| Landing | Sin cambios: el acceso anónimo nace de una caja del POS. |

## Modelo de datos (migración de sistema v9)

- **`demo_tenants`**: `tenant_id` PK, `template` único (`kiosco`, `almacen`, `ferreteria`),
  `last_full_reset_at`, `last_partial_reset_at` (nullable). Es la marca de comercio demo: todos los
  `NOT IN (SELECT tenant_id FROM demo_sessions)` pasan a `demo_tenants`.
- **`demo_sessions`** (nueva forma): `id` PK (aleatorio, el futuro id de visitante de M9),
  `template`, `tenant_id`, `register_id`, `created_at`, `last_used_at`, `revoked_at`,
  `revoke_reason` (`reset`, `idle` o `legacy`). **Nunca se borra**: vive en `system.sqlite`, fuera
  del comercio, y sobrevive a los reinicios.
- **`legacy_demo_sessions`**: la `demo_sessions` de hoy, renombrada. La migración no borra archivos;
  el barrido borra esos tenants con `TenantManager.deleteTenant` y vacía la tabla. Se elimina en una
  migración futura.
- **`anonymous_sessions`**: `token_hash` PK (sha256), `tenant_id`, `register_id`,
  `demo_session_id`, `created_at`, `last_used_at`.
- **`portal_links`**: `token_hash` PK (sha256), `tenant_id`, `register_id`, `created_at`,
  `expires_at`, `used_at`.
- La base del comercio no cambia: el reinicio vacía y vuelve a sembrar las tablas que ya existen.

## Comercios demo

- Tres comercios fijos, `demo-kiosco`, `demo-almacen` y `demo-ferreteria` (slug igual al id), con los
  nombres "Kiosco Demo", "Almacén Demo" y "Ferretería Demo" (los muestra el POS con
  `company.name`). Una sucursal, `CENTRAL`. Sin dueño ni titular.
- `ensureDemoTenants` los crea en el arranque si faltan y las demos están prendidas, **también en
  producción** (son parte del producto, no del seed de desarrollo), y anota `last_full_reset_at`.
- **Semilla** (`src/server/seeds/`), una función del comercio demo con `now`:
  - el catálogo del rubro con **ids deterministas** (`demo_<sku>`), para que el reinicio parcial
    reconozca los productos de la semilla;
  - los clientes demo con ids fijos y su saldo inicial;
  - 30 días de historial hasta `now` de dos cajas "de la casa" (`Caja 1` y `Caja 2`, sin
    `register_id`), con el generador del seed de desarrollo.
- Nunca cobran: `BillingService.charge` y el barrido de cobro los excluyen explícitamente, no por no
  tener titular. Sin avisos de créditos. Fuera de Comercios, Usuarios, impersonación y backup.

## Reinicios

**Total** (un rubro o todos), sincrónico, así ningún push queda en el medio:

1. En el comercio, en una transacción: vacía **todas** las tablas (salen de `sqlite_master`, así
   una tabla nueva no se escapa) y vuelve a sembrar con `now`.
2. En el sistema, en otra transacción:
   - revoca las cajas de visitante del comercio (caja y key con `active = 0`);
   - marca sus `demo_sessions` con `revoked_at` y `revoke_reason = 'reset'`;
   - borra sus `anonymous_sessions` y `portal_links`;
   - anota `last_full_reset_at`.

**Parcial**, en una transacción, con `updated_at = now` en todo lo que toca (así viaja en el pull por
delta):

- **Productos**: los de la semilla vuelven a su nombre, precio, códigos, categoría, IVA y sin
  bloqueo, y se crean si faltan. Los creados por visitantes se borran. El POS se entera de esa baja
  en su próximo pull completo (sin cursor); hasta entonces puede seguir mostrándolos.
- **Stock**: cada producto de la semilla vuelve a la cantidad de la semilla, con un movimiento
  `inventory_count` en el kardex (`stock/write-stock.ts`).
- **Clientes**: los de la semilla vuelven a sus datos (nombre, documento, teléfono, límite, margen,
  sin restricción y sin bloqueo) y se crean si faltan. Conservan saldo y libro, que salen de las
  ventas que se conservan. Los creados por visitantes sin movimientos en el libro se borran; con
  movimientos, quedan.
- **Discrepancias** abiertas: descartadas.
- Ventas, cobranzas, movimientos de caja, cajas, sesiones y accesos anónimos quedan. Anota
  `last_partial_reset_at`.

## Barrido de demos

El de hoy (`startDemoSweeper`, al arrancar y cada 15 minutos), ampliado. En orden:

1. Borra los tenants de `legacy_demo_sessions`.
2. **Reinicio automático**: reinicia (total) cada rubro cuyo `last_full_reset_at` sea anterior a las
   `DEMO_RESET_HOUR` hora argentina (UTC−3 fijo) más recientes. Si el servidor estuvo caído a esa
   hora, lo hace al arrancar. Reloj inyectable.
3. **Cajas inactivas**: revoca las cajas de visitante sin uso por `DEMO_TTL_HOURS`
   (`revoke_reason = 'idle'`).
4. **Reposición**: cada producto de la semilla con stock por debajo de un cuarto de su cantidad
   inicial vuelve a esa cantidad, con un movimiento en el kardex ("Reposición automática").

Loguea `[demos] …` al arrancar y cada vez que hace algo.

## Cajas de visitante

- `POST /connector/demo-sessions` mantiene la validación de `template`, el `429`, el
  `503 demo-capacity` y la forma de la respuesta. Crea en el comercio del rubro una **caja de
  visitante** (sucursal `CENTRAL`, punto de venta `Demo XXXX` con 4 caracteres del id, para que
  cada visitante sea una caja aparte en Ventas & Caja), su key y la fila de `demo_sessions`.
  `onboarding` no cambia (`/alta?template=…`).
- **Uso**: cada pedido con una key de demo corre `last_used_at` de su sesión (a lo sumo una vez por
  minuto); el uso de un acceso anónimo de esa caja también.
- **Revocada** (reinicio total o inactividad): caja y key con `active = 0`, `401` a todo pedido. Es
  lo que el POS toma como "la demo terminó".
- **Tope**: `DEMO_MAX_ACTIVE` cuenta las cajas de visitante activas en total.
- **Desarrollo**: `DEV_DEMOS` son cajas de visitante con key fija en los comercios demo; el arranque
  las vuelve a crear si un reinicio las revocó.

## Portal y acceso anónimo

**`GET /connector/info`** declara la capacidad `portal` con `portal: { command: 'MINI', label:
'Abrir mini' }`, con cualquier key.

**`POST /connector/portal-links`** (con key y versión del contrato, sin cuerpo):

- **Key de demo**: guarda un token aleatorio (en la base, su sha256) que vence en 60 s y sirve una
  vez, y devuelve `{ url: '<origen>/portal#t=<token>', expiresAt }`. El token va en el fragmento:
  no llega al servidor en la carga de la página ni a sus logs.
- **Key real**: devuelve `{ url: '<origen>/admin/<slug>' }`. El cajero entra con su cuenta; sin
  acceso ve "No tenés acceso". M10 lo cambia por el link a "mi caja".
- El origen es `PUBLIC_URL` o el del pedido, como en `demo-sessions`.

**Canje**: `POST /api/portal/redeem { token }`, sin sesión, con el límite de login
(`AUTH_RATE_LIMIT`). Con un token vigente, sin usar y con la caja activa, lo marca usado, crea una
`anonymous_session` y devuelve su token, el comercio (id, slug y nombre), el punto de venta y el
rubro. Si no, **410** "Este link venció: volvé a abrir mini desde el POS".

**La sesión anónima**:

- `createAdminAuthMiddleware` resuelve una sesión de usuario **o** una anónima. Con una anónima no
  hay `req.user`: hay `req.anonymous` (`{ tenantId, registerId, demoSessionId }`).
- `requireTenantContext` le da el rol `admin` solo en su comercio (en otro, 403). Las capacidades
  se restan en un solo lugar de `src/shared/permissions.ts`: sin `users.manage`, `owners.manage`,
  `credits.view` ni `settings.manage`. Sin esta última, porque un visitante podría rotar o
  desactivar las cajas de los otros o renombrar el comercio, y el reinicio parcial no lo deshace.
  Le quedan catálogo, stock, clientes, ventas, dashboard, importación y Apariencia.
- Las rutas que piden usuario (`/api/me`, contraseña, alta, invitaciones, crear comercio,
  plataforma, pedir ayuda) dan 401: nunca crean comercios, ni invitan, ni ven usuarios o créditos.
- Vale mientras su caja esté activa; si no, 401 y se borra. Su uso corre el de la demo.
- Los permisos del acceso anónimo tienen su tabla en los tests, como `permissions-api.test.ts`.

**Cliente**:

- `/portal` lee `#t=`, canjea, guarda la sesión en `sessionStorage` (solo `auth-state` la toca, como
  la impersonación; nunca escribe `localStorage`) y va a `/admin/<slug>/ventas?caja=Demo%20XXXX`.
- Una franja fija: "Demo de mini contax: lo que cambies lo ven los demás visitantes", con "Crear mi
  comercio" (`/alta?template=<rubro>`). Sin selector de comercios, menú de usuario ni "Pedir
  ayuda"; el menú esconde lo que el acceso no puede (`canDo`).
- Un 401 muestra "Esta demo terminó. Abrí una nueva desde el POS", con "Crear mi comercio".

## Plataforma

- Solapa **Demos** (`/plataforma/demos`), para root y soporte: por rubro, cajas de visitante
  activas, demos creadas hoy, ventas de hoy y últimos reinicios total y parcial. Botones "Reinicio
  parcial" y "Reinicio total" por rubro y "Reiniciar todas" (total), con confirmación que dice qué
  hace ("revoca N cajas de visitantes").
- Rutas `GET /api/platform/demos` y `POST /api/platform/demos/reset { template?, kind: 'full' |
  'partial' }`, con `requirePlatformRole('root', 'support')`, en la tabla de
  `test/platform-permissions.test.ts`.
- Auditoría `demo.reset` con `auditActor(req)`, el rubro y el tipo; el automático, sin actor.

## Variables

| Variable | Por defecto | Qué es |
|---|---|---|
| `DEMO_SESSIONS` | prendidas | `off` apaga demos, comercios demo y barrido de demos. |
| `DEMO_TTL_HOURS` | 24 | Horas sin uso hasta revocar una caja de visitante. |
| `DEMO_MAX_ACTIVE` | 200 | Cajas de visitante activas en total (`503 demo-capacity`). |
| `DEMO_RATE_LIMIT` | 10 | Demos por hora y por IP (`429`). |
| `DEMO_RESET_HOUR` | 4 | Hora argentina (0 a 23) del reinicio total automático. |

## Pruebas

- Servicios: semilla determinista; reinicio total (todas las tablas vacías y resembradas, cajas
  revocadas, sesiones marcadas); reinicio parcial (cada regla de arriba); barrido (hora argentina con
  reloj inyectable, inactividad, reposición, legacy); tope; portal (vence, un solo uso, caja
  revocada, key real).
- Migración de sistema v9 con datos (`createDbAtVersion`): las demos de antes quedan en
  `legacy_demo_sessions`.
- Permisos del acceso anónimo y tablas de rutas de comercio y de plataforma.
- Connector API: `/info` con `portal`, `/portal-links`, `401` después de revocar.
- **e2e del criterio de aceptación** (dos contextos de navegador, el POS local):
  1. A y B abren la demo del kiosco y venden.
  2. A abre `/MINI` y en Ventas & Caja ve la venta de B.
  3. A cambia un precio; root hace un reinicio parcial desde `/plataforma/demos`; el precio vuelve y
     A sigue vendiendo y sincronizando.
  4. Root hace un reinicio total: el siguiente sync de A da `401` y el POS ofrece empezar una demo
     nueva.
- El e2e del alta se adapta: la venta de práctica queda en `demo-kiosco`.

## Afuera

- Eventos, embudo e id de visitante viajando al alta (M9, #25).
- El acceso `member` limitado a su caja y la vista "mi caja" para comercios reales (M10, #26).
- Abrir el admin de la demo desde el landing.
- Auditar lo que el visitante cambia en catálogo, stock o clientes (hoy no se audita para nadie).
