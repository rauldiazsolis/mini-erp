# De SQLite a PostgreSQL con Kysely

Fecha: 2026-11-11. Estado: **aprobada**; en curso (fases 1 a 4 hechas) (ver "Estado"). Reemplaza, cuando termine, la spec de
migraciones `2026-10-02-migraciones-mantenimiento-design.md` en todo lo que es de SQLite.

## Objetivo

Toda la persistencia del mini-erp pasa de `node:sqlite` (`DatabaseSync`, síncrono, un archivo por
comercio) a **PostgreSQL** con **Kysely** como query builder tipado. SQLite se elimina por completo:
no queda un modo dual ni un adaptador.

## Lo que hay hoy (inventario del 2026-11-11)

| Qué | Cuánto |
|---|---|
| Sentencias SQL en `src/server` | ~427 (`.prepare`/`.exec`), en ~45 archivos |
| Servicios de sistema (singletons de Hardwired) | ~20 clases, ~190 sentencias |
| Servicios de comercio (`fn.scoped` sobre `tenantDbDef`) | ~10 clases más funciones sueltas, ~150 sentencias |
| Rutas y middleware | 25 archivos de `routes/` (109 endpoints) y 3 middlewares, **ninguno `async`** |
| Tablas | 27 de sistema, 14 por comercio |
| Tests | 157 archivos; 98 tocan el servidor, 68 importan `node:sqlite`, ~426 SQL crudos en tests |
| Tests que solo existen por SQLite | 11 `*-migration-v*`, `run-migrations`, `worker-runner`, el helper `db-at-version` |
| e2e que abren el `.sqlite` | `demo-onboarding`, `demo-v2`, `funnel` |

Lo que no porta tal cual: `PRAGMA user_version`, `sqlite_master`, `VACUUM INTO`, `rowid` como
desempate de orden (16 lugares), `INSERT OR IGNORE` (5), `.changes` (8), `json_extract`/`json_each`
(~26), `group_concat`, `date(x,'-3 hours')`, `LIKE` sin distinguir mayúsculas (3 búsquedas),
`HAVING` con alias y subconsultas sin alias (dashboard y billing), booleanos 0/1, y las FK, que hoy
están declaradas pero **nunca se aplican** (no se prende `PRAGMA foreign_keys`).

Nada cruza hoy la base de sistema y la de un comercio dentro de una transacción: eso es lo que deja
migrar por bloques (primero sistema, después comercio).

## Decisiones

Aprobadas el 2026-11-11, con el plan.

| Tema | Decisión | Por qué / alternativa |
|---|---|---|
| Driver | `pg` con el `PostgresDialect` que trae Kysely | Es el dialecto propio de Kysely. `postgres` (0 dependencias) pide un adaptador de terceros |
| Esquemas | Una base. Esquema **`system`** para lo global y **`tenant_<id>`** por comercio | `system` explícito: nada depende de `public` ni del `search_path` |
| Aislamiento | `tenantDbDef` pasa a `unbound<Kysely<TenantDatabase>>`, ya acotado con `withSchema`; lo arma **un solo** lugar (`Database.forTenant`, en `db/pg/database.ts`) | Igual que hoy: resolverlo desde el contenedor raíz falla. `SET search_path` se descarta: con un pool, se filtra entre requests |
| Tipos | Un manifiesto de columnas por esquema (`db/pg/system-schema.ts`, `tenant-schema.ts`), del que salen los tipos de Kysely; `test/pg-schema.test.ts` lo compara con la base real | Una sola fuente, sin generador ni dependencia extra |
| Instantes | `timestamptz`. Se leen como texto ISO en UTC (`2026-11-11T12:00:00.000Z`), que es lo que ya viaja en la API | Los servicios y los tipos de la API siguen con `string` |
| Días | `date`, leído como `YYYY-MM-DD`: `day`, `tenants.grace_until`, `sales.ticket_date`, `customer_payments.receipt_date` | Un día argentino no tiene hora ni zona |
| Dinero | `numeric(14,2)` (precios, saldos, montos, cargos) | Se lee como `number`, compatible con el JSON del contrato |
| Cantidades | `numeric(14,4)` (stock y movimientos: pesables y fracciones); `tax_rate`, `numeric(7,4)` | Idem |
| Enteros grandes | `bigint` leído como `number` (`count(*)`, `seq`, números de ticket y de recibo) | El contrato no pone tope al número de ticket |
| JSON | `jsonb` para payloads, lotes, `barcodes`, `details`, `data`, `pending`; se escribe con `jsonValue()` | `pg` convierte un array de JS en un array de PostgreSQL, no en JSON |
| Búsquedas | Extensión `unaccent` (en `public`) y `lower(unaccent(…))` con `LIKE`: helpers `searchable()` y `searchPattern()` | Sin distinguir mayúsculas ni tildes; los `%` y `_` del usuario se escapan |
| Orden de textos | Las bases se crean con `LC_COLLATE 'C'` y `LC_CTYPE 'C.UTF-8'` | El orden de un listado no depende de la máquina y es el de SQLite (por bytes) |
| Booleanos | `boolean` | — |
| `rowid` | Columna `seq bigint generated always as identity` donde se ordenaba por `rowid` o por orden de inserción | — |
| FK | Se declaran y **ahora se aplican**. `stock_movements.product_id` queda sin FK: el kardex guarda el movimiento de un producto desconocido (el push nunca rechaza) | Los tests van a encontrar huérfanos que hoy pasan |
| Migraciones | Runner propio (`db/pg/migrations/migrate.ts`): tabla `schema_migrations` en `system` y en cada `tenant_<id>`; un candado (`pg_try_advisory_lock`, con reintento) deja migrar a uno solo | El `Migrator` de Kysely corre todo en una transacción: no sirve para `CREATE INDEX CONCURRENTLY`. El candado bloqueante se traba con `CONCURRENTLY` |
| Línea de base | La v1 de cada esquema, en PostgreSQL. **Se congela al publicar** (fase 6): hasta entonces las fases 3 y 4 pueden corregirla. Las migraciones de SQLite y sus tests se borran en la fase 5 | No hay clientes en producción |
| `legacy_demo_sessions` | No se migra: la tabla y `sweepLegacy` se borran en la fase 3 | Era la limpieza de las demos de antes de M8 |
| Datos de producción | PostgreSQL arranca vacío (se vuelve a correr `create-root`); el último backup de SQLite queda en el volumen. Sin script de importación | Decisión del usuario |
| Arranque | Sigue en dos fases (mantenimiento → migra → app). El worker se elimina | Con E/S asíncrona, migrar no bloquea el event loop |
| Alta de un comercio | `createTenantSchema` corre por fuera de la transacción del alta; si el alta falla, se compensa con `dropTenantSchema` | Una migración no transaccional no puede correr dentro de la transacción de otro |
| Copia previa a migrar | `pg_dump` en `deploy.sh`, antes de activar la versión | Reemplaza `pre-migracion/` y `restoreRun` |
| Express | **Express 5** (fase 2) | Propaga los rechazos de un handler `async` |
| `await` olvidados | `no-floating-promises` y `no-misused-promises`, que ya están prendidas (`strictTypeChecked`) | `tsc` no detecta una promesa sin `await` |
| Tests | PostgreSQL real (`TEST_DATABASE_URL`, nunca `DATABASE_URL`). `globalSetup` arma una base plantilla ya migrada; cada archivo clona la de su worker (`setupTestDb()`), que se vacía antes de cada test | `pglite` y `pg-mem` se descartan: no son el motor de producción |
| e2e | `e2e/serve.ts` recrea la base `minierp_e2e`; los specs que leían el `.sqlite` consultan con `pg` | — |
| CI | `services: postgres:16` en `ci.yml` | Ubuntu 24.04 trae la 16: mismo major que producción |
| Producción | PostgreSQL 16 de apt en la misma instancia, con los datos en el volumen adicional; socket Unix con `peer` | `DATABASE_URL` sin contraseña: `/etc/mini-erp/env` sigue sin secretos |
| Memoria (512 MB) | `shared_buffers=64MB`, `work_mem=2MB`, `maintenance_work_mem=32MB`, `max_connections=20`; pool `max: 10` | — |
| Backup | `pg_dump -Fc` diario, sin los esquemas de demo, 7 días | Reemplaza `VACUUM INTO` |
| Subagentes | Habilitados **solo para esta migración** (lectura extensa, un servicio con sus tests); la regla general de `AGENTS.md` no cambia | Decisión del usuario |

## Reglas para `AGENTS.md`

El texto vigente está en la sección "Persistencia" de `AGENTS.md`; esto es el resumen. Las marcadas con (lint) o (test) las hace cumplir
una herramienta, no la revisión.

1. **Un esquema por comercio.** `system` tiene lo global; `tenant_<id>`, lo de cada comercio. El
   nombre sale solo de `tenantSchemaName(id)`, que valida el id (caracteres y 63 bytes).
2. **Los servicios reciben su Kysely ya acotado.** Un servicio de comercio recibe
   `Kysely<TenantDatabase>` del scope de Hardwired; nunca el pool, nunca un nombre de esquema, nunca
   un `tenant_id` para filtrar. `withSchema` se llama en un solo archivo (test).
3. **SQL crudo sin nombres de tabla.** Dentro de `sql\`…\`` una tabla va con `sql.table()` o
   `sql.ref()`, nunca escrita en el texto: `withSchema` no alcanza a un nombre escrito a mano (test).
4. **Todo el acceso a datos es `async`.** Sin promesas sueltas (lint). Un handler de Express es
   `async` y deja que el error suba.
5. **Transacciones con `db.transaction().execute()`**, pasando el `trx` hacia abajo. Dentro de una
   transacción no se pide otra conexión al pool ni se espera nada que no sea la base (HTTP, timers):
   con `max: 10`, eso es un deadlock.
6. **Columnas explícitas.** Sin `.selectAll()`, `SELECT *` ni `returningAll()` en `src/server`
   (test): una columna nueva no cambia lo que lee el código viejo.
7. **Migraciones Expand & Contract.**
   - Una columna nueva es nullable o tiene un `DEFAULT` constante; nunca `NOT NULL` sin default.
   - Renombrar o borrar es en dos versiones: primero se deja de usar, después se quita.
   - Un índice sobre una tabla con datos se crea con `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, en
     una migración marcada `transactional: false`, que el runner corre fuera de una transacción y
     que tiene que poder repetirse.
   - `up` no abre transacciones ni depende de datos de fuera de su esquema.
8. **La línea de base no se toca**; cada cambio de esquema es una migración nueva con su test.
9. **Un solo pool**, `max: 10`, creado en un solo lugar. Scripts y tests lo cierran al terminar.
10. **Los tests corren contra PostgreSQL** (`DATABASE_URL`), con la base del worker; ninguno crea un
    pool propio.

## Plan por fases

Cada fase termina con `pnpm lint && pnpm typecheck` y los tests que le tocan, un resumen y un
mini-prompt para seguir en una sesión nueva. No se pasa a la siguiente sin confirmación.

| Fase | Qué | Queda verde |
|---|---|---|
| 1. Cimientos (hecha) | `kysely` y `pg`; pool; tipos; línea de base en PG; runner de migraciones (transaccional y no); `tenantSchemaName` y `forTenant`; infraestructura de tests y servicio de PG en el CI; tests guardianes (aislamiento entre dos comercios, tipos contra el esquema). **No toca servicios**: SQLite sigue andando | Suite completa, más los tests nuevos |
| 2. Asincronía sobre SQLite | Express 5; servicios, rutas, middleware, barridos, arranque y tests pasan a `async/await`, todavía con SQLite debajo. Cambio mecánico, por dominio | Suite completa y e2e |
| 3. Sistema a PostgreSQL | Las 27 tablas de sistema y sus ~20 servicios, `TenantManager` (su parte de sistema), `AppDependencies` y sus tests. Los comercios siguen en SQLite | Suite completa y e2e |
| 4. Comercio a PostgreSQL | Esquema por comercio, `tenantDbDef`, catálogo, stock, clientes, ventas, dashboard, connector (lote con savepoint por evento), discrepancias, importación, semillas, reinicio de demos, reconciliación | Suite completa y e2e |
| 5. Adiós SQLite | Se borran migraciones viejas, worker, `pre-migracion`, sus tests y `db-at-version`; arranque en dos fases con el runner nuevo; `create-root`; e2e sin `.sqlite`; guardián "nada importa `node:sqlite`" | Suite completa y e2e |
| 6. Infraestructura | `provision.sh` (PostgreSQL, ajuste de memoria, volumen), `env.example`, `deploy.sh` (`pg_dump` previo), backup con `pg_dump`, units de systemd, `deploy/README.md`, `README.md`, `AGENTS.md` definitivo, `docs/historia.md`, versión | Suite, e2e, y el backup y su restauración probados en local |

Dentro de las fases 3 y 4, cada dominio se delega a un subagente (servicio más sus tests) y este
hilo revisa la arquitectura y corre la verificación. Mientras dura una de esas fases, los commits
intermedios se verifican con el typecheck y los tests del dominio migrado; la suite entera vuelve a
verde al cerrar la fase.

**Rama del epic y merge a `main`** (decisión del usuario, 2026-11-12): todas las fases se juntan en
la rama `epic/postgres-kysely` y entran a `main` juntas, en un solo PR, al terminar la fase 6 (en el
medio, el sistema está en PostgreSQL y los comercios en SQLite, y eso no se publica). Cada sesión
trabaja en su rama, que parte de `epic/postgres-kysely`; al cerrar la fase se mergea ahí con merge
commit, **sin PR**, se sube y se borra la rama de la sesión (local y remota).

## Estado

- **Fase 1, hecha** (2026-11-11): `src/server/db/pg/` (pool, manifiesto y tipos, líneas de base,
  runner), `test/helpers/` (`pg-admin`, `pg-global-setup`, `test-db`), los tests `test/pg-*.test.ts`
  y PostgreSQL en el CI. Ningún servicio lo usa todavía.
- **Fase 2, hecha** (2026-11-12): Express 5 (`routeParam` en `src/server/http/route-param.ts`, porque
  sus tipos dan `req.params` como `string | string[]`; el catch-all del cliente es `/{*splat}`). Todo
  el acceso a datos de `src/server` es `async` con node:sqlite debajo: servicios, rutas, middleware,
  barridos (esperan el primer pase y su intervalo loguea los errores, ya no tira el proceso),
  bootstrap, semillas, backup y tests. Quedan síncronos a propósito `getTenantDb`/`closeAll`,
  `openSystemDb`/`openTenantDb`/`checkDb`, las migraciones de SQLite y algunos helpers privados de
  `FunnelQueryService` (se convierten en la fase 3). Adentro de una transacción de SQLite solo se
  espera código de cuerpo síncrono, así ningún otro request se intercala en la conexión.
  `@typescript-eslint/require-await` está apagada en servidor, scripts y tests hasta la fase 5.

- **Fase 3, hecha** (2026-11-12): las tablas de sistema y sus servicios están en el esquema `system`
  (Kysely sobre `Database.system`, `systemKyselyDef` en el contenedor); los comercios siguen en SQLite.
  - **El executor va al final y es opcional** (`metodo(…, db = this.db)`): quien abre la transacción
    pasa el `trx` a los demás servicios (auditoría, cuentas, cajas, bono, embudo). Las lecturas que no
    son de PostgreSQL se hacen antes de abrir la transacción.
  - **Un link de un uso** (invitación, restablecimiento, soporte, portal) se marca con un `UPDATE`
    condicional; si no actualizó, se deshace todo y da `410`. Igual los `409` de estado (suspender).
  - **El saldo pagado de un titular** se escribe con `lockHolder` (`pg_advisory_xact_lock`) dentro de
    su transacción: dos cargos a la vez no gastan de más.
  - **El alta** es una transacción de sistema (`TenantManager.createTenantRecord`) y después del commit
    crea la base del comercio (`initTenantStorage`); si eso falla, compensa (borra el comercio, sus
    bonos y la cuenta nueva). La liga con la demo ahora va adentro: un error de base aborta el alta.
  - **Demos**: `demoTenantIds(db)` e `isDemoTenant(db, id)` (`demo/demo-tenant-ids.ts`) reemplazan a
    `DEMO_TENANT_IDS_SQL`. Revocar una demo es una sola transacción. `legacy_demo_sessions` y
    `sweepLegacy`, borrados.
  - **Arranque**: `migrateSystem` corre en la fase de mantenimiento, antes de las migraciones de
    SQLite, que ahora son solo de comercio (`runMigrations` mira `tenants/*.sqlite`). Nadie abre
    `system.sqlite` (guardián en `test/pg-guards.test.ts`). `create-root` y la semilla de desarrollo
    escriben en PostgreSQL.
  - **Backup**: copia solo las bases de comercio; el sistema queda para el `pg_dump` de la fase 6.
  - **Tests y e2e**: ninguno usa SQLite de sistema; el e2e recrea `minierp_e2e` (`e2e/serve.ts`) y
    consulta el sistema con `e2e/system-db.ts`. `dropDb` reintenta si un autovacuum tiene la base (el
    rol local no es superusuario).
  - **Para la fase 4**: `gift_credits` no tiene FK a `tenants` en la línea de base (el alta la borra a
    mano al compensar); se puede agregar con `ON DELETE CASCADE` mientras la v1 no esté congelada.
    (Hecho en la fase 4.)

- **Fase 4, hecha** (2026-11-13): los datos de cada comercio están en su esquema `tenant_<id>`;
  ningún servicio, semilla ni ruta lee o escribe un `.sqlite`. Lo decidido, en "Decidido en la fase
  4" (abajo).
  - **Comercio**: `tenantDbDef` es `unbound<Kysely<TenantDatabase>>`, enlazado solo por
    `createTenantScope(root, tenantId)` con `Database.forTenant`. `TenantManager` recibe solo la
    `Database` (sin caché, `getTenantDb` ni archivos) y da `forTenant(id)` a los servicios de sistema
    (demos, reconciliación, semillas). Los middlewares ya no ponen una base en el pedido.
  - **Funciones compartidas que escriben varias tablas** reciben `db` y, si no es una transacción
    (`db.isTransaction`), abren la suya: `writeStock`, `postToBalance`, `applyPendingFor`,
    `applyPreset`, los `save*` de `records.ts`. Así el push, la importación y las semillas les pasan
    su `trx`.
  - **Sumas en SQL**: el stock (fila bloqueada con `FOR UPDATE`, `quantity + delta`) y el saldo
    (`coalesce(balance, 0) + round(delta, 2) RETURNING`), así el kardex y el extracto cuadran con
    escrituras simultáneas. Estados que se pisan (reservas, discrepancias) con `UPDATE` condicional.
  - **El push**: el lote se toma con `INSERT … ON CONFLICT DO NOTHING RETURNING` (un pedido repetido
    o simultáneo devuelve el estado guardado sin repetir efectos), se aplica **de a un lote por
    comercio** (la fila de la primera sucursal, `FOR NO KEY UPDATE`: dos lotes que tocan los mismos
    clientes en otro orden no se traban) y cada evento va en `inSavepoint` (`sql-helpers.ts`; en
    Kysely 0.29 `savepoint()` solo existe en `ControlledTransaction`). Un error pasajero
    (`isTransientError`: deadlock, serialización) no queda como aviso del evento: tumba el lote y el
    POS lo reintenta. Un `stock-movement` reenviado en otro lote ya no vuelve a sumar (bug de
    SQLite). Las reservas bloquean al cliente: dos pedidos a la vez no aprueban más que el límite.
  - **La importación** corre en una transacción; la vista previa la deshace con un error centinela y
    cada fila que escribe va en su savepoint (un choque de unicidad es error de esa fila).
  - **`seq`** también en `stock_movements` (el kardex se lista por inserción). `sales`,
    `customer_payments` y `cash_movements` desempatan por `id` (el cursor es `[day, created_at, id]`).
  - **Ojo con `sql.table()`/`sql.ref()`**: en una sentencia cruda **raíz** (`sql\`…\`.execute(db)`)
    no reciben el esquema de `withSchema`; solo dentro de un query builder. Toda consulta de comercio
    arranca de `selectFrom`/`insertInto`/`updateTable`/`deleteFrom`.
  - **Lo de SQLite que queda** (se va en la fase 5): las migraciones de `db/migrations/`, el worker,
    `db/tenant-db.ts` y sus tests (que arman sus `.sqlite` con `openTenantDb`), y `runMigrations` en
    el arranque, que ya no encuentra bases. El **backup** sigue copiando `.sqlite` (ya no hay): hasta
    el `pg_dump` de la fase 6 no respalda nada de los comercios; no se publica antes. Guardián en
    `test/pg-guards.test.ts`: fuera de eso, nadie abre SQLite.
  - **Tests y e2e**: todos sobre PostgreSQL (`db().forTenant(id)`); el e2e lee las ventas y precios
    del comercio con `e2e/system-db.ts` (`salesOf`, `productPrice`).

## Decidido en la fase 4 (2026-11-12)

Lo que quedaba "para decidir", resuelto antes de migrar los comercios.

1. **Fechas imposibles e instantes ilegibles: se validan en la frontera, como el resto del evento.**
   En `push-events.ts`, `ticket.date` y `receipt.date` tienen que ser un día que existe
   (`z.iso.date()`: `2026-02-31` no pasa) y todo `createdAt` (el del sobre, el de la venta, la
   cobranza y el movimiento de caja), un instante ISO 8601 con zona (`z.iso.datetime({ offset: true })`,
   el `date-time` del contrato). Un evento que no cumple queda como `issue` del lote con su
   `eventId`, igual que uno con el total mal: no se guarda nada suyo y el resto del lote se aplica.
   No se adivina una fecha: el día de una venta decide el cargo de uso y el resumen de caja.
   Un instante se escribe siempre normalizado (`toISOString()`), y lo que igual se le escape a la
   validación (un año fuera de rango) lo ataja el savepoint del evento.
2. **Redondeo en comercio: depende de quién manda el número.**
   - **Push del POS: nunca se rechaza por decimales.** Un total del POS es coma flotante
     (`0.1 + 0.2`), así que exigir 2 decimales rechazaría ventas buenas. La columna redondea al
     centavo (`sales.total`, el importe de un movimiento de cuenta corriente) y el `payload` guarda
     lo que mandó el POS, sin tocar. El saldo se suma en SQL sobre `numeric`: ya no acumula error
     de coma flotante. Las cantidades (stock y kardex) se redondean a 4 decimales.
   - **Admin: se valida.** Precio, límite de crédito, margen, cobranza y ajuste de cuenta corriente
     entran con a lo sumo 2 decimales (`hasAtMostTwoDecimals` de `src/shared/money.ts`); con más,
     `400` "Importe inválido". Los negativos y el cero siguen valiendo donde valían.
   - **Importación: la fila con error.** Un precio, un límite, un margen o un saldo inicial con más
     de 2 decimales da el error en esa fila (se ve en la vista previa) y el resto se importa.
3. **FK que cambian comportamiento.**
   - **`stock.product_id` queda sin FK**, igual que el kardex: el push de stock de un producto que
     el comercio no tiene se guarda (el push nunca rechaza) y, cuando el producto aparece, su stock
     ya está bien. Borrar un producto (`hard`) borra su stock a mano, en la misma transacción; el
     kardex queda. `stock.branch_id` conserva su FK.
   - **Un cliente con cuenta corriente no se borra.** `account_movements` y `account_holds` pasan
     de `ON DELETE CASCADE` a sin acción: el borrado `hard` de un cliente con movimientos o
     reservas da `409` ("tiene movimientos: archivalo") en vez de llevarse el libro. El admin solo
     archiva; el reinicio parcial de demos ya borraba solo clientes sin movimientos.
4. **`\u0000` en un lote: se quita al entrar.** PostgreSQL no lo admite ni en `text` ni en `jsonb`.
   El push limpia el lote entero (`stripNul`, en claves y valores) antes de guardarlo y de aplicar
   cada evento; `jsonValue()` hace lo mismo con todo lo que va a `jsonb`. Un carácter nulo nunca es
   un dato: no vale perder una venta por él.
5. **Slugs largos: `slugify` corta en 48 caracteres** (sin dejar un guion al final). El esquema
   admite 56 (`tenant_` más el id entran en los 63 bytes de un identificador): quedan 8 para el
   `-2`, `-3` que desambigua `TenantManager`.
6. **`gift_credits.tenant_id` tiene FK a `tenants` con `ON DELETE CASCADE`** (línea de base de
   sistema, todavía sin congelar): al compensar un alta, el bono se va con el comercio.

Además:

- **El día argentino en SQL** es `argentinaDay(expr)` (`db/pg/sql-helpers.ts`):
  `((x - interval '3 hours') AT TIME ZONE 'UTC')::date`, UTC−3 fijo como en
  `src/shared/argentina-day.ts`, sin depender de la zona de la sesión ni de `tzdata`.
- **`TenantManager` recibe la `Database`**: crea el esquema (`createTenantSchema`), pone la sucursal
  por defecto y, si eso falla, lo borra (`dropTenantSchema`). Un servicio de sistema que necesita
  los datos de un comercio (demos, reconciliación, semillas) los pide con
  `TenantManager.forTenant(id)`, que es `Database.forTenant`.
- **El arranque migra todo PostgreSQL** (`migrateAll`: `system` y el esquema de cada comercio).
- **El reinicio total de una demo** vacía las tablas del manifiesto (`TENANT_TABLES`) con un
  `DELETE` por tabla (las referenciadas, `branches` y `customers`, al final), en la misma
  transacción que vuelve a sembrar. No es `TRUNCATE`: una sentencia cruda no recibe el esquema de
  `withSchema`, son pocos cientos de filas y un `DELETE` no bloquea los pulls mientras tanto. Las
  columnas `seq` no se reinician (solo desempatan).
- **Las semillas escriben por lotes**: un insert de varias filas por tabla (`inChunks`, de a 500),
  una transacción por comercio, y el stock y el saldo finales calculados en memoria. Las filas
  salen de los mismos módulos que el push (`saveSales` y compañía en `records.ts`,
  `postSeriesToBalance` en `account-ledger.ts`, `setStockMany` en `write-stock.ts`).

## Decidido en la fase 5 (2026-11-13)

1. **Backup: se borra el de SQLite y el script falla a propósito hasta la fase 6.**
   `src/server/backup/backup.ts` (`VACUUM INTO` de `.sqlite` que ya no existen) y `test/backup.test.ts`
   se borran: no respaldan nada y son lo último que abre SQLite. `scripts/backup.ts` queda, porque lo
   corre `mini-erp-backup.timer`, pero sale con error ("pendiente: pg_dump, fase 6"): un backup que no
   copia nada no puede terminar en verde. La fase 6 lo reescribe con `pg_dump -Fc` (sin los esquemas de
   demo, 7 días). Nada de esto se publica antes de la fase 6.
2. **Reinicio total contra un push simultáneo: se cierra** (era el punto 2 de "Para decidir").
   - El reinicio **revoca primero** las cajas de visitante (transacción de sistema) y recién después
     vacía y siembra el comercio. Si la siembra falla, las demos ya quedaron cortadas: el barrido
     reintenta a los 15 minutos, y es lo mismo que vería el visitante con el reinicio hecho.
   - Dentro de su transacción, el reinicio **toma primero el candado de lote** del push (la fila de la
     primera sucursal, `FOR UPDATE`): el push y el reinicio ya no se traban en otro orden.
   - Un push que esperaba ese candado y lo recibe después del reinicio no encuentra la fila (el
     reinicio la borró y sembró otra, que su sentencia no ve): lo toma como **error pasajero**, deshace
     el lote y el POS lo reintenta, ya con la key revocada (`401`, "la demo terminó"). Nada del
     visitante queda en el comercio recién sembrado.
   - Las escrituras sueltas del admin anónimo durante el reinicio no se cubren: son de a una fila y la
     ventana es de milisegundos.

## Para decidir en las fases que siguen

1. **Atomicidad nueva**: con una sola base, el push (lote, cargo y embudo) y el alta podrían ser una
   transacción. No se cambia en esta migración; issue aparte.
2. ~~**Reinicio total de una demo contra un push simultáneo**~~ (cerrado en la fase 5, ver arriba): con SQLite era sincrónico. Ahora un
   push que confirma justo después del reinicio puede dejar filas en el comercio recién sembrado (la
   key del visitante se revoca después, fuera de la transacción), o un deadlock hace fallar el
   reinicio (el barrido lo reintenta a los 15 minutos; el manual da 500). La ventana es chica; se
   puede cerrar tomando en el reinicio el mismo candado de lote que el push.
