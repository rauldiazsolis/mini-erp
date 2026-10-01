# M2 · Roles de comercio e invitaciones por link

Etapa M2 del epic #17 (issue #19). Detalle de la sección "Identidad, roles y accesos" de
[la spec del MVP](./2026-10-01-mvp-mini-contax-design.md). Brainstorming del 2026-10-01.

## Decisiones

- **Invitación con mail**: quien invita escribe mail y rol. Al aceptar, si el mail ya tiene cuenta,
  entra con su contraseña y suma la membresía; si no, pone nombre y contraseña.
- **Restablecer**: lo genera solo el owner, y solo para usuarios cuyas membresías activas están
  todas en comercios donde él es owner (si no, "pedíselo a soporte", M7). Nunca para sí mismo.
- **Desactivar** es la membresía (`status = 'disabled'`): pierde el acceso a ese comercio al
  instante, se puede reactivar y la fila queda. Desactivar la cuenta entera es de plataforma (M7).
- **Contraseña**: mínimo de **8 caracteres** para todos (alta, invitación, restablecimiento, cambio y
  root).
- **Root y support** siguen con la impersonación de comercio de hoy, con permisos de **owner**, hasta
  M7. Lo que hacen queda en la auditoría con su usuario.
- **Auditoría**: la ve el owner, en Usuarios → Actividad. El panel de plataforma llega en M7.
- **Alta en el servidor**: `POST /api/alta` crea todo de una vez. Se borran el registro suelto
  (`/api/auth/register`), `POST /api/tenants` y `POST /seed-preset`.
- **Tokens en el fragmento** (`/invitacion#t=…`, `/restablecer#t=…`): no llegan al servidor ni a los
  logs de Caddy. Se guarda solo el hash.
- **Permisos por capacidad** en un módulo compartido por servidor y cliente (enfoque A, sobre roles
  inline o routers por nivel).

## Modelo de datos

`system.sqlite`, esquema **4**. Producción se reinicia, así que no hay migración: si
`user_version` es menor que 4 y la base ya tiene tablas, el arranque frena con un mensaje claro
("base de una versión anterior: borrá el directorio de datos").

- `memberships` suma `status TEXT NOT NULL DEFAULT 'active'` (`active` | `disabled`). Solo las
  activas dan acceso.
- `invitations`: `id`, `tenant_id`, `email`, `role`, `token_hash`, `created_by`, `created_at`,
  `expires_at` (48 h), `accepted_at`, `accepted_by`, `revoked_at`.
- `password_resets`: `id`, `user_id`, `token_hash`, `created_by`, `tenant_id` (el comercio desde
  donde se generó), `created_at`, `expires_at` (48 h), `used_at`.
- `audit_log`: `id`, `at`, `actor_user_id`, `tenant_id` (nulo si no aplica), `action`,
  `target_user_id` (nulo si no aplica), `details` (JSON). Sin FK al comercio: sobrevive si se borra.

Acciones de la auditoría: `tenant.created`, `invitation.created`, `invitation.revoked`,
`invitation.accepted`, `member.role_changed`, `member.disabled`, `member.enabled`,
`password.reset_link_created`, `password.reset`, `password.changed`.

Tokens: 32 bytes al azar (`base64url`), guardados con sha256 como las keys del POS. El token en claro
se devuelve una sola vez, al crearlo.

## Capacidades

`src/shared/permissions.ts`, TypeScript puro sin dependencias:

```ts
export type TenantRole = 'owner' | 'admin' | 'member';
export type Capability = 'tenant.use' | 'bulk' | 'settings.manage' | 'users.manage' | 'owners.manage';
export function can(role: TenantRole, capability: Capability): boolean;
export function assignableRoles(actor: TenantRole): TenantRole[]; // owner → los 3; admin → admin y member; member → ninguno
```

| Capacidad | owner | admin | member | Qué cubre |
|---|:-:|:-:|:-:|---|
| `tenant.use` | ✓ | ✓ | ✓ | dashboard, catálogo y productos de a uno, stock y ajustes, clientes, cobros y ajustes de saldo, ver sucursales |
| `bulk` | ✓ | ✓ | — | precios e intereses masivos, importar y exportar |
| `settings.manage` | ✓ | ✓ | — | crear y editar sucursales; keys del POS (ver, crear, revocar) |
| `users.manage` | ✓ | ✓ | — | ver usuarios, invitar, cambiar rol, desactivar y reactivar (dentro de `assignableRoles`) |
| `owners.manage` | ✓ | — | — | nombrar o bajar owners, links de restablecimiento, ver la auditoría |

Créditos (M5) y reiniciar o borrar el comercio suman su capacidad cuando lleguen. Root y support
impersonando cuentan como `owner`.

## Servidor

### Aplicación de permisos

- `requireTenantContext` resuelve el rol del pedido (la membresía activa, u `owner` para root y
  support) y lo deja en `req.tenantRole`. Sin membresía activa, `403`. La misma resolución vale para
  el header `X-Tenant-Id` de `requireAdmin`.
- `requirePermission(cap)`: `403 { error: 'No tenés permiso para esto' }` si
  `!can(req.tenantRole, cap)`. Se monta **por ruta** dentro de cada router.
- Asignación:
  - `tenant.use`: todo `catalog-routes` salvo `POST`/`PUT /branches`; todo `stock-routes`,
    `customer-routes` y `dashboard-routes`.
  - `bulk`: `bulk-routes`, `GET /export/:entity`, `POST /import/:entity`.
  - `settings.manage`: `POST`/`PUT /branches` y las tres rutas de `/api/tenants/:id/api-keys`.
  - `users.manage`: `GET /users`, `POST /invitations`, `DELETE /invitations/:id`,
    `PATCH /users/:userId`. Tocar a un owner o asignar `owner` exige además `owners.manage`.
  - `owners.manage`: `POST /users/:userId/password-reset`, `GET /audit`.

### Endpoints

Se borran `POST /api/auth/register`, `POST /api/tenants` y `POST /api/tenants/:id/seed-preset`.
`GET /api/tenants` queda (lista los comercios del usuario).

- `POST /api/alta` (límite de auth): `{ name, email, password, businessName, template }`. Crea la
  cuenta, el comercio (owner: la cuenta), el catálogo del rubro (`kiosco`, `almacen`, `ferreteria`
  o `empty`) y la key de "Caja 1" en `CENTRAL`. Devuelve
  `{ token, user, tenant, posKey: { key, branch, pointOfSale } }`. Con sesión válida en
  `Authorization`, solo se mandan `businessName` y `template`, y el comercio es de esa cuenta (no
  devuelve `token`). Si el mail ya existe y no hay sesión, `409` "Ya tenés una cuenta con ese
  correo: iniciá sesión". Registra `tenant.created`.
- `POST /api/auth/password` (sesión): `{ currentPassword, newPassword }`. Cierra las otras sesiones
  del usuario. Registra `password.changed`.
- Links públicos (límite de auth):
  - `POST /api/invitations/lookup { token }` devuelve `{ tenantName, role, email, invitedByName,
    accountExists, expiresAt }`.
  - `POST /api/invitations/accept { token, password, name? }`: con cuenta existente, verifica la
    contraseña; sin cuenta, crea el usuario (`name` obligatorio). Crea la membresía, marca la
    invitación y devuelve `{ token, user, tenantId }`. Registra `invitation.accepted`.
  - `POST /api/password-resets/lookup { token }` devuelve `{ email, name, expiresAt }`.
  - `POST /api/password-resets/complete { token, password }`: fija la contraseña, cierra todas las
    sesiones del usuario y devuelve una nueva `{ token, user }`. Registra `password.reset`.
  - Token desconocido, vencido, usado o revocado: `410 { error: 'Este link ya no sirve: pedile uno
    nuevo a quien te lo mandó' }`.
- Del comercio, bajo `/api/tenants/:tenantId`:
  - `GET /users` devuelve `{ members: [{ userId, name, email, role, status, joinedAt,
    canReset }], invitations: [{ id, email, role, createdAt, expiresAt, invitedByName }] }`.
    `canReset` dice si quien pregunta puede generarle un link de restablecimiento.
  - `POST /invitations { email, role }` devuelve `{ id, token, expiresAt }`. Registra
    `invitation.created`.
  - `DELETE /invitations/:id` la revoca. Registra `invitation.revoked`.
  - `PATCH /users/:userId { role?, status? }`. Registra `member.role_changed`, `member.disabled` o
    `member.enabled`.
  - `POST /users/:userId/password-reset` devuelve `{ token, expiresAt }`. Registra
    `password.reset_link_created`.
  - `GET /audit` devuelve los últimos 200 movimientos del comercio con los nombres de actor y
    afectado.

### Reglas

- Invitar a un mail que ya es miembro del comercio (activo o desactivado): `409`. Una invitación
  nueva al mismo mail revoca la pendiente.
- Aceptar vuelve a validar todo: vigente, no usada, no revocada y que no sea miembro.
- Nadie cambia su propia membresía (`403`). Igual hay un guard explícito: el último owner activo
  no se baja de rol ni se desactiva (`409`).
- El admin solo invita, cambia de rol (entre admin y member), desactiva y reactiva a admin y member.
- Restablecer: solo owner, nunca para sí mismo, y solo si todas las membresías activas del usuario
  están en comercios donde quien lo pide es owner (si no, `403` "Pedíselo a soporte").
- El mínimo de 8 caracteres vive en un solo lugar (`src/shared/password.ts`) y lo usan el servidor,
  `scripts/create-root.ts` y el cliente.

### Servicios

- `MembershipService` (de sistema, contenedor raíz): usuarios del comercio, cambio de rol y estado,
  resolución del rol activo, regla de "todo suyo".
- `InvitationService` y `PasswordResetService` (de sistema, con reloj inyectable `clockDef`).
- `AuditLog` (de sistema, con reloj): `record({ actorUserId, tenantId, action, targetUserId?,
  details? })` y `listForTenant(tenantId, limit)`. Lo llaman los servicios, no los middlewares.
- `AltaService` (de sistema): orquesta `AuthService`, `TenantManager`, el preset y `ApiKeyService`.
  Si algo falla después de crear el usuario o el comercio, deshace lo creado.
- `AuthService` pierde `register` y suma `changePassword`, `setPassword` y `revokeSessions`;
  `listUserTenants` solo cuenta membresías activas.

## Cliente

- `state/permissions-state.ts`: `activeRoleSignal` (de `activeTenantSignal`; impersonando,
  `owner`) y `can(cap)`. Se corrige `TenantMembershipItem.role` para que coincida con el servidor. Si
  la vista activa no está permitida, vuelve al dashboard.
- Sidebar: "Operaciones Masivas" con `bulk`; ítem nuevo **"Usuarios"** con `users.manage`.
- Configuración: "Terminales POS & API Keys", "Gestión de Sucursales" y "Guía de Sincronización" con
  `settings.manage`; "Apariencia & Tema" y la nueva **"Mi cuenta"** (cambiar contraseña) para todos.
- Header: etiqueta con el rol junto al comercio activo (Owner, Admin, Empleado).
- **Usuarios** (`components/users/`):
  - Miembros: nombre, mail, rol (selector según `assignableRoles`; los owners solo los edita un
    owner), estado y desde cuándo. Acciones: Desactivar o Reactivar y "Link para restablecer" (solo
    owner; deshabilitado con "pedíselo a soporte" si `canReset` es falso). Sin acciones en la
    propia fila.
  - Invitaciones pendientes: mail, rol y vencimiento, con "Revocar" y "Generar link nuevo".
  - Invitar: modal con mail y rol. Al crear muestra el link una vez, con "Copiar" y "Compartir por
    WhatsApp" (`https://wa.me/?text=…`), y aclara que vence en 48 h y sirve una vez. El link de
    restablecimiento usa el mismo modal.
  - Actividad (solo owner): fecha, quién, qué y a quién.
- Páginas públicas `/invitacion` y `/restablecer` (`route-state.ts`): leen `#t=`, lo guardan en
  memoria y limpian el fragmento con `replaceState`. Al terminar quedan logueadas y van a `/admin`
  (la invitación, con ese comercio activo). Link que no sirve: el mensaje del `410`.
- `AuthView` sin "Registrarse": se borran `RegisterForm` y `register()` de `auth-state`.
- El alta (`/alta`) y "Crear nuevo comercio…" (`OnboardingModal`) llaman a `POST /api/alta`; lo que
  muestran al terminar (key y `#connect` de vuelta al POS) no cambia.

## Desarrollo, pruebas y deploy

- El seed de desarrollo suma en `tienda-demo` a `admin2@local.test` (admin) y
  `empleado@local.test` (member), con la contraseña de desarrollo. Solo fuera de producción. Una
  `data/` de desarrollo vieja hay que borrarla (el seed la recrea).
- Tests de Vitest antes del código (TDD), entre ellos:
  - la tabla de la matriz: owner, admin y member contra todas las rutas de `/api/tenants/:tenantId`;
  - un test que lista las rutas registradas en Express y falla si alguna no está en la tabla;
  - invitaciones, restablecimientos, cambio de contraseña, reglas del último owner y de "todo suyo",
    auditoría y el alta atómica.
- e2e: el alta pasa por `POST /api/alta`; uno nuevo con la invitación (el owner invita, el member
  acepta y no ve "Usuarios" ni "Operaciones Masivas").
- Versión **0.3.0** en el PR (`pnpm version minor --no-git-tag-version`); el tag después del merge.
- **Reinicio de producción** (lo corre el usuario, después del tag y el deploy): parar el servicio,
  borrar `/var/lib/mini-erp`, arrancar y volver a correr `scripts/create-root.ts`. El procedimiento
  queda en `deploy/README.md`. Se van todas las cuentas, incluidas las de prueba del deploy.
- `AGENTS.md`: roles y capacidades, links y auditoría en "Arquitectura".

## Casos de borde

- Cambiar o restablecer la contraseña cierra las otras sesiones: el otro equipo queda afuera.
- Un usuario con todas sus membresías desactivadas puede iniciar sesión, pero no ve comercios (el
  admin muestra "no tenés comercios").
- Aceptar una invitación con sesión de otro usuario abierta: la sesión nueva reemplaza a la anterior.
- Las demos (sin dueño) no cambian: siguen sin aparecer en el admin.

## Fuera de esta etapa

Soporte, impersonación de usuario, panel de plataforma y links de restablecimiento desde soporte
(M7). Accesos anónimos (M8, M10, M11). Mail (backlog).
