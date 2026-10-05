# M9 · Funnel: seguimiento de punta a punta y contactos (#25)

Etapa M9 del MVP (epic #17). Parte de la spec del MVP (`2026-10-01-mvp-mini-contax-design.md`,
"Funnel", "Demos" y "Alta y carga inicial") y de la de M8 (`2026-10-05-m8-demos-v2-design.md`), que
dejó `demo_sessions.id` como el id de visitante.

## Contexto

- `demo_sessions` (`system.sqlite`, nunca se borra) tiene una fila por demo: id aleatorio, rubro,
  comercio, caja, fechas y revocación. Nada guarda IP ni navegador.
- `onboarding.url` lo arma mini al crear la demo (hoy `/alta?template=<rubro>`); el POS le **agrega**
  `return_url` y `wipe_key`. La vuelta va en `#connect`, con una forma fija del contrato
  (`baseUrl, apiKey, branch, pointOfSale, wipeKey?`).
- `POST /demo-sessions` no lleva nada del landing: el POS solo manda `template`.
- El reinicio total vacía el comercio demo cada noche: las ventas de las demos no quedan.
  `anonymous_sessions` se borra al revocar la caja.
- El portal (`/MINI`) ya abre el admin del comercio demo desde el POS: es el paso "Mini desde el POS".
- El alta crea cuenta y comercio en un solo `POST /api/alta`.
- El contrato no cambia: implementamos 4.6.0.

## Decisiones

| Tema | Decisión |
|---|---|
| Id de visitante | `demo_sessions.id`. Sin demo, el visitante es el contacto del landing o el comercio. |
| Ida al alta | `onboarding.url` = `/alta?template=<rubro>&demo=<id>`; también el "Crear mi comercio" de la franja de la demo y de "Esta demo terminó". |
| Liga comercio–demo | En el servidor: `POST /api/alta` con `demoSessionId` → `tenants.demo_session_id`. El `#connect` no cambia. |
| Demo revocada que va al alta | Se liga igual (la fila nunca se borra). |
| Dos demos de la misma persona | Dos visitantes (unirlos pediría contrato; afuera). |
| Landing | Totales anónimos por día (visitas, clics en "Probar la demo", altas abiertas sin demo). Sin id ni cookie. |
| Enfoque | Híbrido: se registra lo que se pierde (`funnel_events`) y se infiere lo que ya existe. |
| Embudo | Cohorte por inicio del visitante; cada etapa cuenta a los que llegaron, en cualquier fecha. |
| Cuenta | No es etapa (coincide siempre con Comercio); se muestra en la historia. |
| Contacto | En la franja de la demo, en "Esta demo terminó" y en el landing. Nombre y WhatsApp. Uno por demo. |
| Contacto desde el POS | Por el portal (`/MINI` → franja): sin cambio de contrato. |
| Panel | Secciones **Embudo** y **Visitantes** del menú de plataforma, para root y soporte. |
| Retención | Eventos 24 meses; nombre y WhatsApp de contactos sin alta, 12 meses. Totales del landing, sin vencimiento. |

## Etapas

| # | Etapa | Fuente | Cuándo |
|---|---|---|---|
| — | Landing | `funnel_daily` (`landing`, `demo-click`) | Beacon al cargar el landing (uno por pestaña) y al tocar "Probar la demo". |
| 1 | Demo | `demo_sessions.created_at` | Inferida. |
| 2 | Venta demo | evento `demo-sale` | La primera venta que no es anulación de una caja de visitante, en el push. |
| 3 | Mini desde el POS | evento `portal-opened` | El primer canje del portal con una caja de demo. |
| 4 | Contacto | `funnel_contacts.created_at` | Inferida. |
| 5 | Alta | evento `alta-opened` (o, si falta, la fecha del comercio) | Beacon de `/alta` con `?demo=`. Sin demo suma `alta-open` en `funnel_daily`. Un comercio implica el alta. |
| 6 | Comercio | `tenants.created_at` con `demo_session_id` | Inferida. La cuenta (`users.created_at` del titular) va en la historia. |
| 7 | Carga | evento `catalog-loaded` (`data.source`: `import-products`, `import-customers`, `example`) | La primera importación confirmada (no la vista previa) o el catálogo de ejemplo. |
| 8 | Venta real | el primer `charges.created_at` del comercio | Inferida. |
| 9 | Pago | el primer `paid_movements` `kind = 'payment'` del titular desde que nace el comercio | Inferida. |

- **Una vez**: cada tipo de evento se registra a lo sumo una vez por demo (`demo-sale`,
  `portal-opened`, `alta-opened`) o por comercio (`catalog-loaded`), con un índice único parcial.
  "Una vez" no depende de quién llama.
- **Registrar nunca falla lo de fondo**: el push, el canje, la importación y el alta no fallan si el
  evento no se puede escribir (try/catch con log `[embudo] …`). En el push se registra después de
  aplicar el lote (el evento va a `system.sqlite`, el lote a la base del comercio).
- **Rubro**: el de la demo; sin demo, el `business_type` del comercio; un contacto del landing,
  "sin rubro".

## Modelo de datos (migración de sistema v11)

- `tenants.demo_session_id` (`TEXT`, nullable, con índice).
- **`funnel_events`**: `id` PK, `type`, `demo_session_id` (nullable), `tenant_id` (nullable),
  `at`, `data` (JSON chico, nullable). Índices únicos parciales `(demo_session_id, type)` para los de
  demo y `(tenant_id, type)` para `catalog-loaded`; índice por `at`.
- **`funnel_daily`**: `day` (día argentino), `kind` (`landing`, `demo-click`, `alta-open`), `count`;
  PK `(day, kind)`.
- **`funnel_contacts`**: `id` PK, `demo_session_id` (nullable, único cuando no es nulo), `source`
  (`demo`, `demo-ended`, `landing`), `name` y `whatsapp` (nullable tras borrarse), `created_at`,
  `updated_at`, `handled_at`, `handled_by` (usuario), `erased_at`.
- Sin IP, navegador ni cookies en ninguna tabla.

## Servidor

- **`FunnelService`** (`src/server/funnel/`, de sistema, reloj inyectable):
  - `record(type, { demoSessionId?, tenantId?, data? })`: `INSERT … ON CONFLICT DO NOTHING`; ignora
    un `demoSessionId` que no está en `demo_sessions`.
  - `bump(kind)`: suma 1 al día argentino.
  - `saveContact({ name, whatsapp, source, demoSessionId? })`: un contacto por demo (si existe,
    actualiza nombre, WhatsApp y `updated_at`, y vuelve a "sin atender"); sin demo o con una
    desconocida, una fila nueva sin demo.
  - `markHandled(contactId, userId)`.
  - `sweep()`: retención (abajo).
- **Puntos de registro**:
  - push (`connector-routes`): con una caja de visitante (`activeSessionOfRegister`) y alguna venta
    que no es anulación en el lote → `demo-sale`;
  - canje del portal con una caja de demo → `portal-opened`; la respuesta del canje suma
    `demoSessionId`;
  - importación confirmada y `POST /catalog/example` → `catalog-loaded` (nunca en comercios demo);
  - `POST /connector/demo-sessions`: `onboarding.url` con `&demo=<id>`;
  - `POST /api/alta` acepta `demoSessionId` opcional; `AltaService` lo guarda si existe.
- **Rutas públicas** (`routes/funnel-routes.ts`, bajo `/api/funnel`):
  - `POST /beacon { kind: 'landing' | 'demo-click' | 'alta-open', demoSessionId? }`: con
    `alta-open` y una demo conocida registra `alta-opened`; si no, suma al día. Siempre `204`, aun
    con datos malos. Límite por IP en memoria (`BEACON_RATE_LIMIT`, 60 por hora; pasado, `204` sin
    contar).
  - `POST /contacts { name, whatsapp, source, demoSessionId? }`: nombre de 2 a 80 caracteres,
    WhatsApp con `normalizeWhatsapp` y `WHATSAPP_MESSAGE` (esquema compartido en
    `src/shared/funnel-contact.ts`); `400` con el mensaje, `429` con `Retry-After`
    (`CONTACT_RATE_LIMIT`, 5 por hora por IP), `201` al guardar.
- **Plataforma** (`routes/platform-funnel-routes.ts`, bajo `/api/platform`,
  `requirePlatformRole('root', 'support')`, en `test/platform-permissions.test.ts`):
  - `GET /funnel?desde=&hasta=&rubro=`: totales del landing y la tabla de etapas por rubro.
  - `GET /visitors?desde=&hasta=&rubro=&etapa=&filtro=&q=`: la lista.
  - `GET /visitors/:id`: la historia (`id` = el de la demo, `c-<contacto>` o `t-<comercio>`).
  - `POST /contacts/:id/handled`: audita `funnel.contact-handled`.
  - `GET /contacts/pending-count`: el contador del menú.
- **`FunnelQueryService`** (de sistema): arma visitantes uniendo `demo_sessions`, `funnel_contacts`
  sin demo y `tenants` sin demo (nunca los comercios demo), con sus etapas de las fuentes de la tabla
  de arriba. El inicio de un visitante es su demo, su contacto o su comercio; el rango filtra por
  inicio (días argentinos). Tipos en `src/shared/funnel-types.ts`.

## Cliente

- **Landing**: beacon `landing` al cargar (una vez por carga de la página, en memoria: solo `auth-state`
  toca `sessionStorage`) y `demo-click` al tocar "Probar la demo" (`fetch` con `keepalive`); link "¿Querés que te ayudemos a empezar?" que abre
  el modal de contacto (`source: 'landing'`).
- **Alta** (`merchant-onboarding-state`): lee `demo` de la query, manda el beacon `alta-open` una vez
  por carga y `demoSessionId` en el `POST /api/alta`.
- **Demo**: el canje guarda `demoSessionId` en el estado anónimo (`sessionStorage`, solo
  `auth-state`). `DemoBar` suma "¿Querés que te ayudemos a empezar?" y su "Crear mi comercio" lleva
  `&demo=`; `DemoEndedView`, lo mismo (`source: 'demo-ended'`). Después de enviar: "Listo, te
  escribimos por WhatsApp" y la pestaña lo recuerda en memoria.
- **Modal de contacto** (`components/funnel/ContactModal.tsx`, por `Modal`): nombre y WhatsApp,
  validados con el esquema compartido.
- **Plataforma**: secciones `funnel` (Embudo) y `visitors` (Visitantes) en `PLATFORM_SECTIONS` y
  `platformNavItems`, después de Demos, para root y soporte; la historia en
  `/plataforma/visitantes/<id>` marca Visitantes. Filtros en la URL con `setPlatformFilters`; datos
  con TanStack Query e `invalidateAfter('platform-changed')`.
  - **Embudo** (por omisión los últimos 30 días): arriba los totales del landing; una tabla con una
    fila por etapa y columnas total, kiosco, almacén, ferretería y otro o sin rubro; cada celda con
    la cantidad, el % sobre la etapa anterior y una barra (CSS). Cada cantidad lleva a Visitantes
    filtrado por cohorte, etapa y rubro. Nota: "Las cohortes recientes siguen avanzando".
  - **Visitantes**: una fila por visitante (inicio, rubro, etapa más avanzada, contacto, comercio con
    link a su detalle, estado del contacto). Filtros "Todos", "Con contacto", "Contactos sin
    atender" (todos, sin rango de fechas) y "Con alta", y búsqueda por nombre, WhatsApp, comercio o caja (`Demo AB12`). El menú
    muestra el contador de contactos sin atender.
  - **Historia**: línea de tiempo con cada etapa y su fecha y hora; la caja de la demo y su
    revocación (motivo y fecha); el contacto con "Escribir por WhatsApp"
    (`wa.me/<dígitos>?text=Hola <nombre>, te escribo de mini contax…`, pestaña nueva) y "Marcar
    atendido"; el comercio con su titular, cuándo nació la cuenta y el link a su detalle.

## Privacidad y retención

- Sin IP completas, navegador, cookies nuevas ni analíticas de terceros. Los límites por IP siguen en
  memoria.
- El id de la demo viaja en la query de `/alta`: no da acceso a nada, solo liga un alta o un contacto.
- **Barrido** (`startFunnelSweeper`, al arrancar y cada 15 minutos, aunque las demos estén apagadas):
  borra los `funnel_events` de más de 24 meses y, a los contactos sin cambios en más de 12 meses (`updated_at`) y sin un comercio
  ligado a su demo, les borra nombre y WhatsApp (`erased_at`; en el panel, "Contacto borrado por
  antigüedad"). Loguea `[embudo] barrido: …` cuando hace algo.

## Variables

| Variable | Por defecto | Qué es |
|---|---|---|
| `CONTACT_RATE_LIMIT` | 5 | Contactos por hora y por IP (`429`). |
| `BEACON_RATE_LIMIT` | 60 | Beacons por hora y por IP (pasado, no cuentan). |

## Pruebas

- Migración de sistema v11 con datos (`createDbAtVersion`, `HASTA_V11`).
- `FunnelService`: una vez por tipo, demo desconocida, día argentino, contacto único por demo,
  atendido, barrido con reloj inyectable.
- Alta ligada (demo vigente, revocada, desconocida); `onboarding.url` con `demo=`; canje con
  `demoSessionId`.
- Push: `demo-sale` solo con caja de visitante, solo la primera, nunca con anulaciones ni en
  comercios reales; un error al registrar no cambia la respuesta.
- Carga: importación confirmada (no la vista previa) y catálogo de ejemplo.
- `FunnelQueryService`: cohorte, cada etapa inferida, rubro, filtros, búsqueda e historia.
- Rutas públicas (validación, límites, `204` siempre en beacons) y permisos de plataforma.
- **e2e del criterio de aceptación** (POS local): el landing abre la demo del kiosco y vende →
  `/MINI` y contacto desde la franja → `/ALTA` desde el POS, alta y vuelta con `#connect` → el POS con
  la caja real vende → root ve en Visitantes una sola historia (demo, venta demo, mini desde el POS,
  contacto, alta, comercio, venta real) y en Embudo cada una de esas etapas sube en 1 respecto de lo
  que mostraba antes del recorrido (Carga incluida, por el catálogo de ejemplo; Pago no cambia). Como otros e2e crean demos en paralelo, cada etapa sube al menos 1.

## Afuera (backlog)

- Unir dos demos de la misma persona (pide contrato).
- Aviso activo a soporte por un contacto nuevo.
- Exportar el embudo.
