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
- **Contrato publicado**: la copia en `docs/connector-api.openapi.yaml`, con su procedencia en
  `contract.json`. Hoy: POS `0.1.0`, contrato **4.4.0**, piso **4.0.0**.
- **Contrato implementado**: **4.2.0** (4.1.0 suma `Sale.ticket`, el número del ticket en su día;
  4.2.0 suma `CustomerPayment.receipt` y define `balance` como el saldo de cualquier cliente, tenga o
  no crédito) más la capacidad **`demo-sessions`** de 4.4.0 (`POST /connector/demo-sessions` y la
  vuelta del onboarding con `#connect` desde `/alta`, #9). `GET /info` sigue diciendo `4.2.0` y
  declara `capabilities`. Es compatible con el POS por el piso. Lo que falta de 4.4.0
  (`customer-payment-void`, `notices`, las reglas de evolución) es #2.
- **Actualizar la copia**: `pnpm contract:update <versión del POS>`. Siempre de una carpeta publicada
  (`https://offline-pos.pages.dev/<versión>/`), nunca de `main` de offline-pos. El diff del OpenAPI
  muestra qué cambió; implementarlo es trabajo aparte, con su issue.
- La guía para integradores está publicada junto al OpenAPI (`/<versión>/docs/`).

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
  un subagente por tarea). Specs y planes en `docs/superpowers/`.
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
  de la URL, props de componentes) se tipan `x?: T | undefined`, porque Zod 3 infiere así y el
  servicio ya trata `undefined` como ausente; en los resultados que arma el propio código, la
  propiedad se omite si no hay valor (`...(x === undefined ? {} : { x })`). Nunca `as` ni `!` para
  callar el error.

## Arquitectura

- **DB por tenant** con `DatabaseSync` de `node:sqlite`:
  - `data/system.sqlite`: usuarios, tenants, membresías, roles globales (`root`, `support`, `user`) y
    API keys de terminales.
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
- **Auth propia**: sin servicios externos; `node:crypto` (`scryptSync`, comparación timing-safe). Las
  cuentas nacen siempre como `user`; el `root` sale de `AuthService.ensureRoot`, que usan el comando
  `scripts/create-root.ts` (una vez, en el servidor) y el seed de desarrollo. `root` y `support`
  pueden impersonar cualquier tenant.
- **Roles de comercio e invitaciones** (#19, spec `docs/superpowers/specs/2026-10-01-m2-roles-invitaciones-design.md`):
  - Matriz en `src/shared/permissions.ts` (TS puro, la usan servidor y cliente): roles `owner`,
    `admin`, `member` y capacidades `tenant.use`, `bulk`, `settings.manage`, `users.manage`,
    `owners.manage`. Permisos fijos. Root y support impersonando cuentan como `owner` hasta M7.
  - `requireTenantContext` resuelve el rol (`MembershipService.resolveRole`, solo membresías
    activas) y **cada** ruta de `/api/tenants/:tenantId` lleva `requirePermission(<capacidad>)`.
    `test/permissions-api.test.ts` tiene la tabla de todas las rutas y falla si una ruta nueva no
    está o exige otra capacidad.
  - El cliente esconde lo que el rol no permite con `canDo` (`state/permissions-state.ts`).
  - **Sin registro suelto**: una cuenta nace en `POST /api/alta` (cuenta, comercio, catálogo del rubro
    y key de "Caja 1", atómico) o aceptando una invitación.
  - Links de invitación y de restablecimiento de contraseña: un solo uso, 48 h, token en el fragmento
    (`/invitacion#t=…`, `/restablecer#t=…`), en la base solo su sha256. El restablecimiento lo genera
    el owner, solo para usuarios cuyas membresías activas son todas en comercios suyos.
  - Contraseña mínima de 8 caracteres para todos (`src/shared/password.ts`).
  - Auditoría en `audit_log` (`AuditLog`, de sistema): usuarios, roles, invitaciones y contraseñas.
    La ve el owner en Usuarios → Actividad.
  - Los errores de negocio son `DomainError` con su estado HTTP (`src/server/errors.ts`).
- **Arranque** en `src/server/bootstrap.ts`: el barrido de demos siempre; el seed de desarrollo
  (`ensureDevData`: admin root, `tienda-demo` con un admin y un empleado para probar los roles, y una
  key fija, todo en el repo) **solo fuera de
  `NODE_ENV=production`**.
- **Límite de pedidos por IP** (`src/server/middleware/rate-limit.ts`, ventana fija en memoria): 10
  demos por hora (`DEMO_RATE_LIMIT`) y 20 pedidos cada 15 minutos a login y registro
  (`AUTH_RATE_LIMIT`, contador compartido); `429` con `Retry-After`. `trust proxy` en `loopback`:
  detrás de Caddy, `req.ip` es la del cliente y `req.protocol`, `https`. El contrato todavía no
  documenta el 429 ni el 503 de `/demo-sessions` (rauldiazsolis/offline-pos#173).
- **IoC con Hardwired 1.6.2** (versión exacta): servicios por request con
  `req.tenantScope.use(serviceDef)`; nunca `new Service()` para un servicio de tenant. La base del
  tenant es `unbound` (`tenantDbDef`): resolverla desde el contenedor raíz falla a propósito, para
  que no haya fugas entre tenants. Detalle en `src/server/di/container.ts` y la Fase 5 de `PLAN.md`.
- **Connector API** bajo `/connector`:
  - Push validado con Zod al aplicarse, en `src/server/connector/push-events.ts`: los siete tipos
    de evento validan lo que el mini-erp lee y dejan pasar el resto (`passthrough`); los enums
    abiertos del contrato (medio de pago, motivo de stock) son `string`. Un evento inválido, de tipo
    desconocido o que ni siquiera es un objeto queda como `issue` del lote (con su `eventId` si lo
    tiene), sin tumbar el resto.
  - **El backend nunca rechaza de forma síncrona el contenido de un lote**: responde `200` y reporta
    las inconsistencias como `issues` en el pull.
  - `X-POS-Contract-Version`: `409 IncompatibleContract` si el major difiere (salvo en `/info`).
  - CORS `*` (sin cookies: el admin y el POS usan Bearer) y `Access-Control-Allow-Private-Network:
    true` en el preflight, para el POS publicado llamando a `localhost`
    (`src/server/middleware/private-network.ts`).
- **Demos aisladas** (#9), en `src/server/demo/`:
  - `POST /connector/demo-sessions` es el único endpoint sin key: crea un tenant `demo-*` **sin
    dueño**, marcado en `demo_sessions` (`system.sqlite`) y sembrado con `seedDemoSession` (template
    = preset: `kiosco`, `almacen`, `ferreteria`). `DemoSessionService` es de sistema (contenedor
    raíz), con reloj inyectable (`clockDef`).
  - Vence a las `DEMO_TTL_HOURS` del **último uso**: la auth del POS llama a `touch` con cada key
    válida. `startDemoSweeper` barre al arrancar y cada 15 minutos (`TenantManager.deleteTenant`
    borra filas y archivo). Tope `DEMO_MAX_ACTIVE` (`503 demo-capacity`).
  - Las demos no aparecen en la lista de comercios del admin, ni para `root`.
  - El barrido loguea `[demos] barrido: N …` al arrancar y cada vez que borra alguna.
  - El alta desde una demo crea un **comercio nuevo** (la demo vence sola); el rubro se preselecciona
    con el `template` que viaja en `onboarding.url`.
- **Cliente** en `src/client/`: Preact + `@preact/signals` + Tailwind CSS v4 (`@tailwindcss/vite`,
  como middleware de Express).
  - Un solo SPA con ruteo por path (`state/route-state.ts`): landing en `/`, admin en `/admin`, alta
    en `/alta` (`/onboarding` se reescribe). La versión del POS del landing sale de `contract.json`;
    el origen del POS publicado, de `VITE_POS_URL` al compilar (`publishedPosOrigin` en
    `state/demo-link.ts`, #11), que `deploy.yml` toma de la variable `POS_URL` del environment
    `production` (vacía: `https://offline-pos.pages.dev`). Mudar el POS es cambiar esa variable y
    correr el deploy.
  - **POS híbrido** (#9): en desarrollo, el landing abre una **copia local del POS publicado** que el
    mini-erp sirve en `/pos/<versión>/` (`src/server/pos-mirror/`, montada en `client-middleware.ts`
    solo fuera de producción; `pnpm dev` la baja sola a `vendor/pos/` si falta, `pnpm pos:mirror` la
    renueva). Mismo JS que el publicado, mismo origen que el mini-erp: sin CORS ni permiso de red
    local, así el recorrido anda en cualquier navegador y en el e2e. En producción el landing abre
    `<POS_URL>/<versión>/` (hoy `https://offline-pos.pages.dev`): la demo pública sigue probando la integración real
    (CORS, `#connect` entre dominios). La copia se baja siempre de una carpeta publicada, nunca de
    `main` de offline-pos, y no se commitea.
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
  - **Marca** (#18): lo visible dice "mini contax" (en minúsculas). Logo en `components/ui/Logo.tsx`
    (un ticket con la "c" de Contax) y favicon en `public/favicon.svg` (variante de ticket grande,
    legible a 16 px). La versión de mini sale de `package.json`: `appVersionDefine` en
    `vite.config.ts` la inyecta al compilar y `state/app-version.ts` la expone (`versionLabel()`).
    `test/brand.test.ts` falla si vuelven "Mini-ERP", "Express", "Multitenant", "Connector v…",
    "Puerto: …" o "TPV" a la UI. Las credenciales del seed de desarrollo están detrás de
    `import.meta.env.DEV` (`state/dev-login.ts`), así el build de producción no las incluye.

## Deploy (#3)

- **AWS Lightsail** (plan de US$5, Ubuntu 24.04) con **Caddy** y HTTPS en **`https://mini.contax.ar`**
  (marca Contax, producto mini contax; el POS irá en `pos.contax.ar`, rauldiazsolis/offline-pos#150).
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
  tag `v*` se crea después del merge desde `package.json` (comando en `deploy/README.md`).
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
(#19, hecha), M3 contrato 4.4.0 (#2), M4 ventas y caja (#20), M5 créditos (#21) y M6 importación (#22).
Hito 2 (un comercio desconocido, sin ayuda): M7 a M11 (#23 a #27). La parte del POS está en el
epic rauldiazsolis/offline-pos#182. Cada etapa empieza con su propio brainstorming de detalle.

En backlog, entre otros: #6 (Zod 4 y `@types/node` 24) y lo que quedó afuera del MVP (#28 a #36).
