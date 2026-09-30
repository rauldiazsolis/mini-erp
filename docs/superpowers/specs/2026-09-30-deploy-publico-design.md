# Deploy público del mini-erp como backend de la demo del POS

Estado: diseño aprobado (2026-09-30). Issue: #3. Epic del POS: rauldiazsolis/offline-pos#166.

## Objetivo

Publicar el mini-erp en la web, con HTTPS, como backend de la demo pública del POS. Criterio de
cierre: desde `https://offline-pos.pages.dev/0.1.0/?demo=true&backend=<URL pública>/connector` se
crea una demo aislada contra el mini-erp publicado y el recorrido completo anda: landing → demo
(marca DEMO) → vender → `/ALTA` → alta → el POS vuelve configurado contra el comercio nuevo, sin los
datos de la demo.

Fuera de alcance: #2 (`customer-payment-void`, `notices`, reglas de evolución), sumar el backend a
`site/backends.json` del POS (#147 en offline-pos) y coordinar versiones entre el POS instalado y el
backend (rauldiazsolis/offline-pos#172).

## Decisiones

| Pregunta | Decisión |
|---|---|
| Hosting | **AWS Lightsail**, plan de US$5/mes (2 vCPU, 512 MB, 20 GB SSD, IPv4, 1 TB de tráfico), Ubuntu 24.04. Precio cerrado con tope mensual; ya queda en Amazon. |
| HTTPS sin dominio | **Caddy** con `<ip-estática>.sslip.io` (certificado automático de Let's Encrypt). |
| Root inicial | Un **comando** (`scripts/create-root.ts`) que el usuario corre una vez por SSH. `register` crea siempre `user`. |
| Seed de desarrollo | No corre con `NODE_ENV=production`. |
| Límite de pedidos | Limitador propio en memoria, por IP y ventana fija: 10 demos/hora en `POST /connector/demo-sessions` y 20 pedidos/15 min en `POST /api/auth/login` y `/register`. Tope global `DEMO_MAX_ACTIVE` = 200 sin cambios. |
| Deploy | GitHub Actions por tag `v*` o manual, reusando el CI entero; tarball por SSH, versiones con symlink `current` y vuelta atrás si falla `/health`. |
| Backups | Snapshots automáticos diarios de Lightsail + copia nocturna por archivo (`VACUUM INTO`) de las bases reales, 7 días. |

Descartados:

- **Google Cloud e2-micro**: gratis, pero pide vincular una tarjeta a Cloud y no está claro si cobra
  la IPv4 externa. **Fly.io**: cobro por uso sin tope de gasto y cambios de precio recientes.
  **Railway**: más caro sin ventajas. **AWS EC2 con créditos**: cierra la cuenta si no se pasa a
  paga.
- **nginx**: pide certbot y su renovación aparte; Caddy lo hace solo.
- **`ROOT_EMAIL`/`ROOT_PASSWORD` por entorno**: la contraseña quedaría en texto plano en el servidor
  y en los secretos de GitHub.
- **Flag `DEV_SEED`**: obliga a prenderlo en cada entorno de desarrollo; `NODE_ENV` ya hace falta
  para servir `dist/`.
- **Rate limit en Caddy** (necesita compilar con xcaddy) o con **`express-rate-limit`** (una
  dependencia para ~40 líneas).
- **Backups como artifacts de GitHub**: en un repo público los baja cualquier usuario logueado, y
  tienen hashes de contraseñas. **S3**: credenciales en el servidor y costo aparte, de más para esta
  etapa.

## 1. e2e estable (antes que nada)

El último CI de `main` (merge de #10) falló en el e2e, por un test inestable:

1. El test abre el SQLite del comercio para contar ventas mientras el servidor escribe el lote:
   `database is locked` (`e2e/demo-onboarding.spec.ts`, `query`, sin timeout).
2. El reintento reusa el servidor y la base: el email ya está registrado y el alta no avanza; además
   tomaría la primera demo de `demo_sessions`, no la nueva.

Arreglo: `new DatabaseSync(path, { readOnly: true, timeout: 5000 })`; email distinto por intento
(`e2e-alta-<retry>@local.test`, con `testInfo.retry`); la demo se toma con
`ORDER BY created_at DESC LIMIT 1`.

## 2. Root inicial

- `AuthService.register` asigna siempre `globalRole = 'user'`. Desaparece la regla del primer
  usuario.
- `AuthService.ensureRoot({ email, password, name })`: si el email no existe, crea el usuario como
  `root`; si existe, lo promueve a `root` y le pone la contraseña dada. Devuelve el usuario y si lo
  creó o lo promovió.
- `scripts/create-root.ts`: abre `system.sqlite` en `dataDir()` (con el esquema de `system-db.ts`),
  pide email, nombre y contraseña por la terminal (la contraseña sin eco, dos veces, mínimo 12
  caracteres) y llama a `ensureRoot`. Se corre en el servidor con el entorno del servicio (ver
  `deploy/README.md`). La lógica testeable queda en el servicio; el script solo lee la terminal.
- `ensureDevData` crea `admin@local.test` con `ensureRoot` en lugar de depender de ser el primero.
- Tests: se reescribe "asigna rol root al primer usuario"; `register` → `user` aunque la base esté
  vacía; `ensureRoot` crea y promueve.

## 3. Arranque sin seed en producción

- El arranque de `server.ts` pasa a `src/server/bootstrap.ts`:
  `bootstrap({ env, bundle }): { devInfo?: DevInfo }`. Arranca el barrido de demos y, **solo si
  `env.NODE_ENV !== 'production'`**, llama a `ensureDevData`.
- `server.ts` imprime las credenciales de desarrollo solo si hay `devInfo`; en producción, solo la
  URL (`PUBLIC_URL` o `localhost:<PORT>`).
- Test: con `NODE_ENV=production`, después de `bootstrap` no existen `admin@local.test`, el tenant
  `tienda-demo` ni la key `mpos_dev_demo_key_12345`; sin producción, sí.

## 4. Límite de pedidos

- `src/server/middleware/rate-limit.ts`:
  `createRateLimit({ limit, windowMs, now }): RequestHandler`. Clave: `req.ip`. Ventana fija por
  clave (`{ count, resetAt }`); al pasar el límite responde
  `429 { code: 'rate-limited', error: '…' }` con `Retry-After` en segundos. Descarta las entradas
  vencidas al recorrer (sin timers). El estado vive en memoria: un reinicio lo pone en cero, y el
  tope global de demos sigue firme porque vive en la base.
- Config (`src/server/demo/demo-config.ts` y una config de auth equivalente, leídas una vez):
  - `DEMO_RATE_LIMIT`: demos por hora por IP, por defecto 10.
  - `AUTH_RATE_LIMIT`: pedidos a login y registro cada 15 minutos por IP, por defecto 20.
- Se monta en `POST /connector/demo-sessions` (antes de crear la demo; después del chequeo de
  versión) y en `POST /api/auth/login` y `POST /api/auth/register` (un contador compartido entre
  ambos).
- `app.set('trust proxy', 'loopback')`: detrás de Caddy (en la misma máquina) `req.ip` es la del
  cliente y `req.protocol` es `https`. Sin proxy no cambia nada.
- El contrato no documenta 429 ni 503 en `/demo-sessions`: rauldiazsolis/offline-pos#173. El POS los
  trata como error genérico de la demo.
- Tests con supertest y reloj inyectado: el pedido 11 del mismo IP da 429 con `Retry-After`; otra
  IP pasa; al vencer la ventana vuelve a pasar; login y registro comparten el límite de 20.

## 5. Barrido de demos visible

`startDemoSweeper` loguea `[demos] barrido: N demos vencidas borradas` al arrancar (siempre) y en
cada barrido periódico que borre alguna. En el servidor se confirma con
`journalctl -u mini-erp | grep demos`.

## 6. Backup por archivo

- `scripts/backup.ts` (lógica en `src/server/backup/backup.ts`, testeable):
  `backupAll({ dataDir, backupDir, now, keep })`. Crea `backupDir/<YYYY-MM-DD>/` con `VACUUM INTO` de
  `system.sqlite` y de cada `tenants/<id>.sqlite` que **no** esté en `demo_sessions`; borra las
  carpetas más viejas y deja `keep` (7). Si la carpeta del día ya existe, la reemplaza.
- `VACUUM INTO` da una copia consistente con el servidor corriendo.
- Tests contra una carpeta temporal: copia system y los comercios reales, saltea las demos, respeta
  `keep`.

## 7. Servidor (carpeta `deploy/`)

| Archivo | Qué hace |
|---|---|
| `provision.sh` | Una vez, como root: Node 24 (NodeSource), `corepack enable` (pnpm del `packageManager`), Caddy (repo oficial), usuario de sistema `minierp`, `/opt/mini-erp/releases`, `/var/lib/mini-erp`, `/var/lib/mini-erp-backups`, `/etc/mini-erp/env` desde el ejemplo si no existe, 1 GB de swap, instala las unidades y el `Caddyfile`. Idempotente. |
| `mini-erp.service` | `User=minierp`, `WorkingDirectory=/opt/mini-erp/current`, `EnvironmentFile=/etc/mini-erp/env`, `ExecStart=/usr/bin/node src/server/server.ts`, `Restart=always`. |
| `mini-erp-backup.service` / `.timer` | `node scripts/backup.ts` a las 03:30 (hora del servidor), `Persistent=true`. |
| `Caddyfile` | `{$SITE_ADDRESS}` → `reverse_proxy localhost:4100`, con `SITE_ADDRESS` en el entorno de Caddy. |
| `env.example` | `NODE_ENV=production`, `PORT=4100`, `DATA_DIR=/var/lib/mini-erp`, `BACKUP_DIR=/var/lib/mini-erp-backups`, `PUBLIC_URL=https://<ip>.sslip.io`, `DEMO_*`, `AUTH_RATE_LIMIT`. |
| `deploy.sh` | Lo corre el workflow en el servidor: descomprime la versión, `pnpm install --prod --frozen-lockfile`, cambia `current`, reinicia, espera `/health` local y, si falla, vuelve a la anterior. Deja las últimas 5 versiones. |
| `README.md` | Pasos manuales (Lightsail, IP estática, firewall, snapshots, llave de deploy, secretos, `create-root`, restaurar un backup). |

El usuario de deploy (`SSH_USER`) puede escribir en `/opt/mini-erp/releases` y reiniciar
`mini-erp` con sudo solo para ese comando (`/etc/sudoers.d/mini-erp-deploy`, lo crea
`provision.sh`).

Lo hace el usuario en la consola de Lightsail: crear la instancia, asignarle una IP estática, abrir
80 y 443 (22 ya está), activar los snapshots automáticos y cargar la llave pública de deploy. El
agente no ve credenciales.

## 8. Workflow de deploy

- `ci.yml` suma `workflow_call`.
- `.github/workflows/deploy.yml`: `on: push: tags: ['v*']` y `workflow_dispatch`.
  1. `ci`: `uses: ./.github/workflows/ci.yml`.
  2. `deploy` (`needs: ci`, `environment: production`): `pnpm install`, `pnpm build`, tarball con
     `dist/`, `src/`, `scripts/`, `deploy/`, `package.json`, `pnpm-lock.yaml`, `contract.json`;
     `scp` a `/opt/mini-erp/releases/<sha>.tar.gz`; `ssh … deploy.sh <sha>`; al final,
     `curl -fsS https://<host>/health` desde el runner.
- Secretos del environment `production` (los carga el usuario): `SSH_HOST`, `SSH_USER`,
  `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`. Variable: `PUBLIC_HOST` (`<ip>.sslip.io`).
- Primer deploy con el tag `v0.1.0`.

## 9. Verificación

- En cada commit: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, y `pnpm test:e2e` (se
  tocan el alta y el Connector API).
- `provision.sh` y `deploy.sh` con `bash -n` y `shellcheck` si está disponible; se prueban de verdad
  en el servidor.
- Contra el servidor publicado:
  - `curl https://<host>/health` → `ok`; `GET /connector/info` con `capabilities: ['demo-sessions']`.
  - 11 `POST /connector/demo-sessions` seguidos → el último da 429 con `Retry-After`.
  - `admin@local.test` no entra; un registro nuevo queda `user`; el root creado con `create-root`
    entra y ve los comercios (sin demos).
  - `journalctl -u mini-erp` muestra el barrido; `systemctl list-timers` muestra el backup.
- Recorrido real con el navegador integrado de la app, con capturas: landing publicado → link de
  demo → POS publicado con la marca DEMO → venta → `/ALTA` → alta → el POS vuelve al comercio nuevo
  sin la venta de la demo.

## 10. Documentación

README (producción y variables nuevas), AGENTS.md (arquitectura del deploy, root por comando, rate
limit, estado) y PLAN.md (fase nueva). Después del merge: verificar el cierre de #3 y tildar el ítem
en rauldiazsolis/offline-pos#166.
