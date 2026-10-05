# AGENTS.md

Reglas para trabajar en este repo. Cada decisión nueva de arquitectura o de convención se anota acá
en el mismo trabajo que la toma. La historia de las fases está en [`PLAN.md`](./PLAN.md).

## Qué es esto

`mini-erp` es un backend multitenant (Express + SQLite) con un admin web (Preact) que implementa el
**Connector API** de [offline-pos](https://github.com/rauldiazsolis/offline-pos), un POS web
offline-first. Es **un backend más** de los que usan el POS: el POS no lo conoce ni tiene código para
él. Hasta el 2026-09-29 vivía en `mini-erp/` dentro de offline-pos (epic
rauldiazsolis/offline-pos#161); la historia de esa carpeta se conservó al mudarlo.

## Relación con offline-pos y el contrato

- El contrato lo define y lo publica offline-pos. **Acá nunca se cambia**: si el mini-erp necesita
  algo del contrato, se abre un issue en offline-pos.
- **El POS se publica en un canal por major del contrato** (#58): `https://pos.contax.ar/v4/` tiene
  siempre el último POS que habla el contrato 4.x (es una PWA: el service worker le lleva las
  versiones nuevas a las terminales). Ya no hay carpetas por versión (`/0.1.0/`).
- **Contrato publicado**: la copia en `docs/connector-api.openapi.yaml`, con su procedencia en
  `contract.json` (el canal y qué POS había al bajarla; ningún código lee esa versión). Hoy: canal
  `v4`, POS `0.4.0`, contrato **4.6.0**, piso **4.0.0**.
- **Contrato implementado**: **4.6.0** (#2, #58, #63), en `src/shared/contract-version.ts`
  (`CONTRACT_VERSION`; de su major salen el `409` y el canal del POS, `POS_CHANNEL`). `GET /info`
  dice `4.6.0`, manda `company.name` (el nombre del comercio de la key; no va en mantenimiento ni
  con el nombre vacío) y declara las capacidades `customer-payment-void` (siempre: la anulación de
  una cobranza es otra cobranza, en negativo) y `demo-sessions` (si las demos están prendidas:
  `POST /connector/demo-sessions` y la vuelta del onboarding con `#connect` desde `/alta`, #9) y
  `portal` con `{ command: 'MINI', label: 'Abrir mini' }` (con cualquier key: una caja real abre "mi
  caja" de solo consulta y una demo, el admin del comercio demo; #24 y M10, #26). El pull manda `notices` y el backend cumple las reglas de evolución (tests en
  `test/contract-evolution.test.ts`). La revocación activa de demos está hecha (#24): una caja de
  visitante revocada (reinicio total o `DEMO_TTL_HOURS` sin uso) da `401` a todo, el POS lo toma
  como "la demo terminó" y puede ir igual al alta.
- **Errores del Connector API** (4.6.0, #63): los `429` y `503` mandan `ErrorBody`
  (`{ code, message? }`: `rate-limited`, `demo-capacity`, `maintenance`), con `Retry-After` en
  segundos. En `/api` el texto sigue en `error`, que es donde lo lee el admin.
- **Actualizar la copia**: `pnpm contract:update [canal]`. Siempre del canal publicado
  (`https://pos.contax.ar/<canal>/`, por defecto el del major implementado; otro, como `v5`, para
  preparar una migración), nunca de `main` de offline-pos. El diff del OpenAPI muestra qué cambió;
  implementarlo es trabajo aparte, con su issue.
- La guía para integradores está publicada junto al OpenAPI (`https://pos.contax.ar/v4/docs/`).

## Cómo trabajamos

Las mismas convenciones que offline-pos. Valen para cualquier agente (en este repo se trabaja con
Claude Code y con Antigravity IDE); donde un agente hace algo distinto, se dice.

- **Idioma**: todo en español (respuestas, specs, planes, commits, comentarios e issues), aunque el
  pedido o las instrucciones de una herramienta vengan en inglés.
- **Plan antes de codear**: un trabajo de varios pasos arranca con un brainstorming (opciones,
  impacto en la arquitectura, casos de borde, etapas verificables con su criterio de aceptación) y un
  plan que el usuario revisa y aprueba. Nada de código antes de esa aprobación. El plan se ejecuta
  **tarea por tarea**, en la misma conversación: al terminar cada tarea se verifica y se frena para
  que el usuario la revise antes de seguir (en Claude Code, con `superpowers:executing-plans`; nunca
  un subagente por tarea). Specs y planes en `docs/superpowers/`. **El plan se borra en el PR que
  cierra la etapa** (queda en el historial de git); la spec queda, porque explica las decisiones.
- **Informe final con prueba manual**: al terminar, un informe con instrucciones paso a paso de qué
  hacer en la UI (o con `curl`) y qué se debería ver. La prueba la hace el usuario.
- **Revisión sin cambios**: en una revisión no se toca código salvo pedido explícito en el momento; las
  observaciones se anotan como issues. Contestar una pregunta de alcance no es la luz verde para
  implementar: esa es aparte y explícita.
- **Ramas y PR**: cada etapa en su rama (`claude/<tema>`, `antigravity/<tema>`, etc.), con commits
  chicos verificados localmente. El PR se abre al terminar la etapa, después de la revisión, y se
  mergea con **merge commit**, nunca squash.
- **Quién commitea depende del agente**:
  - **Antigravity IDE: el agente nunca ejecuta `git commit` ni `git push`** (tampoco abre ni mergea
    PR). Al terminar cada tarea verificada, se detiene y sugiere el commit: el comando con el
    mensaje convencional y la lista exacta de archivos. El usuario commitea.
  - **Claude Code**: commitea en la rama de la etapa y abre el PR cuando el usuario lo aprueba.
- **CI**: después de un push no se espera ni se lee el CI; alcanzan los chequeos locales. Si el CI
  falla, el usuario avisa.
- **Issues en GitHub**, nunca en un markdown del repo. "Anotá: …" crea un issue y se sigue con lo que
  se estaba haciendo. Etiquetas `feature:<slug>` (`feature:contrato`, `feature:publicacion`,
  `feature:transversal`, y las que hagan falta) y `backlog` (se prioriza después de lo ya diseñado).
  El cuerpo alcanza para arrancar una sesión nueva sin más contexto.
- **El agente mantiene los issues** (el usuario no los edita a mano): en el cuerpo del PR va
  "Closes #N" (GitHub no reconoce "Cierra"); después del merge se verifica que se haya cerrado.
- **Dependencias**: con opciones equivalentes, la que tenga menos dependencias propias
  (`npm view <paquete> dependencies`).
- **Commits**: mensajes convencionales en español (`feat:`, `fix:`, `docs:`, `build:`, `ci:`,
  `test:`, `refactor:`).

## Verificación

Todo cambio de comportamiento lleva tests de Vitest en `test/`, escritos **antes** que el código
(TDD): el test falla, se implementa lo mínimo para que pase y se vuelve a correr la suite. Una tarea
no está terminada sin `typecheck` con 0 errores y todos los tests en verde:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Y `pnpm build` si se toca el cliente o la config de Vite. Todo en verde antes de cada commit. En
Windows, pnpm se corre desde PowerShell.

Si se toca el recorrido de la demo, el alta o el Connector API, también el e2e (Playwright, en
`e2e/`): `pnpm test:e2e`. Levanta el mini-erp en el puerto 4110 con `DATA_DIR=test-results/e2e-data`
(base descartable; nunca la de desarrollo) y corre en el CI.

## Convenciones de TypeScript y Node

- **TypeScript estricto**: `any` prohibido; `unknown` solo en fronteras externas (payloads HTTP) y
  validado con Zod en la línea siguiente.
- **Node 24 sin compilar** (strip de tipos): `pnpm dev` y `pnpm start` corren `.ts` directo.
  - Sin "parameter properties" en constructores (`constructor(private db: DatabaseSync)` no se puede
    stripear); la propiedad se declara en el cuerpo de la clase:
    ```typescript
    class MiServicio {
      private db: DatabaseSync;
      constructor(db: DatabaseSync) {
        this.db = db;
      }
    }
    ```
  - Imports relativos con extensión (`.ts`, `.tsx`): `allowImportingTsExtensions` + `noEmit`.
  - `--watch-path=src/server` en desarrollo: un `--watch` global reinicia en bucle con cada escritura
    en SQLite (`data/`) o en `dist/`.
- **UI (Preact)**: tipar con `JSX.IntrinsicElements['button']`, `JSX.TargetedEvent`, etc.; nada de
  tipos laxos.
- **TypeScript 6** con `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`, `noUnusedParameters` y `erasableSyntaxOnly` (el compilador rechaza la sintaxis
  que Node no puede stripear: parameter properties, `enum`, `namespace`).
- **Opcionales con `exactOptionalPropertyTypes`**: las entradas de servicios (lo que llega de Zod o
  de la URL, props de componentes) se tipan `x?: T | undefined`, porque Zod infiere así (también
  Zod 4) y el servicio ya trata `undefined` como ausente; en los resultados que arma el propio
  código, la propiedad se omite si no hay valor (`...(x === undefined ? {} : { x })`). Nunca `as`
  ni `!` para callar el error.
- **Zod 4 siempre desde `src/shared/zod.ts`** (#6): configura `z.locales.es()` (los mensajes por
  defecto, en castellano) y reexporta `z`; el lint prohíbe importar `'zod'` directo. Los textos
  propios van con `error` (`z.enum(…, { error: '…' })`; para distinguir "falta" de "tipo
  equivocado", `error: (iss) => (iss.input === undefined ? … : …)`). Idioma configurable: #74;
  formularios del admin con los esquemas compartidos: #75.

## Arquitectura

- **DB por tenant** con `DatabaseSync` de `node:sqlite`:
  - `data/system.sqlite`: usuarios, tenants, membresías, roles globales (`root`, `support`, `user`),
    cajas con sus keys y todo el cobro (cargos, pagados, regalados, configuración).
  - `data/tenants/<tenantId>.sqlite`: catálogo, stock por sucursal, clientes, cuentas corrientes,
    ventas y lotes de sincronización.
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
    `test/helpers/`) y verifica que sobreviven (ejemplo: `test/tenant-migration-v2.test.ts`). Migra
    con el esquema cortado en su versión (`HASTA_VN`, como `test/system-migration-v9.test.ts`): así
    una migración posterior no lo rompe.
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
- **Auth propia**: sin servicios externos; `node:crypto` (`scryptSync`, comparación timing-safe). Las
  cuentas nacen siempre como `user`; el `root` sale de `AuthService.ensureRoot`, que usan el comando
  `scripts/create-root.ts` (una vez, en el servidor) y el seed de desarrollo. `root` y `support` no
  son miembros de ningún comercio (#16): entran impersonando a un usuario (#23).
- **Roles de comercio e invitaciones** (#19, spec `docs/superpowers/specs/2026-10-01-m2-roles-invitaciones-design.md`):
  - Matriz en `src/shared/permissions.ts` (TS puro, la usan servidor y cliente): roles `owner`,
    `admin`, `member` y capacidades `tenant.view` y `sales.view` (consultar el comercio y Ventas &
    Caja, M10), `tenant.use` (operar), `bulk`, `settings.manage`, `users.manage`, `owners.manage` y
    `credits.view`. Permisos fijos. Quien impersona opera con el rol del usuario.
  - `canAs(rol, capacidad, acceso)` resta según el tipo de acceso (`user`, `demo` o `register`; ver
    "Portal y acceso anónimo").
  - `requireTenantContext` resuelve el rol (`MembershipService.resolveRole`, solo membresías
    activas) y **cada** ruta de `/api/tenants/:tenantId` lleva `requirePermission(<capacidad>)`.
    La tabla de todas las rutas está en `test/helpers/tenant-routes.ts`: `test/permissions-api.test.ts`
    falla si una ruta nueva no está o exige otra capacidad, y `test/anonymous-permissions.test.ts`
    la recorre con el acceso anónimo de una demo y con el de una caja real.
  - El cliente esconde lo que el rol no permite con `canDo` (`state/permissions-state.ts`).
  - **Sin registro suelto**: una cuenta nace en `POST /api/alta` (cuenta con WhatsApp, comercio vacío
    con su rubro y key de "Caja 1", atómico; #22) o aceptando una invitación.
  - Links de invitación y de restablecimiento de contraseña: un solo uso, 48 h, token en el fragmento
    (`/invitacion#t=…`, `/restablecer#t=…`), en la base solo su sha256. El restablecimiento lo genera
    el owner, solo para usuarios cuyas membresías activas son todas en comercios suyos.
  - Contraseña mínima de 8 caracteres para todos (`src/shared/password.ts`).
  - Auditoría en `audit_log` (`AuditLog`, de sistema): usuarios, roles, invitaciones y contraseñas.
    La ve el owner en Usuarios → Actividad.
  - Los errores de negocio son `DomainError` con su estado HTTP (`src/server/errors.ts`).
- **Arranque** en `src/server/bootstrap.ts`: con las demos prendidas, los comercios demo
  (`ensureDemoTenants`, **también en producción**); el barrido de demos siempre; el seed de desarrollo
  (`ensureDevData` en `db/dev-seed.ts`, datos en `seeds/dev-fixtures.ts`, todo en el repo) **solo
  fuera de `NODE_ENV=production`**:
  - Usuarios con contraseña `admin123`: `root@local.test` y `soporte@local.test` sin comercios,
    `dueno-a@local.test` (owner y titular de Kiosco y Almacén), `dueno-b@local.test` (de Ferretería),
    `admin-k@local.test` y `empleado-k@local.test` (admin y member del Kiosco).
  - Un comercio por rubro con el catálogo y los clientes de las demos, 30 días de ventas ligadas a su
    caja y un estado de créditos distinto (ok, saldo bajo, deuda en gracia), armado con las mismas
    operaciones de `BillingService`. Cada caja tiene una key fija; `mpos_dev_demo_key_12345` es la
    Caja 1 del Kiosco.
  - Dos cajas de demo con key fija (`DEV_DEMOS`: Kiosco y Almacén demo), que se vuelven a crear al
    arrancar si un reinicio o la inactividad las revocó.
  - Es idempotente y no borra nada: para sembrar de nuevo, se borra la carpeta de datos de desarrollo.
    El arranque lista usuarios y keys en el log.
- **Límite de pedidos por IP** (`src/server/middleware/rate-limit.ts`, ventana fija en memoria): 10
  demos por hora (`DEMO_RATE_LIMIT`) y 20 pedidos cada 15 minutos a login y registro
  (`AUTH_RATE_LIMIT`, contador compartido); `429` con `Retry-After` y el texto en `message` (Connector
  API) o en `error` (`/api`). Del embudo (#25): 5 contactos por hora (`CONTACT_RATE_LIMIT`, `429`) y 60
  beacons por hora (`BEACON_RATE_LIMIT`; pasado, `204` sin contar, la opción `silent`). `trust proxy` en `loopback`: detrás de Caddy, `req.ip` es la del
  cliente y `req.protocol`, `https`.
- **IoC con Hardwired 1.6.2** (versión exacta): servicios por request con
  `req.tenantScope.use(serviceDef)`; nunca `new Service()` para un servicio de tenant. La base del
  tenant es `unbound` (`tenantDbDef`): resolverla desde el contenedor raíz falla a propósito, para
  que no haya fugas entre tenants. Detalle en `src/server/di/container.ts` y la Fase 5 de `PLAN.md`.
- **Connector API** bajo `/connector`:
  - Push validado con Zod al aplicarse, en `src/server/connector/push-events.ts`: los siete tipos
    de evento validan lo que el mini-erp lee y dejan pasar el resto (`z.looseObject`); los enums
    abiertos del contrato (medio de pago, motivo de stock) son `string`. Un evento inválido, de tipo
    desconocido o que ni siquiera es un objeto queda como `issue` del lote (con su `eventId` si lo
    tiene), sin tumbar el resto.
  - **El backend nunca rechaza de forma síncrona el contenido de un lote**: responde `200` y reporta
    las inconsistencias como `issues` en el pull.
  - El push aplica cada lote en una transacción y cada evento en un `SAVEPOINT` (#2): un evento que
    tira un error se deshace solo y queda como `issue` con su `eventId`.
  - **Discrepancias** (`src/server/discrepancy/`, tabla `discrepancies`): lo que el push no puede
    aplicar o le parece raro, sin rechazar el lote. Un movimiento de un cliente desconocido queda
    pendiente y se aplica solo cuando el cliente aparece (evento `customer`, alta en el admin o
    importación). Una anulación de cobranza inconsistente se aplica igual y queda para revisar. En el
    admin se ven en Clientes y las descartan owner y admin, con motivo.
  - Los `notices` del pull se calculan en el momento (`src/server/notices/`): hoy, las discrepancias
    abiertas del equipo que las generó, los de créditos (`credits:low`, `credits:debt`,
    `credits:restricted`, excluyentes, nunca en demos) y los de caja (`register:foreign-device` al
    equipo que no es el ligado, `register:shared-key` al ligado).
  - `X-POS-Contract-Version`: `409 IncompatibleContract` si el major difiere (salvo en `/info`).
  - CORS `*` (sin cookies: el admin y el POS usan Bearer), `Access-Control-Expose-Headers:
    Retry-After` (4.6.0: si no, el POS, que corre en otro origen, no lo puede leer) y
    `Access-Control-Allow-Private-Network: true` en el preflight, para el POS publicado llamando a
    `localhost`. `CORS_OPTIONS` y el preflight, en `src/server/middleware/private-network.ts`, valen
    para el app real y para el de mantenimiento.
- **Demos v2** (#24, spec `docs/superpowers/specs/2026-10-05-m8-demos-v2-design.md`), en
  `src/server/demo/` (reemplaza el tenant por visitante de #9):
  - **Un comercio fijo por rubro**: `demo-kiosco`, `demo-almacen` y `demo-ferreteria` ("Kiosco Demo",
    etc.), sin dueño, marcados en `demo_tenants`. La semilla (`seedDemoCommerce`,
    `seeds/demo-commerce.ts`) pone el catálogo con ids deterministas (`demo_<sku>`), los clientes demo
    y 30 días de historial de dos cajas de la casa, relativos a `now`. `DEMO_TENANT_IDS_SQL`
    (`demo/demo-tenant-ids.ts`) es la marca de demo para cobro, plataforma, suspensión,
    impersonación y backup: los comercios demo nunca cobran ni aparecen en Comercios o Usuarios.
  - **Una caja por visitante**: `POST /connector/demo-sessions` (el único endpoint sin key) crea en
    el comercio del rubro una caja `Demo XXXX` con su key y su fila de `demo_sessions`. Los visitantes
    comparten el comercio. `demo_sessions` es el registro para M9: **nunca se borra** y vive en
    `system.sqlite`, fuera del comercio. Tope `DEMO_MAX_ACTIVE` de cajas activas (`503 demo-capacity`).
  - **Revocar** una caja es `active = 0` en la caja y su key (`401` a todo), con `revoked_at` y
    `revoke_reason` (`reset` o `idle`). Pasa con el reinicio total o a las `DEMO_TTL_HOURS` sin uso: la
    auth del POS y el admin anónimo corren `last_used_at` (`touchRegister`, a lo sumo por minuto).
  - **Reinicios** (`DemoResetService`, sincrónicos): el **total** vacía todas las tablas del comercio
    (salen de `sqlite_master`), vuelve a sembrar y revoca sus cajas; el **parcial** devuelve
    productos, stock (con `inventory_count`) y datos de clientes de la semilla, borra lo creado por
    visitantes (clientes, solo sin movimientos) y descarta discrepancias, y conserva ventas, saldos y
    cajas.
  - **El barrido** (`startDemoSweeper` en `demo/demo-sweeper.ts`, al arrancar y cada 15 minutos):
    borra las demos por tenant de antes de M8 (`legacy_demo_sessions`), hace el reinicio total
    automático a las `DEMO_RESET_HOUR` (4) **hora argentina** de cada día (si el servidor estaba
    caído, al arrancar), revoca las cajas inactivas y repone el stock que bajó de un cuarto del de la
    semilla ("Reposición automática"). Loguea `[demos] barrido: …`.
  - **Portal**: el visitante abre el admin del comercio demo desde el POS con `/MINI` (ver "Portal y
    acceso anónimo").
  - **Plataforma**: sección Demos (`/plataforma/demos`, root y soporte) con el estado de cada comercio
    demo y los reinicios parcial y total, auditados como `demo.reset` (el automático, con el actor
    `system`, "Automático").
  - El alta desde una demo crea un **comercio nuevo**; el rubro se preselecciona con el `template` que
    viaja en `onboarding.url`.
- **Portal y acceso anónimo** (#24, M10 #26, spec `docs/superpowers/specs/2026-10-05-m10-portal-design.md`):
  - `POST /connector/portal-links` da, con **cualquier** caja, `<origen>/portal#t=<token>`: un uso, 60 s,
    en `portal_links` su sha256 con la caja y la key (`ValidatedPosKey.keyId`). La key nunca va en la URL.
  - `POST /api/portal/redeem` (con `AUTH_RATE_LIMIT`) lo canjea por una sesión anónima
    (`anonymous_sessions`, `PortalService`) **atada a la key** que pidió el link, con su tipo:
    - `demo` (la caja tiene una demo activa): `admin` del comercio demo, sin `settings.manage`,
      `users.manage`, `owners.manage` ni `credits.view` (`ANONYMOUS_DENIED`); vive mientras su demo.
    - `register` (una caja real): `member` de **solo consulta**, `tenant.view` y `sales.view`
      (`REGISTER_ALLOWED`). Muere al rotar la key o desactivar la caja (desligar el equipo no la corta)
      y a las **2 h sin uso** (el último uso, a lo sumo por minuto). La suspensión y la restricción por
      deuda del comercio valen como para un usuario.
  - Solo entra por la cadena `/api/tenants/:tenantId` (`req.anonymous`, sin `req.user`; `canAs` con
    `req.anonymous.kind`); `requireOwnSession` la rechaza.
  - **La caja fija**: con `register`, `routes/sales-routes.ts` reemplaza la sucursal y el punto de venta
    de la query por los de la caja, una venta ajena da 404 y `/registers` devuelve solo la suya.
  - Cada apertura de una caja real se audita como `portal.opened` con `actor_user_id = 'register'`
    (`REGISTER_ACTOR`) y `audit_log.actor_register_id`: "Caja 1 (desde el POS) abrió mini".
  - Cliente: `/portal` canjea y guarda la sesión en el `sessionStorage` de la pestaña (solo
    `auth-state`; `AnonymousState` por `access`, lo guardado sin `access` es una demo). La demo abre
    Ventas en la caja del visitante con su franja y, con un 401, "Esta demo terminó". La caja abre el
    resumen de hoy de su caja con `RegisterBar` ("Caja 1 · Comercio, desde el POS, solo consulta" y
    "Entrar con tu cuenta", que suelta la caja y vuelve a la sesión propia o al login), el menú de
    Ventas & Caja, Productos, Stock y Clientes sin ediciones (`canDo('tenant.use')`) ni filtro de caja
    y, con un 401, "Este acceso terminó". `/MINI` abre "mi caja" aunque en el navegador haya un usuario
    logueado.
  - Migración de sistema v10 (`kind`, `api_key_id` y `actor_register_id`).
- **Embudo** (#25, spec `docs/superpowers/specs/2026-10-05-m9-funnel-design.md`), en `src/server/funnel/`:
  - **El visitante es la demo** (`demo_sessions.id`). Sin demo, un contacto del landing (`c-<id>`) o un
    comercio (`t-<id>`). Dos demos de la misma persona son dos visitantes (unirlos pediría contrato).
  - **El id viaja al alta**: `onboarding.url` es `/alta?template=<rubro>&demo=<id>` (también el
    "Crear mi comercio" de la franja y de "Esta demo terminó"); `POST /api/alta` con `demoSessionId`
    lo guarda en `tenants.demo_session_id`, aunque la demo esté revocada (una desconocida se ignora).
    El `#connect` no cambia: la liga se hace en el servidor.
  - **Se registra solo lo que se pierde** (`funnel_events`, `FunnelService`, una vez por demo o por
    comercio, con índices únicos): la primera venta de una caja de visitante (`demo-sale`, en el push),
    mini desde el POS (`portal-opened`, en el canje), el alta abierta (`alta-opened`, beacon) y la
    carga (`catalog-loaded`: importación confirmada o catálogo de ejemplo, nunca en demos). Los puntos
    de registro usan `tryRecord`: un error queda en el log y nunca corta el push, el canje ni el alta.
  - **Lo demás se infiere** (`FunnelQueryService`): la demo, el comercio, la venta real (el primer
    `charges`) y el pago (el primer `paid_movements` `payment` del titular desde que nace el comercio).
    Un comercio implica el alta.
  - **Landing anónimo**: `funnel_daily` por día argentino (visitas, clic en "Probar la demo", alta sin
    demo), con `POST /api/funnel/beacon` (siempre `204`). Sin id, cookies, IP ni navegador.
  - **Contacto** "¿Querés que te ayudemos a empezar?" (`funnel_contacts`, uno por demo; el esquema
    compartido es `src/shared/funnel-contact.ts`): en la franja de la demo (desde el POS, con `/MINI`),
    en "Esta demo terminó" y en el landing, con `POST /api/funnel/contacts`. En el cliente, "una vez"
    y "ya lo dejó" viven en memoria (`state/funnel-public-state.ts`).
  - **Panel**: Embudo (cohorte por inicio del visitante, por etapa y por rubro, con el % sobre la
    cohorte: sobre la etapa anterior no sirve porque la cohorte mezcla tipos de visitante) y
    Visitantes (lista, filtros, historia, "Escribir por WhatsApp" y "Marcar atendido", auditado como
    `funnel.contact-handled`), para root y soporte. El menú cuenta los contactos sin atender.
  - **Retención** (`startFunnelSweeper`, al arrancar y cada 15 minutos): eventos 24 meses; nombre y
    WhatsApp de contactos sin comercio, 12 meses sin cambios. Loguea `[embudo] barrido: …`.
  - Migración de sistema v11 (`tenants.demo_session_id`, `funnel_events`, `funnel_daily` y
    `funnel_contacts`).
- **Ventas & Caja** (#20, spec `docs/superpowers/specs/2026-10-02-m4-ventas-caja-design.md`):
  - **El día de un comercio es el día argentino** (UTC−3 fijo): `src/shared/argentina-day.ts` en TS
    y `date(x, '-3 hours')` en SQL. Ventas y cobranzas van por `ticket.date` y `receipt.date` si
    vienen, como el `/RESUMEN` del POS. Nunca la hora del servidor (en Lightsail es UTC).
  - **Escritura**: ventas, cobranzas y movimientos de caja se escriben solo con
    `src/server/sales/records.ts`, que guarda el payload y completa las columnas derivadas (`day`,
    `customer_id`, números de ticket y de recibo; migración de comercio v5). Lo usan el push, la
    cobranza del admin y la semilla.
  - **Caja** = sucursal + punto de venta del `origin`. La cobranza del admin es `ADMIN · Oficina`
    ("Admin").
  - **Consultas**: `SalesQueryService` (de comercio) y `routes/sales-routes.ts`, para los tres roles.
    El resumen es una copia fiel de `calculateDaySummary` del POS (`sales/day-summary.ts`): si el POS
    lo cambia, se copia el cambio. El cliente usa los mismos textos que el `/RESUMEN`.
  - **Anulaciones como en el POS**, también en el dashboard: el total es el neto de todos los tickets
    y la cantidad cuenta los vigentes (ni anulaciones ni anuladas).
  - Los tipos de la API están en `src/shared/sales-types.ts` (servidor y cliente).
- **Créditos y cobro** (#21, spec `docs/superpowers/specs/2026-10-03-m5-creditos-cobro-design.md`):
  - **Caja** (`registers`, de sistema; `src/server/registers/`): sucursal, punto de venta, nombre y
    equipo ligado, con a lo sumo una key activa (rotarla no cambia la caja). Se liga al primer
    `deviceId` que la usa; otro equipo con la misma key cobra aparte ("otro equipo") y sus ventas se
    aplican igual. El alta, las demos y el admin crean cajas, nunca keys sueltas (`/api-keys` no
    existe más; la sección es Configuración → Cajas, rutas `/pos-registers`).
  - **Cargo** = caja (y equipo) por día con ventas que no son anulación, por `sales.day`: nace en el
    push y el barrido (`startBillingSweeper`, al arrancar y cada 15 minutos) crea los que falten. Sin
    cargos retroactivos (solo ventas con `register_id`) y nunca en demos.
  - **Reparto** (`billing/allocation.ts`, puro): con saldo pagado del titular, la proporción
    configurada (50 %) y el faltante de una fuente sale de la otra; sin pagado, todo regalado (por
    vencimiento más próximo); lo que no cubre nada es deuda. Pesos enteros.
  - **El pagado es de la persona** (el titular, `tenants.holder_user_id`, un owner activo): cambiar
    el titular no mueve saldo y lo comparten sus comercios. **Los regalados son del comercio** (bono
    de alta y créditos de plataforma, con vencimiento).
  - **Deuda y gracia**: 10 días desde el cargo en deuda más antiguo (root o soporte la extienden).
    Pasada, el comercio queda restringido: `createBillingRestriction` da `402 billing-restricted` salvo en
    Créditos, `billing-status` y exportar; el POS sigue vendiendo y sincronizando, y root o soporte
    impersonando no quedan restringidos. Un pago cancela primero la deuda; un regalado nuevo, no.
  - Todo en `BillingService` (de sistema, reloj inyectable) y la configuración en
    `billing_settings` (precio por caja y día, bono, proporción, gracia, umbral de saldo bajo, cómo
    pagar). Rutas del comercio en `routes/credits-routes.ts` (`credits.view`: owner y admin) y de
    plataforma en `routes/platform-routes.ts` (`requirePlatformRole`; devoluciones y configuración,
    solo root), con planilla de cobranzas CSV idempotente (`billing/payment-sheet.ts`). Las acciones
    de plataforma sobre un comercio (pago, bono, gracia, titular, devolución) están en su detalle de
    `/plataforma` (#23), no en Uso y pagos.
  - Tipos de la API en `src/shared/credits-types.ts` y `src/shared/register-types.ts`.
  - La sección del admin se llama **Uso y pagos** (`/admin/<comercio>/uso-y-pagos`, #55) y los
    créditos regalados se muestran como **bonos** (solapa `/uso-y-pagos/bonos`).
- **Plataforma** (#23, M7a y M7b; spec `docs/superpowers/specs/2026-10-04-m7-plataforma-design.md`):
  - **Panel en `/plataforma`**, para root y soporte, con una sección por pantalla:
    - Comercios (por omisión; el detalle en `/plataforma/comercios/<slug>` con créditos, acciones de
      cobro, bonos, miembros y suspender), Usuarios, Pedidos, Demos, Embudo, Visitantes (#25; la
      historia en `/plataforma/visitantes/<id>`), Cobranzas, Soporte (solo root), Registro y
      Configuración (solo root).
    - **Las secciones están en el menú lateral, sin solapas** (#81): root y soporte no tienen comercios
      (#16), así que su menú es el de la plataforma (`components/platform/platform-sections.tsx`) y
      su cabecera no tiene el selector de comercios. Impersonando se ve el menú del usuario.
    - Quién ve cada sección lo dice `isPlatformSectionAllowed` (`state/permissions-state.ts`); si
      soporte entra por URL a una de root, `registerPermissionEffects` lo manda a `/plataforma`.
    - El ítem activo es `platformSectionSignal`; el detalle de un comercio marca Comercios.
    - Las rutas son `PLATFORM_SECTIONS` en `routing/admin-routes.ts` (`route.section`). Filtros en la
      URL (`?q=`, `?comercio=`) con `setPlatformFilters`; estado en `state/platform-panel-state.ts`.
  - Servidor: servicios de sistema en `src/server/platform/` (suspensiones, estado de cuentas,
    invitaciones de soporte, consultas del panel) y rutas en `routes/platform-admin-routes.ts`, junto
    a las de cobro en `/api/platform`. `requirePlatformRole` marca sus roles y
    `test/platform-permissions.test.ts` tiene la tabla de todas las rutas: una ruta nueva va ahí.
  - **Suspender un comercio** (con motivo, `tenant_suspensions`): sus usuarios reciben
    `403 tenant-suspended` en todo menos Uso y pagos, `billing-status` y exportar
    (`middleware/tenant-path.ts`, lo mismo que la restricción por deuda) y el admin muestra "Este
    comercio está suspendido" sin pedir lo demás (`state/suspension-state.ts`). El POS sigue
    sincronizando y los días suspendidos (día argentino) no se cobran.
  - **Cuentas desactivadas** (`users.status`): no entran y se cierran sus sesiones. Nadie toca a root
    ni a sí mismo; a soporte, solo root. Root y soporte generan links de restablecimiento sin comercio.
  - **Soporte por invitación** (`staff_invitations`, solo root): link `/invitacion#t=…&tipo=soporte`,
    un solo uso, 48 h; crea la cuenta de soporte o promueve una sin comercios (con comercios, 409).
  - Migración de sistema v7 (M7a) y v8 (M7b).
  - **Impersonación de usuario** (M7b): una fila más de `sessions` con `impersonator_user_id`,
    `parent_token`, `tenant_id`, `help_request_id` y `last_used_at` (`AuthService.resolveSession`).
    - Solo root o soporte con su sesión propia (`POST /api/impersonations`, `ImpersonationService`),
      como cuentas `user` activas con una membresía activa; nunca root, soporte, desactivados ni demos.
    - Vence a las 2 h sin uso (el último uso se escribe a lo sumo por minuto) y muere con la sesión
      padre: "Cerrar sesión" la borra en el servidor (`POST /api/auth/logout`). "Salir" es
      `DELETE /api/impersonations/current`. Las tres cosas se auditan (`impersonation.ended`).
    - `req.user` es el usuario impersonado y `req.impersonator`, quien impersona: rol, permisos y
      rutas son los del usuario. Un comercio suspendido o restringido no bloquea a quien impersona.
    - `requireOwnSession` (403 "No disponible mientras ves como otro usuario"): contraseña, nombrar
      owners, links de restablecimiento, crear comercios, aceptar invitaciones y toda la plataforma.
    - La auditoría guarda los dos (`auditActor(req)`, `audit_log.impersonator_user_id`) y se lee
      "Ana (soporte) como Juan".
    - Cliente: la pestaña que impersona guarda su sesión en `sessionStorage` (solo `auth-state` lo
      toca, guardián en `test/client-guards.test.ts`) y nunca escribe `localStorage`, que es de la
      sesión de soporte. "Entrar como" (Usuarios y miembros del detalle) abre
      `/plataforma/entrar?usuario=…&comercio=…` con `window.open(…, 'noopener')`
      (`state/impersonation-state.ts`); la franja tiene "Salir"; un 401 muestra "La sesión como Juan
      terminó". Root o soporte en `/admin` van a `/plataforma`.
  - **Pedidos de ayuda** (M7b, `help_requests` y `help_request_takes`, `HelpRequestService`):
    - "Pedir ayuda" en la cabecera (sin impersonar y con WhatsApp de soporte): crea el pedido con la
      pantalla actual (validada contra el admin de ese comercio), cierra el anterior, vence a las 24 h
      y abre WhatsApp con el link `/ayuda/<id>`.
    - Soporte abre el link (o "Atender" en la sección Pedidos, últimas 48 h) y entra como el usuario
      en esa pantalla; vencido o cerrado, 410 "Este pedido venció".
    - El usuario ve su pedido abierto, los accesos de soporte de 7 días y "Soporte está viendo tu
      cuenta" (`GET /api/me/support-access`, `state/help-state.ts`).
    - El seed de desarrollo carga un WhatsApp de soporte de prueba si no hay uno.
- **Importación y carga inicial** (#22, spec `docs/superpowers/specs/2026-10-03-m6-importacion-design.md`):
  - **El servidor parsea, sugiere y valida, sin estado**: `POST /import/:entity` (`customers` o
    `products`, capacidad `bulk`) recibe `{ csv, mapping?, dryRun }` y devuelve columnas, mapeo,
    resultado por fila y totales. La vista previa corre igual dentro de un `SAVEPOINT` y se deshace;
    al confirmar, las filas con error se omiten y el resto se aplica en esa transacción.
  - Parser común en `src/server/io/csv.ts` (lo usa también la planilla de cobranzas): separador
    detectado, comillas, BOM y montos; en un archivo con `;` el punto es siempre de miles. Campos y
    tipos en `src/shared/import-fields.ts`; sinónimos y mapeo sugerido en `src/server/io/suggest-mapping.ts`.
  - Clientes por id, documento (sin puntos ni guiones) o nombre normalizado; productos por código de
    barras, SKU o nombre. Al actualizar solo se tocan los campos mapeados.
  - **El saldo inicial pasa por el libro**: movimiento `opening` ("Saldo inicial (importado)"). Al
    reimportar se corrige con otro `opening` solo si todos sus movimientos son `opening`; si no, la
    fila avisa y el saldo no cambia. La columna id engancha los pendientes de discrepancias.
  - El stock se fija por sucursal (una columna por sucursal) con un movimiento `inventory_count` en
    el kardex (`stock/write-stock.ts`, compartido con `StockService`).
  - El cliente (`components/import/`, `state/import-state.ts`) lee UTF-8 o, si no es válido,
    Windows-1252 (el CSV de Excel en castellano).
  - **El alta pide WhatsApp** (solo dígitos, `users.whatsapp`) y **rubro** (`tenants.business_type`:
    `kiosco`, `almacen`, `ferreteria`, `otro`; migración de sistema v6), crea el comercio vacío y
    sigue con "Cargá tus datos": subir archivos, el catálogo de ejemplo del rubro
    (`POST /catalog/example`, idempotente) o después. Sin CUIT ni datos fiscales hasta la facturación.
- **Cliente** en `src/client/`: Preact + `@preact/signals` + Tailwind CSS v4 (`@tailwindcss/vite`,
  como middleware de Express).
  - **Router propio con una URL por pantalla** (#59, spec `docs/superpowers/specs/2026-10-04-router-query-design.md`):
    landing en `/`, alta en `/alta` (`/onboarding` se reescribe), los links en `/invitacion` y
    `/restablecer`, el admin en `/admin/<slug-comercio>/<sección>[/<solapa>][?filtros]` y la
    plataforma en `/plataforma`. La tabla (secciones, solapas y códecs de filtros, en castellano y sin
    acentos) es pura, en `routing/admin-routes.ts`; `state/route-state.ts` tiene la URL como signal y
    es el único que escribe el historial (`test/client-guards.test.ts`). Cambiar de comercio, sección
    o solapa agrega una entrada (`goTo`, `<Link>`); un filtro la reemplaza (`setFilters`). El menú abre
    la sección limpia.
  - **El comercio activo es el de la URL** (`effectiveTenantIdSignal`, en `auth-state.ts`): un slug
    ajeno muestra "No tenés acceso", nunca una redirección muda; `localStorage` solo guarda el último
    usado, para `/admin` pelado. Así cada pestaña tiene su comercio (base de M7).
  - **Datos con TanStack Query** (`@tanstack/query-core`): `createSignalQuery`/`createTenantQuery`
    (`api/query-client.ts`, `state/query-keys.ts`) con clave `['t', comercio, dominio, …]`,
    habilitadas con su pantalla (`inSection`). Caché al toque y refresco al entrar y al volver a la
    pestaña (`staleTime: 0`). Cada mutación llama a `invalidateAfter(evento)` y la tabla evento →
    dominios está en `state/invalidation.ts`. La caché se borra al cambiar de sesión y lo de otros
    comercios al cambiar de comercio. Nada de `effect` de carga en los stores ni de `view-loader`.
  - El landing abre el POS en su **canal**, el major del
    contrato implementado (`<POS_URL>/v4/`, sin fijar una versión: la PWA lleva el último POS
    compatible); el origen, de `VITE_POS_URL` al compilar (`publishedPosOrigin` en
    `state/demo-link.ts`, #11), que `deploy.yml` toma de la variable `POS_URL` del environment
    `production` (vacía: `https://pos.contax.ar`, #38). Mudar el POS es cambiar esa variable y
    correr el deploy.
  - **POS híbrido** (#9, #58): en desarrollo, el landing abre una **copia local del canal del POS
    publicado** que el mini-erp sirve en `/pos/v4/` (`src/server/pos-mirror/`, montada en
    `client-middleware.ts` solo fuera de producción; `pnpm dev` la baja sola a `vendor/pos/v4/` si
    falta y loguea qué POS sirve, `pnpm pos:mirror [canal]` la renueva). Mismo JS que el publicado,
    mismo origen que el mini-erp: sin CORS ni permiso de red local, así el recorrido anda en
    cualquier navegador y en el e2e. Baja también el manifest y sus íconos, pero **nunca el service
    worker** (`sw.js`): en desarrollo el POS corre sin modo offline y una copia renovada se ve al
    recargar; la parte PWA se prueba contra el POS publicado. El e2e corre con
    `serviceWorkers: 'block'`. En producción el landing abre `<POS_URL>/v4/` (hoy
    `https://pos.contax.ar`): la demo pública sigue probando la integración real (CORS, `#connect`
    entre dominios). La copia se baja siempre del canal publicado, nunca de `main` de offline-pos, y
    no se commitea.
  - El alta vuelve al POS con `state/connect-return.ts`: la conexión va siempre en el fragmento
    (`#connect=`), nunca en la query.
  - Estado solo con signals (`signal`, `computed`, stores por dominio en `src/client/state/`). **Sin
    hooks de React** (`useState`, `useEffect`, etc.): lo hace cumplir el lint
    (`no-restricted-imports` de `preact/hooks`, `preact/compat` y `react`).
  - Temas claro, oscuro y del sistema: `src/client/state/theme-state.ts`, variante class-based
    `@custom-variant dark (&:where(.dark, .dark *))` en `index.css`, script anti-FOUC en
    `index.html` y `ThemeToggle.tsx` en `Header.tsx`, `AuthView.tsx`, `MerchantOnboardingView.tsx`
    y la solapa Apariencia de configuración (`AppearanceSection.tsx`).
  - Componentes propios estilo shadcn, sin librerías de UI externas innecesarias.
  - **Modales y drawers en la top layer** (#56, spec `docs/superpowers/specs/2026-10-04-modales-top-layer-design.md`):
    todo overlay va por `Modal` o `Drawer`, que se abren con `<dialog>` y `showModal()`
    (`ui/DialogShell.tsx`, de clase, sin hooks). Ningún contenedor los recorta (un `Card` con
    `backdrop-blur`), el resto queda inerte, Escape y el fondo piden `onClose` y el foco vuelve solo;
    con un diálogo abierto el body no scrollea (`index.css`). Los toasts los dibuja el diálogo de más
    arriba (`state/dialog-stack.ts`): afuera quedarían inertes. `test/overlay-guard.test.ts` falla si
    aparece otro `fixed inset-0` o `<dialog`.
  - **Fechas, horas y números según la configuración del navegador** (su locale y su preferencia de
    12 o 24 horas), nunca con un locale fijo. La moneda es siempre ARS; solo cambia cómo se escribe.
    Todo pasa por `src/client/format.ts` (#51): montos con centavos (`formatMoney`) o en pesos
    enteros para los agregados del dashboard (`formatMoneyRounded`), cantidades, días, fechas y
    horas. Nada más en `src/client` usa `Intl`, `toLocale*String`, `hourCycle` ni un locale fijo
    (`test/browser-format.test.ts`).
  - **Marca** (#18): lo visible dice "mini contax" (en minúsculas). Logo en `components/ui/Logo.tsx`
    (un ticket con la "c" de Contax) y favicon en `public/favicon.svg` (variante de ticket grande,
    legible a 16 px). La versión de mini sale de `package.json`: `appVersionDefine` en
    `vite.config.ts` la inyecta al compilar y `state/app-version.ts` la expone (`versionLabel()`).
    `test/brand.test.ts` falla si vuelven "Mini-ERP", "Express", "Multitenant", "Connector v…",
    "Puerto: …" o "TPV" a la UI. Las credenciales del seed de desarrollo están detrás de
    `import.meta.env.DEV` (`state/dev-login.ts`), así el build de producción no las incluye.

## Deploy (#3)

- **AWS Lightsail** (plan de US$5, Ubuntu 24.04) con **Caddy** y HTTPS en **`https://mini.contax.ar`**
  (marca Contax, producto mini contax; el POS está en `pos.contax.ar`, rauldiazsolis/offline-pos#150).
  DNS en DreamHost: registros A a la IP estática. `mini.contax.com.ar` y el nombre viejo
  `52-203-224-101.sslip.io` redirigen con 308 desde Caddy (`deploy/set-host.sh`, #11): sirven para el
  navegador, la conexión del POS va siempre al principal. Todo lo del servidor está en `deploy/`; la
  guía para quien lo opera, en `deploy/README.md`.
- En la instancia: `minierp` corre `mini-erp.service` (`/opt/mini-erp/current`, datos en
  `/var/lib/mini-erp`, entorno en `/etc/mini-erp/env`); `deploy` recibe las versiones y solo puede
  reiniciar el servicio.
- `.github/workflows/deploy.yml`, por tag `v*` o manual: corre el CI entero (`ci.yml` con
  `workflow_call`), sube un tarball por SSH y lo activa con `deploy/deploy.sh`, que espera la
  migración (hasta 15 min, `/health` en `maintenance`) y vuelve a la versión anterior si `/health` no
  responde o la migración falla. Secretos (`SSH_*`) y `PUBLIC_HOST` en el environment
  `production`: los carga el usuario, nunca el agente.
- **Versión única** (#40): la de `package.json`, sin literales en el código (`src/server/app-version.ts`
  para `/health` y `GET /connector/info`; `appVersionDefine` en `vite.config.ts` para el cliente). Se
  sube en el PR de cada etapa (`pnpm version minor --no-git-tag-version`; `patch` para arreglos) y el
  tag `v*` se crea después del merge desde `package.json` con `pnpm release:tag` (#49, verifica
  `main` limpio, al día y un tag nuevo).
  `deploy.yml` frena si el tag no coincide (`scripts/check-release.ts`) y, al final, comprueba que
  `/health` responda la versión subida.
- Backups: snapshots automáticos de Lightsail y `mini-erp-backup.timer` (03:30) con
  `scripts/backup.ts` (`VACUUM INTO` de las bases reales, sin demos, 7 días).
- Nunca guardar backups como artifacts de GitHub: en un repo público los baja cualquiera, y tienen
  hashes de contraseñas.

## Datos semilla y fidelidad al contrato

- Catálogos iniciales, fixtures y presets de rubro en `src/server/seeds/`, nunca dentro de servicios
  o controladores.
- Historial simulado siempre con fechas relativas a `new Date()` (`now - N días`), nunca fijas, para
  que los dashboards muestren datos vigentes.
- No asumir DTOs ni respuestas de sync: verificar siempre `docs/connector-api.openapi.yaml`.

## Estado

Fases 1 a 10 hechas (núcleo multitenant, API de gestión, admin, grillas, IoC, sync en vivo con el POS,
temas, estrictez de TypeScript y Zod, demo y alta con el POS publicado, deploy público): detalle en
`PLAN.md`.

Sigue el **MVP de mini contax** (epic #17, definido el 2026-10-01): la spec
`docs/superpowers/specs/2026-10-01-mvp-mini-contax-design.md` tiene las decisiones de producto
(roles y accesos anónimos, demos, funnel, carga inicial, créditos y cobro, ventas y caja, marca) y
las etapas en orden. Hito 1 (un comercio conocido que paga): M1 marca (#18, hecha), M2 roles e invitaciones
(#19, hecha), M3 contrato 4.4.0 (#2, hecha), M4 ventas y caja (#20, hecha), M5 créditos (#21,
hecha) y M6 importación (#22, hecha).
Antes de M7, en este orden (#17): el POS en el canal `/v4/`, `POS_URL` por omisión y contrato 4.5.0
(#58 con #38, hecha), la parte chica del contrato 4.6.0 (#63, hecha; el portal llegó con M10, #26), formato según el navegador (#51,
hecha), router y TanStack Query (#59, hecha, con #55: "Uso y pagos" y bonos), modales y drawers en la
top layer (#56, hecha) y Zod 4 con @types/node 24 (#6, hecha).
Hito 2 (un comercio desconocido, sin ayuda): M7 a M11 (#23 a #27). M7 fue en dos PR: M7a (panel de
plataforma, suspensión, cuentas desactivadas y soporte por invitación, hecha) y M7b (impersonación de
usuario por pestaña, root y soporte sin membresía implícita, #16, y pedidos de ayuda, hecha). M8
(#24, hecha): demos v2 con un comercio por rubro, una caja por visitante, reinicios y el portal
adelantado de M10 con el acceso anónimo de la demo. M10 (#26, hecha): el portal de las cajas reales,
"mi caja" de solo consulta desde `/MINI`. M9 (#25, hecha): el embudo de punta a punta, con el id de
visitante, los contactos y las secciones Embudo y Visitantes. Sigue M11 (#27). La parte del POS está en el epic rauldiazsolis/offline-pos#182. Cada etapa empieza con su propio brainstorming de detalle.

En backlog, entre otros: lo que quedó afuera del MVP (#28 a #36).
