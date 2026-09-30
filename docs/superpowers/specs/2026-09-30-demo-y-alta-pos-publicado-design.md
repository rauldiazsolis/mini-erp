# Demo y alta con el POS publicado 0.1.0

Estado: diseño aprobado (2026-09-30). Issue: #9. Epic del POS: rauldiazsolis/offline-pos#166.

## Objetivo

Que el POS **publicado** (`https://offline-pos.pages.dev/0.1.0/`, contrato 4.4.0 con piso 4.0.0) se
use de punta a punta contra el mini-erp sin que el mini-erp figure en el registro del sitio del POS:
un landing en la raíz del mini-erp abre el POS en demo contra este mini-erp; se opera, se hace el alta
en el mini-erp y el POS vuelve configurado contra el comercio nuevo. Primero en localhost; el deploy
es #3.

Fuera de alcance (sigue en #2): `customer-payment-void`, `notices` en el pull y las reglas de
evolución del backend.

## Decisiones

| Pregunta abierta de #9 | Decisión |
|---|---|
| Adónde va el admin | `/admin`. El landing queda en `/` y el alta en `/alta` (como `/ALTA` del POS). `/onboarding` pasa a `/alta`. |
| Vida y limpieza de una demo | 24 h desde el **último uso**. Un barrido en el servidor (al arrancar y cada 15 min) borra las vencidas. Tope de demos vivas. |
| Templates contra presets | Template = preset: `kiosco` (por defecto), `almacen`, `ferreteria`. Catálogo del preset más los clientes demo, sin historial. |
| Alta: comercio nuevo o convertir la demo | **Comercio nuevo**. La demo queda y vence sola. El rubro se preselecciona con el template de la demo. |
| ¿Se deja el flujo viejo (config en la query string)? (#2) | Sí, se va: el POS ya no lo lee. |
| Cómo se sirven landing, admin y alta | Un solo SPA con ruteo por path. |

Enfoques descartados para servir el landing: Vite multi-página (más config y un segundo script de
temas) y HTML armado por Express (fuera del sistema de temas y componentes). Si el peso del bundle
en el landing importa para la web, se separa en #3.

## 1. Rutas, landing y CORS

### Ruteo del cliente

`src/client/state/route-state.ts`: `routeSignal` (`'landing' | 'admin' | 'alta'`), derivado de
`location.pathname`, con `navigate(path)` (`history.pushState`) y escucha de `popstate`.

- `/` → landing; `/admin` (y cualquier subruta) → admin; `/alta` → alta.
- `/onboarding` → `replaceState` a `/alta`, conservando la query.
- Una ruta desconocida muestra el landing.
- `App.tsx` elige la vista por ruta. El admin sigue igual por dentro (login, shell, vistas por
  `activeViewSignal`).
- Los `pushState(null, '', '/')` del alta pasan a navegar a `/admin`.

El servidor no cambia: en desarrollo Vite corre con `appType: 'spa'` y en producción hay fallback
`*` a `index.html`.

### Landing

`src/client/components/landing/LandingView.tsx`: qué es el mini-erp, un botón **"Probar la demo"**,
un link "Entrar al admin" (`/admin`) y el `ThemeToggle`.

- El botón abre, en la misma pestaña,
  `https://offline-pos.pages.dev/<posVersion>/?demo=true&backend=<location.origin>/connector`.
- `posVersion` sale de `contract.json` (hoy `0.1.0`), así `pnpm contract:update` la mueve. La URL la
  arma una función pura `buildDemoUrl(posVersion, origin)`.
- Una nota: mientras el mini-erp corra en `localhost`, Chrome pide permiso de red local la primera
  vez.

### CORS y red privada

- Queda `cors()` con `Access-Control-Allow-Origin: *`. El Connector API usa Bearer y el admin un
  token en header, sin cookies: `*` no expone nada y acepta cualquier POS (pages.dev, un POS local de
  desarrollo, uno autohospedado).
- Middleware nuevo, antes de `cors()`: en un `OPTIONS` con `Access-Control-Request-Private-Network:
  true`, agrega `Access-Control-Allow-Private-Network: true`. Es lo mismo que hace el demo-backend.

## 2. Demos aisladas

### Datos

En `system.sqlite` (esquema de sistema v3; la tabla se crea con `IF NOT EXISTS`, así que una base
existente migra al arrancar):

```sql
CREATE TABLE IF NOT EXISTS demo_sessions (
  tenant_id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
```

Una demo es un tenant común (`demo-<uuid corto>`, nombre "Demo Kiosco", etc.) **sin dueño ni
membresías**, marcado con su fila en `demo_sessions`. Su base es `data/tenants/<id>.sqlite`, como
cualquier tenant.

### Piezas

- **Seeds** (`src/server/seeds/`):
  - `DEMO_TEMPLATES = ['kiosco', 'almacen', 'ferreteria']` y `DEFAULT_DEMO_TEMPLATE = 'kiosco'`.
  - `seedDemoSession(db, template)`: el catálogo del preset (`applyPreset`) más `DEMO_CUSTOMERS` con
    sus saldos iniciales, sin historial (el POS no lo ve).
- **`TenantManager`**:
  - `createTenant` acepta `ownerUserId` opcional; sin él, no crea membresía.
  - `deleteTenant(id)`: cierra la base cacheada, borra `<id>.sqlite`, `-wal` y `-shm`, y en una
    transacción borra las keys, las membresías, la fila de `demo_sessions` y la del tenant. No
    depende de `PRAGMA foreign_keys`.
- **`DemoSessionService`** (`src/server/demo/demo-session-service.ts`), de sistema, en el contenedor
  raíz. Recibe `systemDb`, `TenantManager`, `ApiKeyService`, la config y un reloj
  (`now: () => Date`):
  - `create(template)` crea el tenant, lo siembra, emite una key (`CENTRAL` / `Caja 1`) y registra la
    fila. Devuelve `{ tenantId, apiKey, branch, pointOfSale, template }`.
  - `touch(tenantId)`: `UPDATE demo_sessions SET last_used_at = ? WHERE tenant_id = ?` (en un tenant
    real no hace nada).
  - `sweepExpired()`: borra con `deleteTenant` las demos con `last_used_at` anterior a
    `now - ttl`. Devuelve cuántas borró.
  - `countActive()`.
- **Config** (`src/server/demo/demo-config.ts`), leída del entorno una vez al arrancar:

  | Variable | Por defecto | Qué controla |
  |---|---|---|
  | `DEMO_SESSIONS` | `on` (`off` las apaga) | Si se ofrecen demos |
  | `DEMO_TTL_HOURS` | `24` | Vencimiento desde el último uso |
  | `DEMO_MAX_ACTIVE` | `200` | Tope de demos vivas |
  | `PUBLIC_URL` | origen del request | URL pública del mini-erp (para #3, detrás de un proxy) |

### `POST /connector/demo-sessions`

Se registra en el router del Connector API **antes** de `requirePosAuth`: es el único endpoint sin
key. En orden:

1. `X-POS-Contract-Version` con otro major → `409 { code: 'incompatible-contract', contractVersion }`.
2. Demos apagadas → `404`.
3. Body validado con Zod: `{ template?: string }` con `passthrough`; body vacío vale. Otra forma →
   `400`.
4. Template desconocido → `422 { code: 'unknown-template', templates }`.
5. Barre las vencidas. Si sigue en el tope → `503 { code: 'demo-capacity' }` (fuera del contrato; el
   POS lo muestra como que no pudo arrancar la demo).
6. `201 { apiKey, branch, pointOfSale, template, onboarding: { url, label } }` con
   `url = <origen público>/alta?template=<template>` y `label = 'Crear mi comercio'`. Sin `baseUrl`:
   ausente es "la misma del link". El POS le suma `return_url` y `wipe_key` a esa URL conservando su
   query.

### `GET /info`

Suma `capabilities: ['demo-sessions']` si las demos están prendidas. `contractVersion` sigue en
`4.2.0`: lo que falta de 4.4.0 es #2, y el POS no deduce capacidades de la versión.

### Ciclo de vida

- El middleware de key del POS llama a `demoSessions.touch(tenantId)` en cada request válido: una
  demo en uso no vence.
- `server.ts` barre al arrancar y cada 15 minutos (`setInterval(...).unref()`).
- Una demo vencida desaparece entera; su key da `401` como cualquier key inválida. Volver a abrir el
  link del landing arranca una demo nueva.
- El barrido corre en el mismo hilo que los requests (`DatabaseSync` es síncrono): no hay carrera con
  un request en curso.

### Admin

Las demos no aparecen en la lista de comercios, tampoco para `root` (`listUserTenants` filtra los
tenants con fila en `demo_sessions`). En la web serían cientos.

### Para la web (#3)

Quedan listos el tope, el barrido automático y `PUBLIC_URL`. Siguen en #3: el límite de pedidos por
IP, el apagado del seed de desarrollo fuera de desarrollo y el cierre del alta abierta.

## 3. Alta con `#connect`

### Entrada

`/alta?template=<t>&return_url=<url del POS>&wipe_key=<token>` abre el alta que ya existe
(`MerchantOnboardingView` y `merchant-onboarding-state.ts`), con sus pasos: cuenta (registro o
login), comercio y rubro, aprovisionamiento y listo.

- `template` preselecciona el rubro; uno desconocido se ignora (queda `kiosco`).
- Se leen solo `return_url`, `wipe_key` y `template`. Se sacan los alias viejos (`returnUrl`,
  `redirect_uri`, `wipeKey`, `preset`, `?onboarding=true`, `?view=onboarding` y `#onboarding`).
- El aprovisionamiento no cambia: tenant limpio sin datos demo, preset elegido y key `CENTRAL` /
  `Caja 1`.

### Vuelta

Función pura `buildConnectReturnUrl(returnUrl, connection)` en
`src/client/state/connect-return.ts`:

- `connection = { baseUrl, apiKey, branch, pointOfSale, wipeKey? }`, con
  `baseUrl = location.origin + '/connector'`.
- Devuelve `<return_url>#connect=<base64url(JSON)>`: conserva la query del `return_url` y reemplaza
  el fragmento que tuviera.
- `wipeKey` va solo si vino, tal cual se recibió.
- Devuelve `undefined` si `return_url` no parsea o no es `http:`/`https:`.

### Pantalla final

- Con vuelta: botón **"Volver al POS"** con el host de destino a la vista ("Vas a volver a
  offline-pos.pages.dev") y "Ir al panel". Sin redirección automática: el `return_url` lo trae el
  link, y el usuario ve adónde manda su conexión antes de hacerlo.
- Sin vuelta: solo "Ir al panel".
- Se van el armado viejo en la query string y "Compartir por WhatsApp" (mandaba la key en un link).
- "Volver a la App" e "Ir al panel" navegan a `/admin`.

## Tests (TDD, Vitest)

- **Servidor**:
  - Preflight con y sin `Access-Control-Request-Private-Network`.
  - `DemoSessionService` con `TenantManager` en memoria y reloj falso: crea y siembra por template,
    `touch` corre el vencimiento, el barrido borra solo las vencidas, el tope.
  - `deleteTenant` con archivos reales en una carpeta temporal.
  - Rutas con supertest: `201`, `422`, `404` apagado, `409`, `400`, `503`; `/info` con y sin la
    capacidad; la key de la demo sincroniza (`pull` con el catálogo del template); las demos fuera de
    `listUserTenants`.
- **Cliente**:
  - `route-state`: path a ruta, `/onboarding` a `/alta`.
  - `buildDemoUrl`.
  - `buildConnectReturnUrl`: ida y vuelta, sin `wipeKey`, query conservada, fragmento reemplazado,
    esquemas inválidos.
  - La lectura de la URL del alta: template válido o desconocido, `return_url` y `wipe_key`.
  - El test de onboarding existente, ajustado.

## Prueba de punta a punta

El mini-erp con `pnpm dev` y el POS publicado 0.1.0 en Chrome:

1. Landing → "Probar la demo" → el POS arranca en demo (marca DEMO). Chrome pide permiso de red
   local.
2. Vender algo.
3. `/ALTA` → alta en el mini-erp → "Volver al POS".
4. El POS queda configurado contra el comercio nuevo: sin DEMO y sin la venta de práctica.
5. En el admin (`/admin`), el comercio nuevo con la venta hecha después de volver. La demo sigue en
   `demo_sessions` y fuera de la lista.

Con capturas del recorrido para el informe.

## Documentación

- README: rutas (`/`, `/admin`, `/alta`, `/connector`), variables `DEMO_*` y `PUBLIC_URL`, cómo
  probar la demo en local.
- AGENTS.md: contrato implementado "4.2.0 más la capacidad `demo-sessions` de 4.4.0", la arquitectura
  de demos y el ruteo del cliente.
- PLAN.md: la fase nueva.
- Después del merge: tildar el ítem en rauldiazsolis/offline-pos#166.

## Addendum: POS híbrido y e2e (aprobado el 2026-09-30)

La prueba de punta a punta con el POS publicado contra el mini-erp en `localhost` solo anda en Chrome
con el permiso de red local (página pública → red local); el navegador integrado de la app de Claude la
bloquea sin preguntar (`net::ERR_BLOCKED_BY_CLIENT`). Para que el recorrido sea repetible y
automatizable:

- **En desarrollo**, el mini-erp sirve una copia local del POS publicado en `/pos/<versión>/`
  (mismo origen: sin CORS ni permiso de red local) y el landing la abre. `pnpm pos:mirror [versión]`
  la baja de la carpeta publicada (nunca de `main`) a `vendor/pos/<versión>/`, ignorada por git, y
  `pnpm dev` la baja sola si falta (sin red, avisa y sigue). La copia se arma en una carpeta temporal
  y se mueve al final, así nunca queda a medias.
- **En producción**, el landing abre `https://offline-pos.pages.dev/<versión>/`: la demo pública
  sigue probando la integración real. Con el mini-erp en `https:` público no hay mezcla con la red
  local.
- **Descartado**: servir el POS desde el mini-erp también en producción. Dejaría de probar que el POS
  publicado anda con un backend que no conoce, ataría los datos locales del POS al dominio del
  mini-erp y obligaría a redeployar el mini-erp con cada versión del POS.
- **e2e con Playwright** (solo Chromium, como offline-pos): `DATA_DIR` nueva para una base
  descartable; `pnpm test:e2e` levanta el mini-erp en el puerto 4110 y recorre landing → demo →
  venta → `/ALTA` → alta → vuelta, verificando en la base que la venta de práctica queda en la demo y
  la nueva llega al comercio nuevo. Corre en el CI.
- La coordinación de versiones entre el POS instalado y el backend quedó fuera:
  rauldiazsolis/offline-pos#172.
