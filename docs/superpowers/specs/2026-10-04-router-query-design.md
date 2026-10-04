# Navegación con router y datos con TanStack Query en el admin (#59, con #55)

Fecha: 2026-10-04. Issues: rauldiazsolis/mini-erp#59 y rauldiazsolis/mini-erp#55 (antes de M7, #23;
orden de #17: #51 → **#59** → #56 → #6). Versión: 0.11.0.

## Contexto

En el admin los datos no se refrescan bien al cambiar de comercio o de pantalla (#59). Así está hoy:

- **Carga**: cada store de `src/client/state/` decide con un `effect` propio cuándo pedir. Recargan al
  cambiar de comercio dashboard, discrepancias, sucursales, cajas y el estado de créditos; al entrar a
  la pantalla, ventas, usuarios, créditos, plataforma y el catálogo de ejemplo; catálogo, clientes y
  stock en los dos casos (`state/view-loader.ts`, arreglo de M6). Nada recarga después de una
  mutación hecha en otra pantalla (importar, operaciones masivas, cobranzas). Las sucursales se piden
  en tres stores y las cajas en dos.
- **Navegación**: la pantalla es un signal (`activeViewSignal`, `navigateTo` desde 6 lugares) y
  `state/route-state.ts` solo distingue landing, `/admin`, `/alta` y los links. Cinco pantallas
  tienen solapas en signals sueltos. No hay atrás y adelante ni links directos.
- **Comercio activo**: en `localStorage` (`mini_erp_tenant_id`); la impersonación, solo en memoria.
  El slug del comercio es único, no se puede cambiar y hoy siempre es igual al id (el alta lo arma
  del nombre y desambigua con `-2`, `-3`).
- **TanStack Query** (`@tanstack/query-core`) está instalado; `api/query-client.ts` tiene
  `createSignalQuery` sin uso.
- El servidor ya devuelve `index.html` en cualquier ruta (`client-middleware.ts`).

M7 necesita que el comercio sea de la pestaña y que el pedido de ayuda abra "ese comercio y esa
pantalla" en una pestaña nueva: las dos cosas se apoyan en tener comercio y pantalla en la URL.

## Decisiones

1. **La URL lleva comercio, sección, solapa y filtros.** Drawers y modales no.
2. **Router propio** sobre `route-state.ts`, sin dependencias nuevas. Descartados: `preact-router`
   (la URL vive en componentes y haría falta un signal aparte), `preact-iso` y `wouter-preact` (API
   de hooks, prohibidos por el lint).
3. **Datos con `@tanstack/query-core`** y un `createSignalQuery` con clave reactiva.
4. **Frescura**: se muestra la caché al instante y se pide de nuevo en segundo plano (`staleTime: 0`,
   también al volver a la pestaña); las mutaciones invalidan por una tabla única.
5. **#55: la sección Créditos pasa a llamarse "Uso y pagos"**, slug `uso-y-pagos`, ícono de
   billetera. "Crédito" es, para un comercio, el fiado de sus clientes; "Facturación" chocaría con la
   facturación fiscal y "Mi cuenta" ya existe en Configuración. Los ids internos (`credits`) no
   cambian.

## URLs

Forma: `/admin/<slug-comercio>/<sección>[/<solapa>][?filtros]`, en castellano, minúsculas, sin
acentos. La primera solapa no lleva segmento. Los ids internos de secciones y solapas no cambian.

| Sección (id) | URL | Solapas (id → slug) | Filtros |
|---|---|---|---|
| Dashboard (`dashboard`) | `/admin/<c>/dashboard` | — | `periodo`, `sucursal` |
| Ventas & Caja (`sales`) | `/admin/<c>/ventas` | `sales` → —, `payments` → `cobranzas`, `movements` → `movimientos`, `summary` → `resumen` | `rango` (`hoy`, `ayer`, `semana`, `mes`) o `desde` + `hasta`; `sucursal`, `caja`, `pagina`; por solapa: `estado`, `producto` (ventas), `medio`, `cliente`, `estado` (cobranzas), `sentido`, `origen` (movimientos) |
| Catálogo & Precios (`catalog`) | `/admin/<c>/catalogo` | — | `q`, `categoria`, `estado` (`activos`, `bloqueados`) |
| Stock & Kardex (`stock`) | `/admin/<c>/stock` | — | `q`, `categoria`, `nivel` (`sin-stock`, `bajo`, `normal`), `sucursal` |
| Clientes & CC (`customers`) | `/admin/<c>/clientes` | — | `q`, `deudores=1`, `estado` (`activos`, `bloqueados`) |
| Operaciones Masivas (`bulk`) | `/admin/<c>/masivas` | `prices` → —, `interests` → `intereses`, `io` → `archivos` | — |
| Usuarios (`users`) | `/admin/<c>/usuarios` | — | — |
| Configuración & POS (`settings`) | `/admin/<c>/configuracion` | `pos` (Cajas) → —, `branches` → `sucursales`, `connection` → `conexion`, `account` → `cuenta`, `appearance` → `apariencia` | — |
| Uso y pagos (`credits`) | `/admin/<c>/uso-y-pagos` | `charges` → —, `movements` → `movimientos`, `gifts` → `regalados` | `desde`, `hasta` (consumo) |
| Plataforma (`platform`) | `/plataforma` | `payments` → —, `settings` → `configuracion` | — |

Reglas:

- **Plataforma fuera de `/admin`**: no es de un comercio, y `/admin/plataforma` chocaría con un
  comercio llamado "Plataforma".
- **Normalización** (con `replaceState`, en un solo lugar): `/onboarding` → `/alta`; `/admin` → el
  último comercio usado (o el primero) en `/dashboard`; `/admin/<c>` → `/admin/<c>/dashboard`; barra
  final y mayúsculas en el path se limpian; una solapa desconocida va a la primera; un filtro inválido
  se descarta; un filtro con su valor por omisión no se escribe.
- **Historial**: cambiar de comercio, sección o solapa hace `pushState`; cambiar un filtro,
  `replaceState` (la búsqueda con debounce). Atrás vuelve a la pantalla anterior, no al filtro
  anterior.
- **El menú abre la sección limpia** (sin filtros). Hoy un filtro sobrevive en memoria al ir y volver
  por el menú; con el router, lo devuelve Atrás.
- **Permisos**: una sección no permitida se reemplaza por `/dashboard` (lo que hoy hace el effect de
  `permissions-state`); una solapa no permitida de Configuración va a `apariencia`; la de Plataforma
  solo de root (`configuracion`), a la primera.
- **Comercio restringido** (#21): la URL se mantiene y se ve `RestrictedView`, salvo en
  `uso-y-pagos` y `configuracion`.
- **URLs existentes intactas**: `/`, `/alta` (con su query), `/onboarding`, `/invitacion#t=…`,
  `/restablecer#t=…`. `#connect=` es de la vuelta al POS y no pasa por este router.

## Router

### `src/client/routing/admin-routes.ts` (puro)

Sin signals ni `window`.

- `SECTIONS`: por sección, `id`, `slug`, solapas `{ id, slug }` y un esquema Zod de filtros donde cada
  campo lleva `.catch(<omisión>)`.
- `type Route = { kind: 'landing' | 'alta' | 'invitacion' | 'restablecer' } | { kind: 'plataforma';
  tab } | { kind: 'admin'; tenantSlug: string | null; section; tab; filters }`, con `filters` tipado
  por sección.
- `parseLocation(pathname, search): Route` y `buildUrl(route): string` (canónica). Invariante:
  `parseLocation(buildUrl(r))` es `r` para toda ruta válida.

### `src/client/state/route-state.ts`

- `locationSignal` (`{ pathname, search }`) y `routeSignal = computed(() => parseLocation(…))`.
- `navigate(url, { replace? })`, `initRouting` (normalización y `popstate`). El historial es
  inyectable (`window.history` por omisión) para testear en Node.
- `goTo({ section, tab?, filters? })` (push, en el comercio de la URL), `setFilters(parcial)`
  (replace) y `switchTenant(slug)` (push, misma sección y solapa, sin filtros: sucursal, caja o
  producto son de cada comercio).
- `activeSectionSignal` (`computed`, solo lectura) reemplaza a `activeViewSignal`; `navigateTo`
  desaparece y sus llamados pasan a `goTo` (el drill del dashboard, `openSalesWith`, es un `goTo` con
  filtros).
- Los signals de solapa (`salesTabSignal`, `activeSettingsTabSignal`, `activeBulkTabSignal`,
  `creditsTabSignal`, `platformTabSignal`) y de filtros (`catalogSearchSignal`, `rangeSignal`, etc.)
  pasan a `computed` desde la ruta; quien hoy los escribe llama a `goTo` o `setFilters`.

### `src/client/components/ui/Link.tsx`

Un `<a href={buildUrl(…)}>` que intercepta el clic simple (botón izquierdo sin modificadores) y llama
a `navigate`; Ctrl+clic y el botón del medio abren una pestaña nueva. Lo usan el menú lateral, las
solapas, el banner de créditos, `RestrictedView`, la alerta de stock del dashboard y la vuelta de la
importación.

## Comercio activo

- **La URL manda.** `effectiveTenantIdSignal` (mismo nombre) pasa a ser un `computed` que busca el
  slug de la ruta en `userTenantsSignal`; `activeTenantSignal` sale de él.
- **`localStorage` (`mini_erp_tenant_id`) es solo "el último comercio usado"**: se escribe cuando la
  URL resuelve un comercio y solo decide adónde va `/admin` pelado. El selector del header usa
  `switchTenant`; el alta y la invitación aceptada navegan a `/admin/<slug>/dashboard`
  (`tenantUrl(tenantId, sección)`, con el slug de `userTenantsSignal` ya cargado).
- **Perfil cargando**: con un slug en la URL y la lista vacía no se redirige; se espera.
- **Slug desconocido o sin acceso** (perfil cargado): dentro del shell, "No tenés acceso a este
  comercio o no existe", con el selector y un botón al último comercio. Nunca una redirección muda.
- **Link directo sin sesión**: el login aparece en la misma URL y, al entrar, se abre esa pantalla.
- **Sin comercios**: `/admin` muestra "Crear mi comercio", como hoy.
- **Impersonación de hoy** (hasta M7): el modal hace `switchTenant` y guarda en memoria el slug
  impersonado y el comercio de origen; la franja se ve mientras la URL está en ese slug; "Salir"
  vuelve al de origen. Al recargar se pierde la franja, como hoy. Sin cambios en servidor ni permisos.
- **Listo para M7**: cada pestaña tiene su comercio en la URL y su caché en memoria; lo compartido es
  solo "el último usado". M7 cambia de dónde sale el token (`sessionStorage` para una pestaña
  impersonando) dentro de `auth-state`, y el pedido de ayuda abre una URL de esta forma con
  `window.open`.

## Datos

### `createSignalQuery` (`src/client/api/query-client.ts`)

```ts
createSignalQuery<T>({
  key: () => QueryKey | null, // reactiva; null = deshabilitada
  fn: () => Promise<T>,
  refetchInterval?: number,
}): { data: ReadonlySignal<T | undefined>; isLoading: ReadonlySignal<boolean>;
      error: ReadonlySignal<Error | null>; refetch: () => Promise<void> }
```

- Un `QueryObserver` y un `effect` que lee `key()` y llama a `setOptions`. Pasar de `null` a una
  clave, o cambiarla con el dato viejo, pide. Reemplaza a `view-loader` y a los `effect` de carga.
- Opciones del `QueryClient`: `staleTime: 0`, `refetchOnWindowFocus: true`, `retry`: una vez solo
  para errores de red o 5xx (un `ApiError` 4xx no se reintenta). 401, 402 y mantenimiento siguen en
  `apiFetch`.
- Dato anterior como placeholder solo si la clave nueva es del mismo comercio; entre comercios la
  clave nueva arranca vacía.
- `isLoading`: primera carga sin datos. El refresco en segundo plano no se muestra.

### Claves (`src/client/state/query-keys.ts`)

`['t', tenantId, dominio, ...params]` y `['platform', dominio]`. Dominios: `products`, `categories`,
`stock`, `kardex`, `branches`, `customers`, `customer-movements`, `discrepancies`, `dashboard`,
`sales` (con la solapa y los filtros), `ticket`, `day-summary`, `registers`, `billing-status`,
`credits` (resumen, consumo, movimientos y regalados), `members`, `invitations`, `audit`,
`example-catalog`; `platform`: `payments`, `settings`.

Habilitación (la clave es `null` si no):

- **De pantalla**: con su sección activa, comercio, sesión y permiso. Las sucursales, con cualquier
  sección que las use (dashboard, stock, configuración, ventas). El catálogo de ejemplo, en
  `masivas/archivos` fuera del paso de mapeo de la importación.
- **De drawer** (kardex, estado de cuenta, ticket, resumen del día): mientras está abierto.
- **Del shell**: `billing-status` siempre que haya comercio, con `refetchInterval` (reemplaza al
  `setInterval`); manda la franja y la restricción.

### Invalidación (`src/client/state/invalidation.ts`)

Las mutaciones siguen siendo funciones de los stores; al terminar bien llaman a
`invalidateAfter(evento)`. Se invalida el dominio en todos los comercios de la caché (solo los marca
viejos y se piden los que están habilitados).

| Evento | Dominios |
|---|---|
| `product-saved` (alta, edición, en línea, bloqueo, borrado) | products, categories, stock, dashboard, example-catalog |
| `stock-adjusted` | stock, products, kardex, dashboard |
| `customer-saved` | customers, discrepancies, dashboard |
| `customer-payment` (cobranza del admin) | customers, customer-movements, sales, dashboard, discrepancies |
| `balance-adjusted` | customers, customer-movements, dashboard |
| `bulk-prices` | products, dashboard |
| `bulk-interests` | customers, customer-movements, dashboard |
| `products-imported` (importación o catálogo de ejemplo) | products, categories, stock, kardex, dashboard, example-catalog |
| `customers-imported` | customers, customer-movements, discrepancies, dashboard |
| `branch-saved` | branches, stock, dashboard |
| `register-changed` | registers, billing-status |
| `discrepancy-dismissed` | discrepancies, customers |
| `users-changed` | members, invitations, audit |
| `platform-changed` | platform, billing-status, credits |

Lo que entra por el push del POS se ve al entrar a la pantalla, al volver a la pestaña o con el
sondeo de `billing-status`; un push en vivo queda fuera.

### Borrado de la caché

- **Cambio de sesión** (login, logout, 401, sesión del alta o de un link): `queryClient.clear()`
  desde un `effect` sobre `tokenSignal`.
- **Cambio de comercio**: `removeQueries` de las claves de otros comercios.

### Forma de los stores

Los componentes casi no cambian: `productsSignal = computed(() => productsQuery.data.value ?? [])`,
`catalogLoadingSignal = productsQuery.isLoading`. Las mutaciones que hoy tocan la lista a mano usan
`queryClient.setQueryData` con la respuesta del servidor y después invalidan. El estado que no es
dato ni filtro (modales, drawers, formularios, edición en línea, el asistente de importación) sigue
en signals.

## Orden de la migración

Cada tarea deja el admin funcionando.

1. Rutas puras (`admin-routes.ts`), sin uso todavía.
2. Sección y comercio en la URL: `route-state`, `App.tsx` por `kind`, `/plataforma`, `Link`, menú,
   `goTo`, comercio desde el slug, `switchTenant`, último usado, sin acceso, impersonación, login en
   la misma URL, destino del alta y de la invitación.
3. Solapas en la URL (ventas, configuración, masivas, créditos, plataforma), con sus permisos.
4. `createSignalQuery` reactivo, claves, invalidación y borrado de caché, sin uso todavía.
5. Catálogo. 6. Stock. 7. Clientes (y se borra `view-loader.ts` con su test). 8. Dashboard (drill
   como links). 9. Ventas & Caja. 10. Configuración. 11. Uso y pagos (#55 y `billing-status` del
   shell). 12. Usuarios y plataforma. 13. Masivas e importación.
14. e2e de navegación, AGENTS.md, versión 0.11.0 y borrado del plan.

Cada store migrado pasa a Query, mueve sus filtros a la URL y llama a `invalidateAfter` en sus
mutaciones.

## Tests

- `test/admin-routes.test.ts`: ida y vuelta para toda sección, solapa y filtro; normalización;
  inválidos descartados; `/plataforma`; URLs existentes.
- `test/route-state.test.ts`: push y replace, `switchTenant`, `popstate`, con historial inyectado.
- `test/active-tenant.test.ts`: comercio desde el slug, perfil cargando, sin acceso, último usado,
  impersonación.
- `test/signal-query.test.ts`: habilitar y deshabilitar, refresco, placeholder solo en el mismo
  comercio, borrado por sesión y por comercio, sin reintento en 4xx.
- `test/invalidation.test.ts`: la tabla, fila por fila.
- Por store migrado: habilitación por sección y comercio, filtros desde la URL e invalidación de sus
  mutaciones (con `fetch` falso).
- Guardianes: cada sección tiene su ítem de menú y su vista y viceversa; nadie fuera de
  `route-state.ts` navega con `history` o `window.location` (lista explícita de excepciones: el
  origen para links y la vuelta al POS del alta); nadie fuera de `query-client.ts` crea un
  `QueryClient` o un `QueryObserver`.
- Se adaptan `app-shell-and-navigation`, `auth-client-state`, `merchant-onboarding`, `sales-client` y
  `route-and-landing`; `sidebar-order` sigue igual; `view-loader.test.ts` se borra.
- e2e: los tres specs actuales en verde (los clics del menú pasan de `button` a `link`) y
  `e2e/navigation.spec.ts`: link directo a una pantalla con filtro de otro comercio, atrás y adelante,
  una cobranza vista en Ventas → Cobranzas y en Clientes sin recargar, y un member que cae en el
  dashboard desde `/usuarios` y en "sin acceso" con un slug ajeno.

## Fuera de alcance

- Lo que implementa M7 (#23): impersonación por usuario y por pestaña, pedido de ayuda.
- La preferencia de 12 o 24 horas (#65).
- Push en vivo del POS al admin.
- Drawers y modales en la URL.

## Ajustes de la implementación

1. **Filtros con códecs propios** en lugar de Zod: cada sección tiene `decode`/`encode` escritos a mano
   con lectores chicos (`text`, `day`, `positiveInt`, enums con su texto de URL). Así el nombre interno
   (`active`) y el de la URL (`activos`) quedan juntos y sin casts.
2. **Sin debounce en la búsqueda**: el filtro de catálogo, stock y clientes es en memoria y
   `replaceState` no agrega entradas al historial; un debounce obligaría a un estado local del input.
3. **`createSignalQuery` separa la clave del habilitado**: la clave es `null` solo sin sesión o sin
   comercio, y `enabled` dice si la pantalla está activa. Una consulta deshabilitada con clave igual ve
   la caché (lo necesitan los tests y la edición en línea).
4. **`members` e `invitations` son un solo dominio, `users`**, porque vienen del mismo pedido.
   Las cajas del filtro de ventas (`registers`) y las de configuración (`pos-registers`) son dominios
   distintos, porque son dos endpoints.
5. **El alta y la invitación** recuerdan el comercio nuevo como "último usado" y navegan a `/admin`,
   que la normalización lleva a su dashboard (no hace falta `tenantUrl`).
6. **El drill del dashboard** sigue siendo un botón que llama a `goTo`; navega con URL igual.
7. **Los avisos del pull** que nombran la sección dicen "mini → Uso y pagos" (#55).
8. **Las sucursales** son una sola consulta para dashboard, stock y configuración, y avisan si
   no cargan.
