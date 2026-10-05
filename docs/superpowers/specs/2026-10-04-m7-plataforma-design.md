# M7 · Plataforma: soporte, impersonación de usuario y pedidos de ayuda (#23, con #16 y #68)

Etapa M7 del MVP (epic #17). Parte de la spec del MVP
(`2026-10-01-mvp-mini-contax-design.md`, "Roles" e "Impersonación de usuario") y de la de #59
(`2026-10-04-router-query-design.md`, "Comercio activo" y "Listo para M7").

## Contexto

- Root y soporte son owners implícitos de todos los comercios: `AuthService.listUserTenants` les
  devuelve todos como `root_impersonator`/`support_impersonator` y `MembershipService.resolveRole`
  les da `owner` (#16, punto 1).
- La impersonación de hoy es de comercio y solo del cliente (`impersonationSignal`, modal y franja en
  memoria).
- Las acciones de cobro de plataforma (pago, regalados, gracia, titular, devolución) viven dentro de
  Uso y pagos del comercio (`PlatformActionsBar`) y dependen de esa membresía implícita.
- `tenants.status = 'suspended'` existe pero nada lo hace cumplir; `users` no tiene estado;
  `invitations` y `password_resets` exigen `tenant_id`.
- `supportWhatsapp` ya está en `billing_settings` (M5).
- #68 pasa **dentro de una pestaña** (logout y login al mismo comercio): cada pestaña tiene su
  `QueryClient` en memoria, así que entre pestañas no se filtra nada por construcción.

## Decisiones

| Tema | Decisión |
|---|---|
| Partición | Dos PR. **M7a** (aditivo, no saca nada): #68, panel de plataforma, suspensión, usuarios desactivados, soporte por invitación. **M7b**: impersonación de usuario por pestaña, root y soporte sin membresía (#16), pedidos de ayuda y el e2e de dos pestañas. |
| Suspender un comercio | Corta el admin del comercio; el POS sigue vendiendo y sincronizando; no hay cargos de los días suspendidos. |
| Acciones de cobro | Solo en el panel (detalle de comercio). Una pestaña que impersona ve exactamente lo que ve el usuario. |
| Transparencia | El usuario ve su pedido abierto y los accesos de soporte a su cuenta de los últimos 7 días (por pedido o libres), y un aviso mientras soporte está adentro. |
| Sesión de impersonación | Una fila más de `sessions`, con su impersonador: un token Bearer propio. `req.user` es el usuario impersonado; `req.impersonator`, quien impersona. |

Descartados para la sesión: el token de soporte con una cabecera `X-Impersonate-User` (el token con
todo el poder viaja en cada pestaña y una pestaña cambia de usuario cambiando la cabecera) y un token
firmado sin estado (no se revoca con "Salir" ni con el logout de soporte).

---

## M7a · Panel de plataforma, soporte y suspensión

### Datos (migración de sistema v7)

- `users.status TEXT NOT NULL DEFAULT 'active'` (`active` | `disabled`).
- `staff_invitations`: `id`, `email`, `token_hash` (único), `created_by`, `created_at`,
  `expires_at`, `accepted_at`, `accepted_by`, `revoked_at`. Invitación de soporte, sin comercio.
- `password_resets.tenant_id` acepta `NULL` (restablecimiento generado desde la plataforma): la
  migración reconstruye la tabla y copia las filas.
- `tenant_suspensions` (`tenant_id`, `from_at`, `to_at`, `reason`, `created_by`): los períodos de
  suspensión, para que el cargo diario sepa qué días saltear.
- `audit_log.impersonator_user_id TEXT` (vacía hasta M7b; así la migración de auditoría es una).
- Índice `idx_audit_at` sobre `audit_log (at)` para el registro de plataforma.

### Reglas

- **Comercio suspendido**: `403 { error, code: 'tenant-suspended' }` en `/api/tenants/:tenantId`,
  salvo exportar y `billing-status`. Va en `requireTenantContext`, después de resolver el rol. El
  Connector API no cambia. El cargo diario (push y barrido de `BillingService`) se saltea los días en
  que el comercio estuvo suspendido (algún momento del día argentino dentro de un período de
  `tenant_suspensions`). Suspender y reactivar piden motivo y se auditan
  (`tenant.suspended`, `tenant.reactivated`).
- **Usuario desactivado**: el login responde "Cuenta desactivada", se cierran sus sesiones y
  `validateSession` no lo acepta. Nadie desactiva a un root ni a sí mismo; desactivar o reactivar a
  soporte es solo de root; soporte desactiva usuarios `user`. Auditoría: `user.disabled`,
  `user.enabled`.
- **Soporte por invitación** (solo root): link de un solo uso, 48 h, en `/invitacion#t=…` con el
  texto "Te invitaron al equipo de soporte de mini contax". Aceptar con un mail nuevo crea la cuenta
  con `global_role = 'support'`; con un mail existente sin membresías, la promueve (pide su
  contraseña); con membresías, `409` ("Esa cuenta es de un comercio: usá otro mail"). Revocar y
  desactivar soporte, solo root. Auditoría: `staff.invited`, `staff.invitation_revoked`,
  `staff.joined`.
- **Restablecimiento desde la plataforma**: root y soporte generan el link para cualquier usuario
  `user` (no para root ni soporte); `tenant_id` queda vacío. Auditoría `password.reset_link_created`.

### Rutas (`/api/platform`, `requirePlatformRole`)

| Ruta | Rol |
|---|---|
| `GET /tenants?q=` | root, soporte |
| `GET /tenants/:tenantId` (resumen de créditos, miembros, estado) | root, soporte |
| `POST /tenants/:tenantId/suspend`, `POST /tenants/:tenantId/reactivate` | root, soporte |
| `GET /users?q=` | root, soporte |
| `POST /users/:userId/disable`, `POST /users/:userId/enable` | root, soporte (soporte, solo `user`) |
| `POST /users/:userId/password-reset` | root, soporte |
| `GET /staff`, `POST /staff/invitations`, `DELETE /staff/invitations/:id` | root |
| `POST /staff/:userId/disable`, `POST /staff/:userId/enable` | root |
| `GET /audit?tenantId=` | root, soporte |
| Las de cobro y configuración de hoy | sin cambios |

Tipos en `src/shared/platform-types.ts`. Las consultas del panel son de sistema (`PlatformQueryService`,
contenedor raíz); el estado de créditos de cada comercio sale de `BillingService`.

### Cliente

Solapas de `/plataforma`: **Comercios** (`/plataforma`, por defecto), **Usuarios**
(`/plataforma/usuarios`), **Pedidos** (M7b), **Cobranzas** (`/plataforma/cobranzas`), **Soporte**
(`/plataforma/soporte`, root), **Registro** (`/plataforma/registro`) y **Configuración**
(`/plataforma/configuracion`, root). Filtros (`q`, `comercio`) en la URL con códecs propios.
Cobranzas deja de ser la solapa por defecto: `/plataforma` pasa a ser Comercios.

- **Comercios**: nombre, titular, estado, estado de créditos, cantidad de usuarios y alta. El
  detalle `/plataforma/comercios/<slug>` muestra el resumen de créditos (los mismos componentes de Uso
  y pagos, con datos de la ruta de plataforma), `PlatformActionsBar` (se muda desde Uso y pagos, que
  la pierde), los miembros y "Suspender" o "Reactivar".
- **Usuarios**: nombre, mail, WhatsApp, comercios con rol, estado; desactivar o activar y "Link de
  restablecimiento" (se copia, como en Usuarios del comercio).
- **Soporte**: el equipo y las invitaciones pendientes; invitar, revocar, desactivar.
- **Registro**: la auditoría de toda la plataforma, con filtro por comercio.
- **Comercio suspendido**, para sus usuarios: el shell muestra "Este comercio está suspendido.
  Escribile a soporte." en lugar de la sección (Uso y pagos y exportar siguen).

### #68

`createSignalQuery` usa el placeholder solo si la consulta anterior sigue en la caché
(`queryClient.getQueryCache().find({ queryKey: previousQuery.queryKey, exact: true }) === previousQuery`).
Test en `test/signal-query.test.ts`: con datos de un comercio, `clear()` y la misma clave con otro
token, `data` arranca en `undefined` hasta que llega el pedido.

### Lo que M7a no cambia

La membresía implícita de root y soporte y el modal de impersonación de comercio: el root no pierde
acceso entre los dos PR.

---

## M7b · Impersonación de usuario, #16 y pedidos de ayuda

### Sesión (migración de sistema v8)

- `sessions` suma `impersonator_user_id`, `parent_token`, `help_request_id`, `tenant_id` y
  `last_used_at`.
- `POST /api/impersonations` con `{ userId, tenantId? }` o `{ helpRequestId }`: solo con una sesión
  propia de root o soporte (nunca desde una impersonación). Responde
  `{ token, user, impersonator, tenantSlug, path }`.
- `DELETE /api/impersonations/current`: "Salir".
- **Vencimiento**: 2 h sin uso. `validateSession` la rechaza (y la borra) si `last_used_at` tiene más
  de 2 h y la actualiza a lo sumo una vez por minuto. Muere también si no existe más la sesión padre
  (logout, desactivación o vencimiento de soporte). Reloj inyectable.
- **A quién**: cuentas `user` activas con al menos una membresía activa; con `tenantId`, miembro
  activo de ese comercio. Nunca root, soporte, desactivados ni demos. Un comercio suspendido o
  restringido por deuda se puede impersonar y no bloquea a quien impersona (como hoy).
- `req.user` es el usuario impersonado y `req.impersonator = { id, name, globalRole }`: permisos,
  rol y rutas son los de ese usuario, sin más ni menos.

### Lo que no puede quien impersona

`403 "No disponible mientras ves como otro usuario"` (`requireOwnSession`):

- Cambiar la contraseña (`POST /auth/password`). Cambiar el mail, cuando exista, también.
- Nombrar owners: invitar como owner o cambiar el rol o el estado de un owner.
- Generar links de restablecimiento desde el comercio (se hace desde el panel).
- Crear comercios o aceptar invitaciones.
- Cualquier ruta de `/api/platform` y `POST /api/impersonations`.

### Auditoría

- `AuditLog.record` recibe `impersonatorUserId`; las rutas pasan a armar el actor con un helper
  `auditActor(req)` (`{ actorUserId, impersonatorUserId }`), así ninguna se olvida.
- Eventos nuevos: `impersonation.started` (con `helpRequestId` si lo hubo) e `impersonation.ended`
  (`reason`: `exit` | `expired` | `parent-ended`; el vencimiento se registra al detectarlo).
- La lectura devuelve `impersonatorName`; Actividad y Registro muestran "Ana (soporte) como Juan".

### Root y soporte sin membresía (#16)

- `listUserTenants` y `resolveRole` miran solo membresías reales. Se borran `root_impersonator`,
  `support_impersonator`, `MembershipRole` y `effectiveTenantRole`.
- `/admin` pelado de root o soporte sin comercios lleva a `/plataforma`, no a "Crear mi comercio".
- "No tenés acceso" para root y soporte suma "Ver este comercio en la plataforma" (al detalle).
- Se borran `ImpersonationModal`, `impersonateTenant`, `stopImpersonation` y la franja vieja.

### Cliente

- **Token por pestaña**: `auth-state` lee primero `sessionStorage` (`mini_erp_impersonation`:
  `{ token, user, impersonator, tenantSlug }`) y después `localStorage`. Solo `auth-state` toca
  `sessionStorage` (guardián en `test/client-guards.test.ts`).
- Una pestaña que impersona **nunca escribe** `localStorage` (ni el token ni el último comercio).
- Un 401 en esa pestaña borra solo el `sessionStorage` y muestra "La sesión como Juan terminó" con un
  botón a `/plataforma`; la sesión de soporte sigue.
- **Entrar**: "Entrar como" (Usuarios y miembros del detalle de comercio) hace
  `window.open('/plataforma/entrar?usuario=<id>&comercio=<slug>', '_blank', 'noopener')`. La pestaña
  nueva pide la impersonación con el token de `localStorage` (sin sesión, el login en la misma URL),
  guarda la respuesta en su `sessionStorage` y reemplaza la URL por `/admin/<slug>/dashboard`.
  `noopener` evita que herede el `sessionStorage` de quien la abrió.
- **Franja** fija: "Estás viendo como Juan (owner de Kiosco X) · Salir". Mientras la pestaña
  impersona no se ven Plataforma, "Pedir ayuda" ni "Cambiar contraseña"; el selector lista los
  comercios del usuario.
- **Salir**: `DELETE /impersonations/current`, borra el `sessionStorage` y `window.close()`; si el
  navegador no la cierra, navega a `/plataforma`.
- Dos pestañas que impersonan tienen tokens, comercios y caché distintos; lo único compartido es el
  `localStorage` de soporte, que ninguna escribe. Un logout de soporte en otra pestaña se nota en el
  próximo pedido (401). Sin listener de `storage`.

### Pedidos de ayuda

- Tablas (en la v8): `help_requests` (`id`, `tenant_id`, `user_id`, `path`, `message`,
  `created_at`, `expires_at` = +24 h, `closed_at`) y `help_request_takes` (`request_id`,
  `staff_user_id`, `at`).
- **Usuario**: "Pedir ayuda" en la cabecera (no en demos, no impersonando, no sin `supportWhatsapp`)
  abre un modal con un texto opcional (hasta 500). `POST /api/tenants/:tenantId/help-requests`
  (`tenant.use`, con `path` validado contra las rutas del admin) crea el pedido, cierra el abierto
  anterior del mismo usuario y devuelve el link `https://<host>/ayuda/<id>`. El cliente abre
  `https://wa.me/<supportWhatsapp>?text=…` con "Hola, soy Juan de Kiosco X. <mensaje> <link>".
- El modal muestra el pedido abierto y los **accesos de soporte de los últimos 7 días** a su cuenta
  ("Soporte (Ana) entró a las 10:32 por tu pedido" / "… entró a las 15:10"). Mientras haya una
  impersonación viva sobre su cuenta, la cabecera muestra "Soporte está viendo tu cuenta". Todo sale de
  `GET /api/me/support-access`: al entrar, al volver a la pestaña y cada 60 s con el modal abierto.
- **Soporte**: `/ayuda/<id>` exige una sesión propia de root o soporte (sin sesión, login en la misma
  URL; con otro rol, "Este link es para soporte"). Un pedido vigente crea la impersonación con
  `helpRequestId` (registra la toma) y reemplaza la URL por `/admin/<slug>/<path>`. Vencido o
  cerrado: "Este pedido venció", con un botón a Usuarios del panel.
- Solapa **Pedidos** (`/plataforma/pedidos`): abiertos y tomados de las últimas 48 h (quién,
  comercio, pantalla, mensaje, hace cuánto, quién lo tomó). "Atender" abre `/ayuda/<id>` en otra
  pestaña. Sin conversación ni cierre manual.

---

## Tests

### M7a

- `test/signal-query.test.ts` (#68).
- Migración v7 con datos (`createDbAtVersion`): usuarios, restablecimientos con comercio y auditoría
  sobreviven.
- Suspensión: 403 salvo exportar y `billing-status`, Connector API igual, sin cargos de días
  suspendidos. Usuarios desactivados: login, sesiones, quién desactiva a quién. Invitación de
  soporte: cuenta nueva, promoción y 409. Listados y detalle del panel.
- `test/permissions-api.test.ts` suma las rutas de `/platform` con su rol.
- Cliente: rutas y solapas del panel en `admin-routes`, el detalle con la barra de cobro, Uso y pagos
  sin la barra y la vista de suspendido.
- e2e `e2e/platform.spec.ts`: root invita a soporte, soporte entra, suspende un comercio y el owner ve
  "suspendido"; reactiva; desactiva un usuario que después no puede entrar.

### M7b

- Sesión: crear, vencer a las 2 h, salir, morir con la padre, a quién no, cada restricción con su
  403, auditoría con los dos nombres, #16 en servidor, pedidos (crear, vencer, dos tomas, accesos de 7
  días). Migración v8 con datos.
- Cliente: token por pestaña, 401 que no toca `localStorage`, `/admin` de soporte a `/plataforma`,
  franja, modal de ayuda, guardián de `sessionStorage`.
- e2e `e2e/support-tabs.spec.ts` (criterio de aceptación), un contexto con dos páginas que comparten
  `localStorage`: dueño A (Kiosco) y dueño B (Ferretería) piden ayuda; soporte abre los dos links en
  dos pestañas; cada una muestra su franja y su comercio; se recargan y se navega intercalado sin que
  se pisen; una sale y la otra sigue; dueño A ve "Soporte entró a las …"; Actividad del Kiosco muestra
  "Soporte como Dueño A"; root en `/admin` no ve comercios ajenos y cae en `/plataforma`.

## Cierre

- **M7a**: rama `claude/m7-plataforma`, versión 0.12.0, AGENTS.md (panel, suspensión, usuarios
  desactivados, soporte), informe con prueba manual. El PR no cierra #23 (lo menciona como parte 1).
- **M7b**: rama `claude/m7-impersonacion` desde `main` después del merge de M7a, versión 0.13.0,
  AGENTS.md, informe, PR con `Closes #23` y `Closes #16` (los puntos 2 y 3 los resolvió M1).
- Un plan por PR; el de M7b se escribe después del merge de M7a. Cada plan se borra en su PR.

## Fuera de alcance

- Cambiar el mail de un usuario (la regla de impersonación queda escrita para cuando exista).
- Borrar comercios y reiniciar producción desde el panel, demos y funnel en el panel (M8 y M9).
- Conversación en los pedidos de ayuda.
