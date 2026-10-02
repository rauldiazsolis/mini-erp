# Migraciones de esquema con modo mantenimiento (#47)

Fecha: 2026-10-02. Issue: rauldiazsolis/mini-erp#47 (epic #17, antes de M3). Versión: 0.4.0.

## Problema

Desde el hito 1 un comercio real carga datos y paga: reiniciar producción a cero deja de ser una
opción. Hoy no hay migraciones:

- La base de sistema es una lista de `CREATE TABLE IF NOT EXISTS` con un guard (esquema 4) que se
  niega a arrancar con una base vieja.
- La de comercio está en la versión 1, con un `ALTER TABLE stock_movements ADD COLUMN notes` suelto
  en un `try/catch`.

M3, M5 y M6 cambian el esquema. Además, hoy el servidor abre las bases antes de escuchar: mientras
prepara las bases, Caddy responde 502.

## Decisiones

- **Migraciones propias, sin dependencias**: numeradas por tipo de base, con `PRAGMA user_version`
  como puntero.
- **Línea de base**:
  - sistema 4, sin migraciones por ahora;
  - comercio 1, con `notes` adentro del `CREATE` y el `ALTER` suelto borrado.
- **Primera migración real, comercio v2 `indices`**, inofensiva y útil. Prueba el camino completo en
  producción.
- **Las bases con datos se migran solo al arrancar**, en un `worker_thread`, mientras el hilo
  principal atiende en modo mantenimiento. `node:sqlite` es síncrono: en el hilo principal, una
  migración larga congelaría el servidor.
- **PostgreSQL**: se evaluó y se descartó para ahora. No evita el mantenimiento (un `ALTER` también
  toma locks), obliga a reescribir todos los servicios como asíncronos, a pasar de una base por
  comercio a schemas y a rehacer los tests y el deploy. El worker resuelve el único caso que bloquea.
- **Fuera de alcance**:
  - el mantenimiento a mano de root (queda para M7);
  - `tenants.status = 'maintenance'` (se deja sin usar);
  - el hueco de 1 a 3 s del `systemctl restart`, con el 502 de Caddy (el POS ya lo maneja).

## 1. Migraciones

### Formato

En `src/server/db/migrations/`:

- `types.ts`:
  ```typescript
  export type DbKind = 'system' | 'tenant';
  export type Migration = { version: number; name: string; up: (db: DatabaseSync) => void };
  export type Schema = { baselineVersion: number; baselineSql: string; migrations: readonly Migration[] };
  ```
- `system.ts`: `SYSTEM_SCHEMA` con la línea de base 4 (el SQL de hoy) y `migrations: []`.
- `tenant.ts`: `TENANT_SCHEMA` con la línea de base 1 (el SQL de hoy, con `notes`) y
  `migrations: [v2 indices]`.
- La versión actual es la de la última migración o, si no hay, la de la línea de base
  (`currentVersion(schema)`). `SYSTEM_SCHEMA_VERSION` y `TENANT_SCHEMA_VERSION` se derivan de ahí.

### Comercio v2 `indices`

Índices para las consultas que existen hoy:

```sql
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at);
CREATE INDEX IF NOT EXISTS idx_sales_voids_sale_id ON sales (voids_sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements (created_at);
CREATE INDEX IF NOT EXISTS idx_account_movements_customer ON account_movements (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_account_holds_customer ON account_holds (customer_id, status);
```

Las consultas son el dashboard (ventas por fecha y anuladas), el Kardex (por producto y por fecha),
el extracto de cuenta corriente y los holds de un cliente.

### `migrateDb(db, schema)` (`migrate.ts`)

Es pura y síncrona. Lee `user_version` y decide:

| Estado | Qué hace |
|---|---|
| `0`, sin tablas (base nueva) | Crea la línea de base, aplica todas las migraciones y deja la versión actual |
| `0` con tablas, o `1 ≤ v < baselineVersion` | `SchemaError`: "la base es anterior a la línea de base (vN): no se puede migrar" |
| `v > actual` | `SchemaError`: "la base es más nueva (vN) que este código (vM): ¿un rollback?" |
| `baselineVersion ≤ v < actual` | Aplica las pendientes en orden: una transacción por migración (`BEGIN`, `up(db)`, `PRAGMA user_version = N`, `COMMIT`). Si falla: `ROLLBACK` y un `MigrationError` con el número y el nombre de la migración |
| `v = actual` | Nada |

Devuelve `{ from, to, applied: string[] }`.

Hay también `checkDb(db, schema)`. Con una base nueva la crea en la versión actual; con una base al
día no hace nada; en cualquier otro caso tira el `SchemaError` correspondiente. Una base atrasada
dice "tiene migraciones pendientes (vN → vM): se migran al arrancar el servidor".

### Quién migra

- `openSystemDb(path)`, `openTenantDb(path)` y el `:memory:` de `TenantManager` usan `checkDb`: nunca
  migran datos. Así `create-root.ts`, los scripts y un comercio que se abre después del arranque no
  migran sin copia.
- `initSystemDb` e `initTenantDb` quedan como envolturas de `checkDb` con su schema (los usan muchos
  tests).
- `SYSTEM_DB_PATH` se va (nadie lo usa): la base de sistema es siempre `<DATA_DIR>/system.sqlite`, la
  misma que migra el arranque.
- Solo `runMigrations` migra bases con datos.

### `runMigrations({ dataDir, now, keepRuns = 3, onProgress })` (`run-migrations.ts`)

Es síncrona. La llama el worker.

1. Abre `<dataDir>/system.sqlite`. Si no existe, termina sin nada que hacer: la crea el app al
   arrancar.
2. Lista los comercios de `tenants` (**demos incluidas**) que tienen archivo en
   `<dataDir>/tenants/<id>.sqlite`. Lee `user_version` de cada base y arma el plan.
3. Si alguna base está fuera de rango (anterior a la línea de base o más nueva que el código), falla
   con la lista **sin tocar nada**.
4. Si no hay nada pendiente, devuelve `{ migrated: [] }` sin copias.
5. Copia con `VACUUM INTO` **solo las bases a migrar** a
   `<dataDir>/pre-migracion/<AAAA-MM-DDTHH-MM-SS>/system.sqlite` y `…/tenants/<id>.sqlite`, y borra
   las corridas viejas: deja `keepRuns`.
6. Migra sistema y después cada comercio. Cierra cada base al terminar. Avisa el progreso con
   `onProgress({ file, done, total })` (`file` relativo a `dataDir`: `system.sqlite`,
   `tenants/<id>.sqlite`).
7. Si una base falla, cierra la que estaba abierta y restaura desde la copia las que ya había migrado
   en esta corrida (`restoreRun`). Después tira un `MigrationRunError` con la base, la migración y la
   causa. La que falló no se restaura: su transacción ya la dejó como estaba.

Devuelve `{ runDir, migrated: [{ file, from, to }] }` (`runDir` solo si hubo migraciones).

`restoreRun(runDir, dataDir, files)` copia cada archivo de la corrida encima del original y borra sus
`-wal` y `-shm`. La usan `runMigrations` y el arranque.

El backup nocturno (`backup.ts`) no se toca: solo lee `system.sqlite` y `tenants/`.

## 2. Arranque y modo mantenimiento

### Orquestación (`src/server/startup.ts`)

```typescript
startServer({ port, dataDir, demos, runner, createReadyHandler, log }): Promise<StartedServer>
```

1. `http.createServer((req, res) => current(req, res))`. `current` arranca en el **app de
   mantenimiento** (`phase: 'migrating'`) y el servidor escucha enseguida.
2. Llama a `runner(dataDir, onProgress)`:
   - en producción, `runMigrationsInWorker`, que lanza `migrate-worker.ts` y traduce sus mensajes
     `progress`, `done` y `failed` a una promesa;
   - en los tests, una función.
3. Si `done` llega con `{ runDir, migrated }`, llama a `createReadyHandler()`, que hace `createApp`,
   `bootstrap` y `setupClient` y devuelve el app de Express. Después cambia `current` y loguea
   `[migraciones] listo: N bases migradas`.
4. Si `createReadyHandler` tira un error y hubo `runDir`, cierra las bases (`tenantManager.closeAll()`
   y `systemDb.close()`, si llegaron a abrirse) y restaura las copias de la corrida. Pasa a
   `phase: 'failed'`.
5. Si el runner falla, pasa a `phase: 'failed'` y loguea:
   `[migraciones] FALLÓ <base>, migración v<N> <nombre>: <causa>. Las bases quedaron como estaban.`
6. Con `failed`, **el proceso sigue vivo** atendiendo en mantenimiento. Así no hay un bucle de
   reinicios de systemd, y `deploy.sh` se entera por `/health`.

`server.ts` queda en llamar a `startServer` con el runner del worker y el banner de siempre al pasar
a listo. El camino es el mismo haya o no migraciones pendientes. `createApp` con `:memory:` (los
tests) no cambia.

### El worker (`src/server/db/migrations/migrate-worker.ts`)

Es una envoltura fina: lee `workerData.dataDir`, llama a `runMigrations` y manda `progress`, `done`
o `failed`. Corre con el strip de tipos de Node 24. Se lanza con
`new Worker(new URL('./migrate-worker.ts', import.meta.url), { workerData })`.

### App de mantenimiento (`src/server/maintenance/maintenance-app.ts`)

Es un Express que **no abre ninguna base**. Lleva `allowPrivateNetwork` y `cors()`, como el app real:
sin eso, el POS publicado no puede leer `/info`. Recibe un getter del estado
`{ phase: 'migrating' | 'failed'; progress?: { done: number; total: number } }`.

| Pedido | Respuesta |
|---|---|
| `GET /health` | `503` `{ status: 'maintenance' \| 'migration-failed', service: 'mini-erp', version, progress? }`. El app listo sigue respondiendo `200 { status: 'ok', … }` |
| `GET /connector/info` | `200` con `backendInfo({ status: 'maintenance', message: MAINTENANCE_MESSAGE, demos })`. **Sin validar la key**: no hay base de sistema y la respuesta no revela nada. Nunca `409` |
| Resto de `/connector/*` (push, pull, `account-holds`, `demo-sessions`, también sin key) | `503`, `Retry-After: 30`, `{ code: 'maintenance', message }` |
| `/api/*` | `503`, `Retry-After: 30`, `{ error: message, code: 'maintenance' }` |
| Cualquier otro pedido | `503`, `Retry-After: 30`, la página HTML de mantenimiento |

`MAINTENANCE_MESSAGE` es "mini contax se está actualizando, vuelve en unos minutos".

`backendInfo` se extrae de `connector-routes.ts` a `src/server/connector/backend-info.ts`, así el
`/info` real y el de mantenimiento comparten el armado (contrato, backend, `capabilities`). En
mantenimiento, `demos` sale de `readDemoConfig(process.env)`, que no usa la base.

**Página HTML** (`maintenance-page.ts`): autocontenida, con CSS inline y tokens claro y oscuro por
`prefers-color-scheme`. Lleva el logo del ticket inline, el título "Estamos actualizando mini contax"
y el texto "Vuelve sola en cuanto termine; no hace falta recargar". Un script consulta `/health` cada
5 s y hace `location.reload()` con un `200`; con `<noscript>`, `<meta http-equiv="refresh"
content="15">`. No dice nada de la fase `failed`: para quien usa, es el mismo mantenimiento.

## 3. Admin y alta con el servidor en mantenimiento

La página de la parte 2 cubre la carga inicial. Esto cubre un SPA **ya abierto** cuando el servidor
entra en mantenimiento.

- `src/client/state/maintenance-state.ts`:
  - `maintenanceSignal` (`signal<boolean>`);
  - `isMaintenanceResponse(status, data)`: un `503` con `code: 'maintenance'`;
  - `enterMaintenance()`: prende el signal y arranca un intervalo de 5 s sobre `/health`. Con un
    `200`, `location.reload()`. Los efectos (`fetch`, `reload`, el reloj) son inyectables para los
    tests.
- `apiFetch` (`api/client.ts`): con un 503 de mantenimiento llama a `enterMaintenance()` y tira el
  `ApiError` igual. El `fetch` suelto del export (`bulk-state.ts`) hace lo mismo con
  `noteMaintenanceResponse(res)`. El de `/connector/info` (`settings-state.ts`) no cambia: en
  mantenimiento da `200` con `status: 'maintenance'` y Configuración lo muestra como venga.
- `components/MaintenanceView.tsx`: logo, "Estamos actualizando mini contax", "Vuelve sola en cuanto
  termine; no hace falta recargar" y el `ThemeToggle`. En `App.tsx`, antes del ruteo:
  `if (maintenanceSignal.value) return <MaintenanceView />`.
- **Arreglo en `fetchProfile`** (`auth-state.ts`): hoy cierra la sesión con cualquier error. Pasa a
  cerrarla solo con un `ApiError` `401`. Con otro error (mantenimiento, red, 5xx) conserva la sesión y
  el perfil que tenía.

## 4. Deploy

`deploy/deploy.sh`: `healthy` se reemplaza por `wait_ready`, que lee el código HTTP y el `status` de
`/health` (`curl -s -o "$tmp" -w '%{http_code}'`; el `status` con `grep -o '"status":"[^"]*"'`, sin
depender de `jq`):

| `/health` | Qué hace |
|---|---|
| `200` | Listo |
| `503` con `maintenance` | Sigue esperando, hasta `MIGRATION_TIMEOUT` (900 s). Loguea el progreso cada 30 s |
| `503` con `migration-failed` | Vuelve en el acto a la versión anterior y sale con 1 |
| Sin respuesta durante 30 s seguidos | Vuelve a la versión anterior y sale con 1, como hoy |
| Tope vencido, migrando todavía | **No vuelve atrás**: cortar una migración puede dejar bases en versiones distintas. Sale con 1 y avisa: "la migración sigue corriendo: revisá `journalctl -u mini-erp`" |

`deploy.yml` no cambia: al final sigue comprobando que `/health` responda la versión subida.

## 5. POS (offline-pos, sin cambios acá)

Se verificó en `main` de offline-pos:

- **push y pull con 503**: `sync/request-failed` con status. No cuenta como fallo de red
  (`isNetworkFailure`), así que el POS consulta `/info` antes del próximo ciclo, ve `maintenance` y
  no corre más push ni pull. Las ventas quedan en el outbox y se sincronizan al volver (los lotes son
  idempotentes). `Retry-After` se ignora, lo cual no molesta.
- **`account-holds` con 503**: `resolveAccountReference` (`checkout-controller.ts`) pide el hold si
  `navigator.onLine`. Si falla, devuelve el error: **el cobro a cuenta corriente no se puede hacer**
  mientras dure el mantenimiento (pasa lo mismo hoy con un 502). Issue rauldiazsolis/offline-pos#187:
  caer a la evaluación offline del crédito con un 5xx o en mantenimiento, y documentar el 503 en el
  contrato (rauldiazsolis/offline-pos#173).

## 6. Tests

TDD con Vitest, en `test/`:

- `migrations.test.ts` (`migrateDb` y `checkDb`):
  - una base nueva queda en la versión actual;
  - una base anterior a la línea de base y una más nueva que el código dan error;
  - con un schema de prueba, una `up` que falla deja `user_version` y los datos como estaban;
  - `checkDb` sobre una base atrasada tira el error, no migra.
- `tenant-migration-v2.test.ts`: una base v1 **con datos en todas las tablas** pasa a v2, los datos
  sobreviven y los índices existen. El helper `createDbAtVersion(schema, version)`, en
  `test/helpers/`, sirve para las migraciones que vengan.
- `run-migrations.test.ts`, en un directorio temporal:
  - migra sistema, comercios y demos;
  - copia en `pre-migracion/` solo lo que migra y deja `keepRuns` corridas;
  - sin nada pendiente, no copia nada;
  - una base fuera de rango frena todo sin tocar nada;
  - un comercio que falla a mitad (schema de prueba inyectado) restaura los ya migrados;
  - `restoreRun` borra `-wal` y `-shm`.
- `maintenance-app.test.ts`: la tabla de la parte 2 (las dos fases de `/health`, `/info` sin key con
  CORS y el preflight de red privada, push, pull, `account-holds` y `demo-sessions` con `503` y
  `Retry-After`, `/api`, la página HTML).
- `startup.test.ts`, con un runner inyectable y puerto 0:
  - mantenimiento → listo;
  - un runner que falla deja el servidor en mantenimiento con `migration-failed`;
  - un `createReadyHandler` que falla restaura la corrida y queda en `failed`;
  - un caso con el **worker real** sobre un directorio temporal con una base v1.
- Cliente:
  - `apiFetch` prende el signal con un `503 maintenance` y no con otro `503`;
  - la vuelta: `/health 200` llama a `reload`;
  - `fetchProfile` conserva la sesión con un `503` y la cierra con un `401`.
- Los tests que usan `initSystemDb` o `initTenantDb` se adaptan.
- e2e: el recorrido no cambia. Playwright espera a que `/health` dé `200`, así que el arranque en dos
  fases ya queda ejercitado.

## 7. Docs y versión

- `AGENTS.md`, en Arquitectura:
  - una sección "Migraciones de esquema": **ninguna etapa cambia el esquema sin una migración**, cómo
    escribirla (agregarla a la lista, no tocar la línea de base, una transacción por migración, test
    desde la versión anterior con datos);
  - el arranque en dos fases y el modo mantenimiento;
  - se va "Esquema de sistema 4, sin migraciones".
- `deploy/README.md`:
  - cómo se ve un deploy con migraciones (`journalctl`, `/health`);
  - qué hacer si falla;
  - el rollback manual con `pre-migracion/` y que se pierde lo escrito después de migrar;
  - se reemplazan los párrafos de "bases viejas".
- Versión 0.4.0 en el PR (`pnpm version minor --no-git-tag-version`); el tag va después del merge.

## Criterios de aceptación

1. La 0.4.0 (con comercio v2) se publica sobre una base con datos: los datos sobreviven, sin borrar
   nada, y queda una copia en `pre-migracion/`.
2. Mientras migra, el POS ve "en mantenimiento" y sigue vendiendo, y el admin muestra la pantalla de
   actualización.
3. Al terminar, el POS sincroniza lo que vendió mientras tanto.
4. Una migración que falla deja la base como estaba, y el deploy vuelve a la versión anterior.

Los criterios 2 y 3 se prueban en local con una migración lenta de prueba (un `up` que espera), que
no se commitea.
