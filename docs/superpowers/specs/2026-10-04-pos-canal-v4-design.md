# El POS en el canal /v4/, POS_URL por omisión y contrato 4.5.0 (#58, #38)

Fecha: 2026-10-04. Issues: rauldiazsolis/mini-erp#58 y rauldiazsolis/mini-erp#38 (primer trabajo
antes de M7, orden decidido en #17: #58 → #51 → #59 → #56 → #6). Versión: 0.9.0.

## Contexto

Con rauldiazsolis/offline-pos#54 el POS dejó de publicarse en carpetas por versión (`/0.1.0/`) y pasó
a **un canal por major del contrato**: `https://pos.contax.ar/v4/` tiene siempre el último POS que
habla el contrato 4.x. Es una PWA: un service worker le lleva las versiones nuevas a las terminales.
`https://pos.contax.ar/v4/version.json` dice hoy POS `0.3.1`, contrato `4.5.0`, piso `4.0.0`; las
docs para integradores están en `/v4/docs/`.

Así está el mini-erp:

- **Links**: el landing abre `<POS_URL>/<posVersion>/` (`src/client/state/demo-link.ts`), con
  `posVersion` de `contract.json` (`0.1.0`). `POS_URL` por omisión es `https://offline-pos.pages.dev`
  (#38).
- **`pnpm contract:update <versión>`** (`scripts/contract-source.ts`, `scripts/contract-update.ts`)
  baja de `https://offline-pos.pages.dev/<versión>/`. Ya está roto: `/0.1.0/docs/` no existe más.
- **Espejo de desarrollo** (`src/server/pos-mirror/`): baja `/<posVersion>/` a `vendor/pos/<versión>/`
  y lo sirve en `/pos/<versión>/`. Lee solo los `src`/`href` del `index.html` y los assets que nombran
  los bundles.
- **Contrato implementado**: 4.4.0, en `src/server/connector/backend-info.ts` (`CONTRACT_VERSION`). El
  major `'4'` está escrito a mano en `checkContractVersion` (`routes/connector-routes.ts`) y el
  cliente dice "Contrato v4.4.0" literal en `ConnectorGuideSection.tsx`.

**`/0.1.0/` ya se borró** de `pos.contax.ar` y de `offline-pos.pages.dev` (el mismo proyecto de
Cloudflare Pages). Algunos nodos de Cloudflare todavía lo sirven de su caché (`s-maxage` de 7 días),
otros no. El CI del merge de M6 en `main` falló por eso: el runner de GitHub no pudo bajar el espejo y
el e2e de la demo encontró "No está la copia local del POS". El código de M6 está bien, pero
`deploy.yml` corre el CI entero, así que **`0.8.0` no se puede deployar hasta que entre esta etapa**:
M6 y el canal salen juntos en `0.9.0`, y conviene deployar apenas se mergee (producción sigue en
`v0.7.0`, con "Probar la demo" apuntando a `/0.1.0/`).

Diferencias del contrato 4.5.0 contra la copia (4.4.0), todas aditivas:

- `GET /info` suma `company` opcional (`{ name }`): el comercio de la key. Ausente, mal formado o con
  el nombre vacío, el POS no muestra empresa. No es una capacidad.
- **Revocar una demo**: el backend puede revocar la conexión de una demo cuando quiera y desde
  entonces responde `401` a todo request con esa key. El POS en demo lo toma como "la demo terminó" y
  ofrece una nueva. Una demo revocada puede ir igual al alta.

## Decisiones

1. **El canal sale del contrato implementado.** `CONTRACT_VERSION` se muda a
   `src/shared/contract-version.ts` (TS puro, lo usan servidor, cliente y scripts) con
   `CONTRACT_MAJOR` y `POS_CHANNEL = 'v4'` derivados. Al implementar el contrato 5, los links, el
   espejo y `contract:update` pasan a `/v5/` sin tocar nada más. No sale de `contract.json`: la copia
   publicada puede adelantarse a lo implementado (bajar `/v5/` para leer el diff no tiene que mandar
   los links a un POS que todavía no hablamos).
2. **`contract.json` registra la procedencia**, pero ningún código lee la versión del POS:

   ```json
   {
     "channel": "v4",
     "posVersion": "0.3.1",
     "contract": "4.5.0",
     "minBackendContract": "4.0.0",
     "source": "https://pos.contax.ar/v4/"
   }
   ```

   `posVersion` es qué POS había en el canal al bajar la copia. Sin fecha: la da el commit.
3. **`pnpm contract:update [canal]`**: sin argumento, `POS_CHANNEL`; con argumento, otro canal
   (`v5`), para preparar una migración. Formato `v<N>`, si no lanza. Baja
   `https://pos.contax.ar/<canal>/version.json` y `.../docs/connector-api.openapi.yaml`, y no escribe
   nada si el `info.version` del OpenAPI no coincide con el `contract` de `version.json` o si el major
   de ese `contract` no es el del canal. `PUBLISHED_POS_ORIGIN` pasa a `https://pos.contax.ar`.
4. **Links al canal, sin versión del POS.** `posBaseUrl(origin, useLocalCopy, posOrigin)` da
   `<origin>/pos/v4/` en desarrollo y `<posOrigin>/v4/` en producción. `POS_VERSION` desaparece del
   cliente; el landing en desarrollo dice "Abre una copia local del POS del canal v4, servida por este
   backend." `connect-return.ts` no cambia: la URL de vuelta la manda el POS.
5. **`POS_URL` por omisión `https://pos.contax.ar`** (#38): `DEFAULT_POS_ORIGIN`, el comentario de
   `deploy.yml`, `deploy/README.md` y `README.md`.
6. **Espejo sin service worker.** `vendor/pos/v4/`, servido en `/pos/v4/`:
   - Baja `version.json`, `index.html`, lo que nombran el `index.html` y los bundles (como hoy), y
     además el **manifest** (`manifest.webmanifest`, que el `index.html` ya nombra) y sus íconos: el
     manifest se parsea como JSON y se bajan sus `icons[].src` relativos.
   - **No baja `sw.js`** (se excluye aunque algún archivo lo nombre). El POS lo intenta registrar,
     recibe `404` y sigue sin modo offline (ese error ya lo maneja). Así, renovar la copia se ve con
     solo recargar, sin `/ACTUALIZAR` ni una caché vieja. La parte PWA se prueba contra el POS
     publicado, que es de offline-pos.
   - Valida que `version.json` sea válido y que el major de su `contract` sea el del canal; la
     versión del POS no se fija.
   - `pnpm dev` lo baja si falta (`vendor/pos/v4/index.html` y `version.json`) y al arrancar loguea
     qué sirve (`POS 0.3.1 (canal v4)`). `pnpm pos:mirror [canal]` lo renueva. Una carpeta vieja
     (`vendor/pos/0.1.0/`) queda huérfana: es local y se borra a mano.
7. **Playwright con `serviceWorkers: 'block'`.** El POS del e2e corre como una página común. El e2e
   de la demo espera el link `/pos/v4/?demo=true&backend=…`.
8. **`company.name` en `/info`**: el nombre del comercio de la key (`tenants.name`, el del admin; un
   cambio se ve en el próximo `/info`). En demos también ("Demo Kiosco", etc.: deja claro que no es un
   comercio real). Sin `company` en el app de mantenimiento (no hay key ni bases) ni si el nombre está
   vacío. `backendInfo` recibe el nombre como parámetro opcional.
9. **Contrato implementado 4.5.0**: `CONTRACT_VERSION = '4.5.0'` en `/info` y en el `409`; el `409`
   compara contra `CONTRACT_MAJOR`. Los comentarios que dicen "4.4.0" sobre reglas que siguen
   vigentes quedan (dicen desde cuándo); se actualiza la guía del Connector en el cliente.
10. **Demos revocadas: solo verificación.** El barrido ya borra la demo vencida y su key da `401`.
    Esta etapa suma tests:
    - con la key de una demo barrida, `401` en `GET /info`, `POST /sync/pull`, `POST /sync/push` y
      `POST /account-holds`;
    - el alta (`POST /api/alta`, lo que hace `/alta?template=kiosco&return_url=…&wipe_key=…`)
      funciona después de que la demo venció: crea el comercio con su rubro y la key de Caja 1. El
      alta nunca usa la key de la demo.

    La revocación activa (reinicios, caja sin uso por 24 h, comercio demo compartido) es de M8 (#24).
11. **Sin código de transición.** Nada de "probar `/v4/` y si no, `/0.1.0/`": `/0.1.0/` ya no existe y
    `/v4/` sí. Las terminales conectadas no se ven afectadas: un POS 4.4 o 4.5 habla con un backend
    4.5 (mismo major). Si algún comercio real tiene el POS abierto en `/0.1.0/`, deja de cargar cuando
    vence la caché de Cloudflare: eso es de offline-pos.

## Componentes

| Archivo | Cambio |
|---|---|
| `src/shared/contract-version.ts` (nuevo) | `CONTRACT_VERSION`, `CONTRACT_MAJOR`, `POS_CHANNEL`, `channelOf(version)` |
| `src/server/connector/backend-info.ts` | importa la versión de `shared`; `backendInfo({ status, demos, companyName? })` |
| `src/server/routes/connector-routes.ts` | `/info` manda el nombre del comercio de la key; `409` por `CONTRACT_MAJOR` |
| `scripts/contract-source.ts`, `scripts/contract-update.ts` | canal en vez de versión, origen `pos.contax.ar`, `contract.json` nuevo |
| `contract.json`, `docs/connector-api.openapi.yaml` | copia 4.5.0 de `/v4/` (con el script ya arreglado) |
| `src/server/pos-mirror/` y `scripts/pos-mirror.ts` | canal, manifest e íconos, sin `sw.js`, log de la versión servida |
| `src/server/client-middleware.ts` | espejo de `POS_CHANNEL` |
| `src/client/state/demo-link.ts`, `LandingView.tsx` | links al canal, `DEFAULT_POS_ORIGIN` nuevo, sin `POS_VERSION` |
| `src/client/components/settings/ConnectorGuideSection.tsx` | "Contrato v" + `CONTRACT_VERSION` |
| `playwright.config.ts`, `e2e/demo-onboarding.spec.ts` | `serviceWorkers: 'block'`, link a `/pos/v4/` |
| `.github/workflows/deploy.yml`, `deploy/README.md`, `README.md` | `POS_URL` por omisión y canal |
| `AGENTS.md` | contrato 4.5.0, POS híbrido en `/v4/`, `POS_URL`, Estado |

## Tests

- `contract-source.test.ts`: base del canal, canal inválido, major de `version.json` distinto del
  canal, `contract.json` nuevo.
- `pos-mirror.test.ts` y `pos-local-copy.test.ts`: espejo del canal con manifest e íconos, sin `sw.js`
  aunque un bundle lo nombre, `version.json` de otro major rechazado, servido en `/pos/v4/`.
- `route-and-landing.test.ts`: links al canal, `DEFAULT_POS_ORIGIN = https://pos.contax.ar`.
- `contract-evolution.test.ts` y `connector-api.test.ts`: `/info` con `contractVersion: 4.5.0` y
  `company.name` del comercio; `409` con otro major.
- `maintenance-app.test.ts`: `/info` sin `company`.
- `demo-sessions-api.test.ts`: `401` en todos los endpoints con una demo barrida y alta después.
- e2e: el recorrido de la demo contra el espejo de `/v4/`.

## Criterio de aceptación

- `pnpm contract:update` trae 4.5.0 de `https://pos.contax.ar/v4/` y deja `contract.json` con
  `channel: v4` y la `posVersion` que había.
- `pnpm dev` baja y sirve el POS en `/pos/v4/`; `pnpm test:e2e` pasa.
- `GET /connector/info` con una key devuelve `contractVersion: 4.5.0` y `company.name` del comercio.
- El landing de producción abre `https://pos.contax.ar/v4/?demo=true&backend=…`.
- La key de una demo barrida da `401` en todo el Connector API y el alta anda igual.
- `pnpm lint && pnpm typecheck && pnpm test`, `pnpm build` y `pnpm test:e2e` en verde.

## Fuera de alcance

- La revocación activa de demos y el comercio demo compartido (M8, #24).
- Fechas y números según el navegador (#51).
- Hablar dos majors a la vez: hace falta recién cuando el POS pase al contrato 5.
