# M10 · Portal, lado mini: el cajero entra a mini desde el POS (#26)

## Contexto

La spec del MVP (`2026-10-01-mvp-mini-contax-design.md`, "Accesos anónimos" y "POS (offline-pos)" →
Portal) define el portal: el POS pide con su key un link de un uso que vence en 60 s, lo abre en una
pestaña nueva y el backend lo canjea por la sesión anónima de esa caja. Para una caja real, la sesión
es un `member` limitado a su caja; para una demo, `admin` del comercio demo.

M8 (#24, spec `2026-10-05-m8-demos-v2-design.md`, "Portal y acceso anónimo") adelantó la mitad:

- `GET /connector/info` declara la capacidad `portal` con `{ command: 'MINI', label: 'Abrir mini' }`.
- `POST /connector/portal-links` da `/portal#t=<token>` con una caja de demo (tabla `portal_links`) y
  `/admin/<slug>` (el login) con una caja real.
- `POST /api/portal/redeem` canjea el token por una `anonymous_session`, hoy atada a una sesión de
  demo (`demo_session_id`), con rol `admin` y las capacidades que resta `ANONYMOUS_DENIED`.
- El cliente guarda la sesión en `sessionStorage` y `/portal` abre Ventas en la caja del visitante.

M10 generaliza el acceso anónimo a las cajas reales. **El contrato no cambia**: implementamos 4.6.0,
que deja al backend decidir la URL y los permisos de la sesión.

## Decisiones

| Pregunta | Decisión |
|---|---|
| Qué puede el cajero | **Solo consulta**: ventas, cobranzas, movimientos y resumen de su caja; precios, stock (todas las sucursales) y clientes (con saldo y movimientos). Ve el estado de cobro (como el `member`). Sin dashboard, kardex, discrepancias ni escrituras |
| Cómo lo hace cumplir el servidor | Dos capacidades de lectura nuevas en la matriz (`tenant.view`, `sales.view`) y `canAs` por **tipo de acceso**; la caja es un filtro que el servidor fuerza en las rutas de Ventas & Caja |
| Vista "mi caja" | **Ventas & Caja (M4) con la caja fija**, sin el filtro de caja; abre en el Resumen de hoy; cualquier rango de fechas de su caja |
| La demo | Sigue como `admin` del comercio demo (M8 no cambia) |
| Qué origina y qué corta la sesión de una caja real | La origina el canje de un link pedido con la key; la cortan **rotar la key o desactivar la caja**. Desligar el equipo no la corta: `/portal-links` no manda `deviceId` |
| Vencimiento | **2 h sin uso**, como la impersonación. Cada pestaña tiene su sesión, independiente |
| Usuario logueado que abre `/MINI` | "Mi caja" igual en esa pestaña, con **"Entrar con tu cuenta"** |
| Auditoría | Cada apertura (`portal.opened`) con la caja como origen. Las demos no: ya están en `demo_sessions` |

## Modelo de datos (migración de sistema v10)

- **`anonymous_sessions`** se rearma (SQLite no saca un `NOT NULL`):
  - `kind TEXT NOT NULL` (`demo` | `register`);
  - `api_key_id TEXT NOT NULL`: la key que pidió el link;
  - `demo_session_id TEXT` (nulo en las de caja real);
  - el resto igual (`token_hash`, `tenant_id`, `register_id`, `created_at`, `last_used_at`) y el índice
    por `register_id`.
  - Las filas existentes (todas de demo) se copian con `kind = 'demo'` y la key activa de su caja;
    sin key activa, la caja ya está revocada y la fila se descarta.
- **`portal_links`**: `ADD COLUMN api_key_id TEXT` (nulo en los de antes, que vencen en 60 s).
- **`audit_log`**: `ADD COLUMN actor_register_id TEXT`. En una fila de la caja, `actor_user_id` es la
  marca `REGISTER_ACTOR` (`'register'`), como `SYSTEM_ACTOR` para el servidor.

El test parte de una base v9 con datos (una sesión de demo con key activa, otra sin key, links y
auditoría) y verifica que sobreviven como se describe.

## Servidor

### Link y canje

- `ValidatedPosKey` suma `keyId`.
- `POST /connector/portal-links` da con **cualquier** caja activa `{ url: '<origen>/portal#t=<token>',
  expiresAt }`: un uso, 60 s, en `portal_links` el sha256 del token, la caja y la key. Desaparece la
  rama "caja real → `/admin/<slug>`".
- `POST /api/portal/redeem { token }` (sin sesión, con `AUTH_RATE_LIMIT`), con un token vigente, sin
  usar, con su key y su caja activas:
  - **Caja de demo** (tiene una sesión de demo activa): como hoy, `kind = 'demo'`.
  - **Caja real**: `kind = 'register'`, sin sesión de demo; audita `portal.opened` con
    `actor_register_id` y `details: { registerName }`.
  - Responde `PortalRedeemResponse`, que pasa a ser una unión por `access`:
    - `{ access: 'demo', token, tenant, branch, pointOfSale, template }`;
    - `{ access: 'register', token, tenant, branch, pointOfSale, registerName }`.
  - Si no, **410** "Este link venció: volvé a abrir mini desde el POS".

### La sesión

- `PortalService.resolveAnonymous(token)` vale si la caja está activa y **su key (`api_key_id`)
  sigue activa**. Así rotar la key o desactivar la caja la cortan al toque.
  - Demo: además, su sesión de demo activa; corre el uso de la caja como hoy.
  - Caja real: además, `last_used_at` de hace menos de 2 h; lo corre a lo sumo una vez por minuto.
  - Si no vale, se borra la fila y da 401.
- `AnonymousContext` pasa a ser `{ kind, tenantId, registerId, branch, pointOfSale, registerName,
  demoSessionId? }`.
- `requireTenantContext`, con `req.anonymous`: solo su comercio (en otro, 403).
  - `demo` → rol `admin` y sin suspensión (como hoy).
  - `register` → rol `member`. La suspensión del comercio vale como para un usuario y la restricción
    por deuda también (el cajero es del comercio).
- `requireOwnSession` y las rutas que piden usuario siguen dando 401 o 403. El texto de
  `requireOwnSession` deja de nombrar la demo: "No disponible desde el POS ni en la demo".

### Permisos (`src/shared/permissions.ts`)

- Capacidades nuevas, de los tres roles: `tenant.view` (consultar el comercio: productos, categorías,
  stock, sucursales, clientes y estado de cobro) y `sales.view` (consultar Ventas & Caja). El estado
  de cobro va en `tenant.view` porque, con un comercio restringido, el cliente decide la pantalla con
  él; el `member` ya lo ve.
- `export type Access = 'user' | 'demo' | 'register'` y `canAs(role, capability, access)`:
  - `user`: `can(role, capability)`;
  - `demo`: menos `ANONYMOUS_DENIED` (sin cambios);
  - `register`: solo `REGISTER_ALLOWED = ['tenant.view', 'sales.view']`.
- `requirePermission` calcula el acceso con `req.anonymous?.kind ?? 'user'`.
- Rutas que pasan de `tenant.use` a `tenant.view`: `GET /branches`, `GET /branches/:branchId`,
  `GET /products`, `GET /products/:productId`, `GET /categories`, `GET /stock`, `GET /customers`,
  `GET /customers/:customerId`, `GET /customers/:customerId/movements` y `GET /billing-status`.
- Rutas que pasan a `sales.view`: `GET /registers`, `GET /sales`, `GET /sales/:saleId`,
  `GET /customer-payments`, `GET /cash-movements`, `GET /cash-summary`, `GET /cash-summary/day`.
- Siguen en `tenant.use` (la caja no las ve): dashboard, kardex, discrepancias,
  pedir ayuda y todas las escrituras.

### La caja fija en Ventas & Caja (`routes/sales-routes.ts`)

Un solo lugar: con `req.anonymous?.kind === 'register'`,

- las consultas reemplazan `branch` y `pointOfSale` por los de la caja, venga lo que venga en la query;
- `GET /sales/:saleId` de otra caja da 404 "No existe esa venta";
- `GET /registers` devuelve solo su caja.

Para los usuarios y la demo, sin cambios.

## Cliente

- **Sesión** (`auth-state`): `AnonymousState` suma `access`, `branch` y `registerName`; `template` solo
  en la demo. Lo guardado sin `access` se lee como demo (pestañas abiertas antes del deploy). Sigue en
  `sessionStorage`; nunca se escribe `localStorage`. `canDo` le pasa a `canAs` el tipo de acceso
  (`accessSignal`).
- **`/portal`**: textos neutros ("Abriendo mini…", "No se pudo abrir mini"). Con `register`, va (con
  `replace`) a `/admin/<slug>/ventas/resumen` con el período de hoy; con `demo`, como hoy.
- **Cabecera** con acceso de caja (`RegisterHeader`, como `DemoHeader`): "Caja 1 · Kiosco X" y "desde el
  POS", el tema y **"Entrar con tu cuenta"**, que suelta el acceso de la pestaña y va a `/admin/<slug>`
  (si no hay sesión de usuario, el login). Sin selector de comercios, menú de usuario ni "Pedir ayuda".
- **Menú**: `VIEW_CAPABILITY` pasa a `sales.view` (Ventas & Caja) y `tenant.view` (Productos, Stock y
  Clientes). Una sección no permitida vuelve a la primera permitida del menú (hoy, al dashboard).
- **Solo lectura**: con `!canDo('tenant.use')` se esconden crear, editar y borrar productos y clientes,
  ajustar stock, el kardex, cobrar, ajustar saldo y bloquear; no se piden discrepancias ni el estado de
  cobro (sus consultas se habilitan con `tenant.use`).
- **Ventas & Caja**: con acceso de caja no se muestra el filtro de caja.
- **401**: con acceso de caja, "Este acceso terminó. Volvé a abrir mini desde el POS"; la demo sigue
  con "Esta demo terminó…".
- **Actividad** (Usuarios → Actividad, del owner): `portal.opened` se lee "Caja 1 (desde el POS) abrió
  mini". `AuditLog.list` resuelve el nombre de la caja con `actor_register_id`.

## Casos de borde

- Varias pestañas: cada `/MINI` es un link y una sesión; todas mueren con la key o la caja.
- Un link de demo canjeado después de revocar la caja: 410 (la caja ya no está activa).
- Una caja real que pasa a otra sucursal (Configuración → Cajas): la sesión toma la sucursal y el
  punto de venta actuales de la caja en cada pedido.
- Un comercio suspendido: el cajero ve "Este comercio está suspendido", como sus usuarios.
- Links viejos sin `api_key_id`: el canje pide la key activa; sin ella, 410.

## Pruebas

- **Vitest**:
  - `test/system-migration-v10.test.ts`: la migración con datos.
  - `test/portal.test.ts`: con una caja real, link de un uso; vencido a los 60 s (reloj inyectado);
    sesión `register`; 2 h sin uso; rotar la key y desactivar la caja cortan; desligar no;
    `portal.opened` auditado; la demo sigue igual.
  - `test/permissions.test.ts`: `canAs` con los tres accesos; `test/permissions-client.test.ts`: el
    menú y `canDo` con el acceso de caja.
  - `test/permissions-api.test.ts` con la tabla `RUTAS` actualizada.
  - `test/anonymous-permissions.test.ts`: una pasada con el acceso de caja (403 en todo lo que no sea
    `tenant.view` ni `sales.view`).
  - `test/portal-register-scope.test.ts`: la caja forzada en las consultas, la venta ajena 404 y
    `/registers` con su caja.
  - Cliente (`test/portal-client.test.ts`): el estado guardado, la ruta de destino y el menú.
- **e2e** `e2e/portal.spec.ts`, el criterio de aceptación de #26. El POS publicado (0.4.0) todavía no
  tiene `/MINI` (P6 en offline-pos), así que el test hace el pedido del POS:
  `POST /connector/portal-links` con la key de la Caja 1 del Kiosco del seed. Después:
  - abre la URL: el resumen de esa caja, sin login y sin botones de edición;
  - el mismo link otra vez: "Este link venció";
  - un link nuevo esperado 61 s: "Este link venció" (test lento a propósito);
  - el owner rota la key por la API y la pestaña recargada muestra "Este acceso terminó".

## Afuera

- Escrituras desde la caja (cobranzas, stock, precios).
- Desligar el equipo como corte y un botón "Cerrar accesos".
- Auditar el cierre de la sesión.
- El comando y el botón en el POS (P6, offline-pos).
- Cambios al contrato.
