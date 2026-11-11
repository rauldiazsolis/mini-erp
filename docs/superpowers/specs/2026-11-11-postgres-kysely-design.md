# De SQLite a PostgreSQL con Kysely

Fecha: 2026-11-11. Estado: **propuesta, sin aprobar**. Reemplaza, cuando termine, la spec de
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

| Tema | Decisión propuesta | Por qué / alternativa |
|---|---|---|
| Driver | `pg` con el `PostgresDialect` que trae Kysely | Es el dialecto propio de Kysely. `postgres` (0 dependencias) pide un adaptador de terceros (`kysely-postgres-js`): no son equivalentes |
| Esquemas | Una base. Esquema **`system`** para lo global y **`tenant_<id>`** por comercio | `system` explícito: nada depende de `public` ni del `search_path` |
| Aislamiento | `tenantDbDef` pasa a `unbound<Kysely<TenantDatabase>>`, ya acotado con `withSchema`; lo arma **un solo** lugar (`forTenant`) | Igual que hoy: resolverlo desde el contenedor raíz falla. `SET search_path` se descarta: con un pool, se filtra entre requests |
| Tipos | `SystemDatabase` y `TenantDatabase` escritos a mano en `src/server/db/schema/`, con un test que los compara contra `information_schema` | Sin generador ni dependencia extra |
| Fechas | Siguen como `text` ISO; la base se crea con **collation `C`** | Comportamiento idéntico al de hoy (43 comparaciones de texto, orden por bytes como SQLite). `timestamptz` queda para un issue aparte |
| Dinero y cantidades | `double precision` (lo que hoy es `REAL`) | Mismo comportamiento. Pasar a `numeric` cambia redondeos y el driver lo devuelve como string: issue aparte |
| JSON | `jsonb` para payloads, lotes, `barcodes`, `details` | Reemplaza `json_extract` por operadores con índice posible |
| Booleanos | `boolean` | — |
| `rowid` | Columna `seq bigint generated always as identity` donde hoy se ordena por `rowid` | — |
| FK | Se declaran y **ahora se aplican**; `deleteTenant` es `DROP SCHEMA … CASCADE` más el borrado en `system` | Los tests van a encontrar huérfanos que hoy pasan |
| Migraciones | Runner propio (el actual, adaptado): tabla `schema_migrations` en `system` y en cada `tenant_<id>`, `pg_advisory_lock` para que migre uno solo | El `Migrator` de Kysely corre todo en una transacción: no sirve para `CREATE INDEX CONCURRENTLY` |
| Línea de base | Una nueva, en PostgreSQL (sistema v1, comercio v1). Las migraciones de SQLite y sus tests se borran | No hay clientes en producción |
| Arranque | Sigue en dos fases (mantenimiento → migra → app). El worker se elimina | Con E/S asíncrona, migrar no bloquea el event loop |
| Copia previa a migrar | `pg_dump` en `deploy.sh`, antes de activar la versión | Reemplaza `pre-migracion/` y `restoreRun` |
| Express | Subir a **Express 5** | Propaga los rechazos de un handler `async`; en Express 4 un error sin capturar cuelga el pedido |
| `await` olvidados | Lint con tipos: `no-floating-promises` y `no-misused-promises` en `src/server`, `scripts` y `test` | `tsc` no detecta una promesa sin `await` |
| Tests | PostgreSQL real. Una base por worker de Vitest, clonada de una plantilla ya migrada; antes de cada test, `TRUNCATE` de `system` y `DROP` de los `tenant_*` | `pglite` y `pg-mem` se descartan: no son el motor de producción |
| e2e | `e2e/serve.ts` recrea la base `minierp_e2e`; los specs que leían el `.sqlite` consultan con `pg` | — |
| CI | `services: postgres:16` en `ci.yml` y `DATABASE_URL` | Ubuntu 24.04 trae la 16: mismo major que producción |
| Producción | PostgreSQL 16 de apt en la misma instancia, con los datos en el volumen adicional; socket Unix con `peer` | `DATABASE_URL` sin contraseña: `/etc/mini-erp/env` sigue sin secretos |
| Memoria (512 MB) | `shared_buffers=64MB`, `work_mem=2MB`, `maintenance_work_mem=32MB`, `max_connections=20`; pool `max: 10` | — |
| Backup | `pg_dump -Fc` diario, sin los esquemas de demo, 7 días | Reemplaza `VACUUM INTO` |

## Reglas para `AGENTS.md`

Texto propuesto para la sección "Persistencia". Las marcadas con (lint) o (test) las hace cumplir
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
| 1. Cimientos | `kysely` y `pg`; pool; tipos; línea de base en PG; runner de migraciones (transaccional y no); `tenantSchemaName` y `forTenant`; infraestructura de tests y servicio de PG en el CI; lint de promesas; tests guardianes (aislamiento entre dos comercios, tipos contra el esquema). **No toca servicios**: SQLite sigue andando | Suite completa, más los tests nuevos |
| 2. Asincronía sobre SQLite | Express 5; servicios, rutas, middleware, barridos, arranque y tests pasan a `async/await`, todavía con SQLite debajo. Cambio mecánico, por dominio | Suite completa y e2e |
| 3. Sistema a PostgreSQL | Las 27 tablas de sistema y sus ~20 servicios, `TenantManager` (su parte de sistema), `AppDependencies` y sus tests. Los comercios siguen en SQLite | Suite completa y e2e |
| 4. Comercio a PostgreSQL | Esquema por comercio, `tenantDbDef`, catálogo, stock, clientes, ventas, dashboard, connector (lote con savepoint por evento), discrepancias, importación, semillas, reinicio de demos, reconciliación | Suite completa y e2e |
| 5. Adiós SQLite | Se borran migraciones viejas, worker, `pre-migracion`, sus tests y `db-at-version`; arranque en dos fases con el runner nuevo; `create-root`; e2e sin `.sqlite`; guardián "nada importa `node:sqlite`" | Suite completa y e2e |
| 6. Infraestructura | `provision.sh` (PostgreSQL, ajuste de memoria, volumen), `env.example`, `deploy.sh` (`pg_dump` previo), backup con `pg_dump`, units de systemd, `deploy/README.md`, `README.md`, `AGENTS.md` definitivo, `docs/historia.md`, versión | Suite, e2e, y el backup y su restauración probados en local |

Dentro de las fases 3 y 4, cada dominio se delega a un subagente (servicio más sus tests) y este
hilo revisa la arquitectura y corre la verificación. Mientras dura una de esas fases, los commits
intermedios se verifican con el typecheck y los tests del dominio migrado; la suite entera vuelve a
verde al cerrar la fase.

**Qué se puede mergear y publicar**: las fases 1 y 2 van a `main` solas (producción sigue en
SQLite). Las fases 3 a 6 se juntan y entran a `main` juntas, con el cambio de producción: en el
medio, el sistema está en PostgreSQL y los comercios en SQLite, y eso no se publica.

## Preguntas abiertas

1. **Datos de `mini.contax.ar`**: hoy hay cuentas, comercios y el registro de demos y del embudo.
   Propuesta: producción arranca vacía en PostgreSQL (se vuelve a correr `create-root`) y el último
   backup de SQLite queda guardado en el volumen. La alternativa es un script de importación de una
   sola vez, que sería una fase más.
2. **Dinero en `double precision` y fechas en `text`**: propuesta conservadora, para que la
   migración no cambie comportamiento. Pasar a `numeric` y `timestamptz` ahora es más barato que
   después (no hay datos), pero agranda las fases 3 y 4.
3. **Express 5** o un envoltorio `asyncHandler` sobre Express 4.
4. **Atomicidad nueva**: con una sola base, el push (lote, cargo y embudo) y el alta podrían ser una
   transacción. Propuesta: no cambiarlo en esta migración; issue aparte.
