# mini-erp

Backend multitenant (Express + SQLite) con un admin web (Preact) que implementa el **Connector API**
de [offline-pos](https://github.com/rauldiazsolis/offline-pos): catálogo, stock por sucursal,
clientes, cuentas corrientes y sincronización con las terminales del POS.

## Levantarlo

Requiere Node 24 y pnpm 10.

```bash
pnpm install
pnpm dev
```

El servidor queda en `http://localhost:4100` (o en el puerto de `PORT`): el landing en `/`, el admin
en `/admin`, la página de alta de comercios en `/alta`, la API del admin en `/api` y el Connector API
en `/connector`. Los datos van a `data/` (SQLite, un archivo por comercio), o a la carpeta de
`DATA_DIR`.

Fuera de producción, al arrancar crea datos de desarrollo si no existen: un admin (`root`), el
comercio "Tienda Demo Central" con datos de ejemplo y una API key de terminal. Las credenciales se
imprimen en la consola. Con esa key, un POS se conecta a `http://localhost:4100/connector`. Con
`NODE_ENV=production` no se crea nada de eso.

Registrarse desde la web (el alta de comercios) crea siempre un usuario común. El administrador
(`root`), que ve todos los comercios, se crea con un comando:

```bash
node scripts/create-root.ts
```

Pide email, nombre y contraseña (mínimo 12 caracteres, sin eco). Si el email ya existe, lo promueve a
root y le pone la contraseña nueva.

## Probar la demo con el POS publicado

1. `pnpm dev` y abrir `http://localhost:4100/` (anda en cualquier navegador).
2. **Probar la demo**: abre el POS en demo contra este mini-erp.
   - **En desarrollo**, una copia local del POS publicado (versión de `contract.json`, hoy 0.1.0) que
     el mini-erp sirve en `/pos/<versión>/`: el mismo JS de `https://offline-pos.pages.dev/<versión>/`,
     en el mismo origen que el mini-erp, sin CORS ni permiso de red local. `pnpm dev` la baja sola si
     falta; `pnpm pos:mirror [versión]` la vuelve a bajar a `vendor/pos/` (ignorada por git).
   - **En producción** (`pnpm build` + `NODE_ENV=production`), el POS publicado en offline-pos.pages.dev.
3. El POS arranca con la marca DEMO y el catálogo del template (por defecto `kiosco`). Cada demo es un
   comercio aislado que vence solo.
4. **Crear mi comercio (/ALTA)**: lleva a `/alta` del mini-erp. Al terminar el alta, "Volver al POS"
   deja la caja conectada al comercio nuevo, sin los datos de la demo.

El POS publicado de verdad contra el mini-erp en `localhost` también anda, en Chrome: pide permiso de
red local la primera vez (es una página pública llamando a `localhost`). El navegador integrado de la
app de Claude lo bloquea sin preguntar.

## Variables de entorno

| Variable | Por defecto | Qué controla |
|---|---|---|
| `NODE_ENV` | (vacío) | `production`: sirve el cliente compilado (`dist/`), abre el POS publicado y no crea datos de desarrollo |
| `PORT` | `4100` | Puerto del servidor |
| `DATA_DIR` | `data` | Carpeta de las bases (`system.sqlite` y `tenants/`) |
| `BACKUP_DIR` | `backups` | Carpeta de los backups de `node scripts/backup.ts` (se guardan 7 días) |
| `PUBLIC_URL` | origen del request | URL pública del mini-erp, para armar la página de alta detrás de un proxy |
| `VITE_POS_URL` (al compilar) | `https://offline-pos.pages.dev` | Origen del POS publicado que abre "Probar la demo" en producción (le suma `/<versión>/` de `contract.json`). En el deploy sale de la variable `POS_URL` del environment `production` de GitHub |
| `DEMO_SESSIONS` | `on` | `off` apaga `POST /connector/demo-sessions` (responde 404) |
| `DEMO_TTL_HOURS` | `24` | Horas sin uso hasta que una demo se borra |
| `DEMO_MAX_ACTIVE` | `200` | Tope de demos vivas (pasado el tope, 503) |
| `DEMO_RATE_LIMIT` | `10` | Demos por hora por IP (pasado el límite, 429 con `Retry-After`) |
| `AUTH_RATE_LIMIT` | `20` | Pedidos a login y registro cada 15 minutos por IP (contador compartido) |

## Producción

Publicado en **https://mini.contax.ar** (AWS Lightsail detrás de Caddy; `mini.contax.com.ar` redirige ahí). Cada tag `v*` (o "Run
workflow" en Actions) corre el CI entero y despliega por SSH, con vuelta a la versión anterior si la
nueva no responde. Backups: snapshots diarios de Lightsail y una copia nocturna por archivo de las
bases reales. La guía paso a paso (instancia, secretos, root, operación y restauración) está en
[`deploy/README.md`](./deploy/README.md).

## Contrato

- Implementa el Connector API **4.2.0** más la capacidad `demo-sessions` de 4.4.0; el POS acepta
  backends desde **4.0.0**.
- La copia del contrato publicado está en
  [`docs/connector-api.openapi.yaml`](./docs/connector-api.openapi.yaml), con su procedencia en
  [`contract.json`](./contract.json). Se actualiza con `pnpm contract:update <versión del POS>`.
- Lo que falta de 4.4.0 está en [#2](https://github.com/rauldiazsolis/mini-erp/issues/2).

## Desarrollo

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

El e2e (Playwright, solo Chromium) recorre la demo y el alta de punta a punta: levanta el mini-erp en
el puerto 4110 con una base descartable (`DATA_DIR=test-results/e2e-data`) y la copia local del POS.
La primera vez hay que instalar Chromium:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Las reglas del repo están en [`AGENTS.md`](./AGENTS.md); la historia de las fases, en
[`PLAN.md`](./PLAN.md).
