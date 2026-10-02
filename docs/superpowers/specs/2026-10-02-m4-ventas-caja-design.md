# M4 · Ventas y caja: consultas, resumen por caja y día, y drill-down del dashboard (#20)

Fecha: 2026-10-02. Issue: rauldiazsolis/mini-erp#20 (epic #17, hito 1). Versión: 0.6.0.

## Contexto

El MVP (`2026-10-01-mvp-mini-contax-design.md`, sección "Ventas y caja") pide una sección nueva
"Ventas & Caja" en el admin con cuatro partes:

- listado de ventas con filtros y el detalle de cada ticket;
- cobranzas y movimientos de caja;
- resumen por caja y por día;
- drill-down desde el dashboard.

Criterio de aceptación de #20: con ventas, una anulación y una cobranza hechas desde el POS, el
owner encuentra cada una con los filtros y ve el ticket completo, y el resumen del día de cada caja
**cuadra con el `/RESUMEN` del POS**. Un click en el dashboard lleva a la lista filtrada.

Así está hoy:

- **Lo que se guarda.** `sales`, `cash_movements` y `customer_payments` tienen el payload completo
  del POS más `device_id`, `branch` y `point_of_sale` (del `origin` del evento) y `created_at` (el
  `createdAt` del evento). No hay columnas para el día, el cliente de la venta ni el número de ticket
  o recibo.
- **Cómo arma el día el `/RESUMEN` del POS** (`calculateDaySummary` y `getDaySummary` en offline-pos):
  - **Agrupación**: las ventas por `ticket.date` y las cobranzas por `receipt.date`; si no lo traen,
    por el día local de su `createdAt`. Los movimientos de caja, por el día local de `createdAt`.
  - **Totales de ventas**: el total vendido es el neto de todos los tickets del día (una anulación
    resta por su signo). Los tickets incluyen las anulaciones; las anuladas son las que tienen un
    ticket que las anula.
  - **Ajuste global**: `total − Σ unitPrice·qty` (las líneas sin descuento).
  - **Efectivo**: ventas en efectivo, ingresos y egresos manuales, ajustes por arqueo con signo y el
    efectivo de las cobranzas.
  - **Cobranzas**: van aparte (total, cantidad con anulaciones, anuladas y por medio). No suman a lo
    vendido.
- **El dashboard toma mal el día y las anulaciones.**
  - Arma el día con la hora local del servidor, y en Lightsail esa hora es UTC: entre las 21:00 y la
    medianoche de Argentina, "hoy" ya es mañana.
  - Descarta la venta anulada y también su anulación. Cuando la anulación cae otro día, el resultado
    no coincide con el POS.
- **Datos que no respetan el contrato.**
  - Las cobranzas cargadas desde el admin (`CustomerService.registerPayment`) guardan
    `{ id, customerId, total, method, reference }`, sin `payments[]` ni `createdAt`, con la caja
    `ADMIN · Oficina`.
  - La semilla de actividad de demo (`demo-activity-generator.ts`) guarda movimientos de caja con
    `type`/`note` y ventas sin `ticket`.
  - Los comercios reales de producción tienen solo datos del POS y cobranzas del admin; la semilla
    vieja está en demos y en desarrollo.

## Decisiones

1. **Caja = sucursal + punto de venta** tal como los estampa el POS en el `origin` de cada evento:
   el texto libre que el comerciante reconoce y el mismo de la key. Si dos equipos usan el mismo par,
   se suman (M5 lo evita ligando la key a un solo equipo). En los filtros, `branch` y `pointOfSale`
   son independientes: el dashboard filtra por la sucursal sola.
2. **El día es el día argentino.** Se toma `ticket.date` o `receipt.date` si vienen; si no,
   `createdAt` en UTC−3, fijo, porque Argentina no tiene horario de verano. Es lo que hace el POS y
   lo que fija M5 para los cargos. El dashboard pasa a usar el mismo día.
3. **Las anulaciones se cuentan como en el POS, en todos lados.**
   - **Vendido**: el neto de todos los tickets del período, anulaciones incluidas por su signo.
   - **Cantidad de tickets y ticket promedio del dashboard**: solo los **vigentes**, es decir ni
     anulaciones ni ventas anuladas. Las devoluciones sí cuentan.
4. **Tipos y estado de un ticket.**
   - **Tipo**: es **anulación** si tiene `voidsSaleId`; **devolución** si `total < 0` y no es
     anulación; **venta** en cualquier otro caso.
   - **Estado**: un ticket está **anulado** si hay otro que lo anula, de cualquier día.
   - **Cobranzas**: lo mismo, con `voidsPaymentId`.
5. **Columnas derivadas** (migración v5) para filtrar y agrupar con SQL. El payload sigue siendo la
   fuente: las columnas se calculan de él.
6. **Medios de pago desconocidos** (reglas de evolución 4.4.0): se muestran y suman como "Otro".
7. **Las cobranzas del admin** pasan a guardarse con la forma del contrato. La v5 normaliza las que ya
   existen. Su caja sigue siendo `ADMIN · Oficina` y en las pantallas se muestra como "Admin".
8. **La semilla de demo** pasa a la forma del contrato, con tickets numerados, una anulación, una
   cobranza y movimientos con `direction`, `concept` y `source`.
9. **Fechas, horas e importes** de lo nuevo se muestran según el navegador (#51), con un helper
   nuevo. El resto del admin se unifica en #51.
10. **Sin links profundos**: las vistas del admin siguen sin estar en la URL. El drill-down pone
    filtros y navega.

Del contrato y del POS no hace falta nada: todo sale de lo que ya manda 4.4.0. Los arqueos sin
diferencia no viajan y mini no los ve; el `/RESUMEN` tampoco los suma al efectivo.

## Datos

### `argentinaDay`

`src/server/sales/argentina-day.ts`:

- `argentinaDay(iso: string): string` devuelve `YYYY-MM-DD` del instante en UTC−3.
- `argentinaDayRange(day)` devuelve los límites ISO del día, que usa el dashboard.
- `argentinaToday(now)`.

La migración y las consultas usan el equivalente SQL `date(x, '-3 hours')`. Un test verifica que los
dos dan lo mismo, incluidos los bordes de medianoche.

### Migración de comercio v5 `ventas-y-caja`

`src/server/db/migrations/tenant/v5-ventas-y-caja.ts`:

- **`sales`** suma `day TEXT`, `customer_id TEXT`, `ticket_date TEXT` y `ticket_number INTEGER`. Se
  rellenan del payload:
  - `day` = `COALESCE(json_extract(payload, '$.ticket.date'), date(COALESCE(json_extract(payload, '$.createdAt'), created_at), '-3 hours'))`;
  - el resto, con `json_extract`.
- **`customer_payments`** suma `day TEXT`, `receipt_date TEXT` y `receipt_number INTEGER`, con la
  misma regla y `receipt`.
- **`cash_movements`** suma `day TEXT` = `date(COALESCE(json_extract(payload, '$.createdAt'), created_at), '-3 hours')`.
- **Normaliza las cobranzas del admin** (las que no tienen `$.payments`): reescribe el payload a
  `{ id, customerId, payments: [{ method, amount: total, reference? }], total, createdAt: created_at }`.
  El `reference` va solo si existía y no era nulo.
- **Índices**:
  - `sales (day, branch, point_of_sale)` y `sales (customer_id)`;
  - `customer_payments (day, branch, point_of_sale)`;
  - `cash_movements (day, branch, point_of_sale)`.
- **Test** (`test/tenant-migration-v5.test.ts`): parte de una base v4 **con datos**, creada con
  `createDbAtVersion`. Incluye ventas con y sin `ticket` y sin `createdAt` en el payload, una
  anulación, cobranzas del POS (con `receipt`) y del admin, y movimientos de caja. Verifica que los
  datos sobreviven y que las columnas y los payloads quedan como se espera.

### Escritura

- **El push** (`ConnectorService.applyEvent`) completa las columnas nuevas al guardar `sale`,
  `customer-payment` y `cash-movement`, con `argentinaDay` y la misma regla que la migración.
  En una venta, el `ON CONFLICT ... DO UPDATE` actualiza también las columnas derivadas.
- **`registerPayment`** escribe el payload con forma de contrato y completa `day`.
- **La semilla de demo** escribe con forma de contrato y completa las columnas.

## API

Todo bajo `/api/tenants/:tenantId`, con `requirePermission('tenant.use')`; cada ruta se suma a la
tabla de `test/permissions-api.test.ts`. Los parámetros se validan con Zod. Un parámetro inválido o
un rango de más de 366 días da `400` (`DomainError`). Las listas paginan con `page` (desde 1) y
`pageSize` (50 por defecto, máximo 200) y devuelven `{ items, count, page, pageSize }` más sus
totales.

Filtros comunes: `from` y `to` (días `YYYY-MM-DD`, inclusive, sobre la columna `day`), `branch` y
`pointOfSale`. Un `pointOfSale` vacío (`''`) filtra los eventos sin punto de venta.

| Ruta | Filtros propios | Devuelve |
|---|---|---|
| `GET /registers` | — | Las cajas que aparecen en ventas, cobranzas y movimientos (`{ branch, pointOfSale }` distintos, ordenados) |
| `GET /sales` | `method`, `customerId`, `productId`, `kind` (`sale` \| `return` \| `void`), `status` (`all` \| `valid` \| `voided`) | Ítems: `id`, `day`, `createdAt`, `ticket?`, `branch`, `pointOfSale`, `customer?` (`{ id, name? }`), `methods`, `total`, `kind`, `voided`, `voidedBy?`, `voidsSaleId?`. Totales: `count` y `netTotal` del filtro |
| `GET /sales/:saleId` | — | El ticket: lo de la lista más las líneas (`name` del catálogo o la descripción; "Producto eliminado"; `qty`, `unitPrice`, `discount?`, `total` con `lineTotal`), `subtotal` (Σ `lineTotal`), `globalAdjustment` (`total − subtotal`), `payments` y `voidReason?`. `404` si no existe |
| `GET /customer-payments` | `method`, `customerId`, `status` (`all` \| `valid` \| `voided`) | Ítems: `id`, `day`, `createdAt`, `receipt?`, caja, `customer`, `payments`, `total`, `voided`, `voidedBy?`, `voidsPaymentId?`. Totales: `count` y `netTotal` |
| `GET /cash-movements` | `direction` (`in` \| `out`), `source` (`manual` \| `count-adjustment`) | Ítems: `id`, `day`, `createdAt`, caja, `direction`, `amount`, `concept`, `description?`, `source`, `count?` |
| `GET /cash-summary` | — | Una fila por día y caja: `day`, caja, `totalSold`, `ticketCount`, `voidedCount`, `collectionsTotal`, `cashIncome`, `cashExpense`, `cashCountAdjustments`, `cashNet`. Más la fila `totals`. Orden: día descendente, caja ascendente |
| `GET /cash-summary/day` | `day` (obligatorio), `branch`, `pointOfSale` | `summary` (`DaySummary`, la forma del POS, con `other` en los medios) y `entries`: ventas, movimientos y cobranzas del día, lo más nuevo primero |

Notas:

- `customer.name` sale de `customers`; si el cliente no está (discrepancia de M3), va solo el `id` y
  la UI muestra "Cliente desconocido". Sin `customerId`, la UI muestra "Consumidor final".
- `methods` de una venta: los medios de sus pagos, sin repetir. Un medio desconocido viaja tal cual
  y la UI lo muestra como "Otro".
- El filtro `method` y el `productId` usan `json_each` sobre el payload. `method=other` filtra los
  medios que no están en la lista del contrato.
- `cashNet` = ventas en efectivo + ingresos − egresos + ajustes por arqueo + cobranzas en efectivo.
- Un payload que no valida no da `500`: el ítem sale con lo que tiene (sin líneas).
- **Portal (M10)**: el servicio recibe la caja como filtro, así "mi caja" llama a los mismos métodos
  con la caja fija de la sesión anónima.

### Código

- `src/server/sales/day-summary.ts`: puro, la copia fiel de `calculateDaySummary` (mismos campos,
  redondeos y reglas) más `other` en los totales por medio.
- `src/server/sales/sales-query-service.ts` (`SalesQueryService`): de comercio, por request con
  `req.tenantScope.use(...)`, registrado en `di/container.ts`.
- `src/server/routes/sales-routes.ts`: las rutas y sus esquemas Zod.
- `sale-lines.ts` (`lineTotal`, `parseSaleLines`) se reutiliza para el detalle y el ranking.

## Dashboard

`DashboardService`:

- **Períodos sobre la columna `day`.**
  - Hoy es `argentinaToday(now)`.
  - 7 días son hoy y los 6 anteriores; 30 días, igual.
  - El período anterior es el bloque de la misma cantidad de días justo antes. En "Hoy", el
    anterior es ayer completo, no ayer hasta esta hora.
  - El gráfico va por día argentino. En "Hoy" son tramos de 3 horas argentinas, calculados sobre
    `createdAt` en UTC−3.
- **Facturación**: el neto de todos los tickets del período.
- **Tickets** y **ticket promedio**: solo los vigentes. El promedio es Σ `total` de los vigentes
  dividido por su cantidad.
- **Ranking**: las líneas de todos los tickets del período; una anulación descuenta sus unidades.
  Solo se muestran los productos con unidades netas positivas (una anulación de un período anterior
  no deja un producto en negativo).
- El filtro de sucursal sigue comparando el nombre de la sucursal con `sales.branch`.

## Pantallas

### Ventas & Caja

- **Menú**: un ítem nuevo "Ventas & Caja" debajo de Dashboard, para los tres roles (`ActiveNavView`
  suma `'sales'`). Adentro, cuatro solapas como las de Configuración: **Ventas · Cobranzas ·
  Movimientos de caja · Resumen**.
- **Estado**: `state/sales-state.ts`, solo signals. Rango y caja son **compartidos** entre solapas:
  - el rango tiene atajos Hoy, Ayer, 7 días, 30 días y Personalizado;
  - "Hoy" es el día argentino;
  - la caja se elige de `GET /registers`.
- **Filtros propios** de cada solapa, con `FilterToolbar`:
  - Ventas: medio, cliente (selector con búsqueda), tipo y estado.
  - Cobranzas: medio, cliente y estado.
  - Movimientos: ingreso o egreso, y manual o arqueo.
- **Ventas**: tabla con Fecha y hora, Ticket (`#12`), Caja, Cliente, Medios, Total y marcas
  *Anulada*, *Anulación* y *Devolución*. Los importes negativos van coloreados con
  `movement-style.ts`.
  - Encabezado: "N tickets · Total neto $X".
  - Paginación: "Anterior / Siguiente · 1–50 de 312".
  - Un click abre el **Drawer "Ticket"** con:
    - encabezado: número, fecha y hora, caja, cliente y estado;
    - líneas: nombre, cantidad, precio, descuento y total;
    - subtotal, ajuste global y total;
    - pagos;
    - si es anulación, el motivo y un link al original; si está anulada, un link a su anulación. El
      drawer navega entre los dos.
- **Cobranzas**: tabla con Fecha, Recibo, Caja, Cliente, Medios, Total y marcas. Un click abre un
  drawer con el recibo, que linkea a la anulación o a la original.
- **Movimientos de caja**: tabla con Fecha, Caja, Ingreso o Egreso, Concepto, Descripción e Importe.
  El arqueo se ve como "Ajuste por arqueo (esperado X, contado Y)".
- **Resumen**: tabla con una fila por día y caja (Día, Caja, Vendido, Tickets, Anuladas, Cobranzas,
  Efectivo neto) y la fila de totales. Un click abre el **Drawer "Resumen del día"** con los bloques
  del `/RESUMEN`:
  - vendido, tickets y anuladas, ajuste global;
  - por medio de pago;
  - efectivo: ventas, ingresos, egresos, ajustes por arqueo, cobranzas y neto;
  - cobranzas por medio.

  Debajo, los movimientos del día. Un click en una venta abre su ticket.

  Los textos son los del `/RESUMEN` (Total vendido, Tickets emitidos, Desc/Recargos, Otros pagos,
  Cobros, Cobranzas…) y los medios de pago se llaman como en el POS ("Tarjeta de Débito", "Código
  QR"). "Neto del día" es de mini: el POS muestra el saldo de efectivo actual, que mini no puede
  calcular porque el arqueo sin diferencia no viaja.
- **Formato**: `src/client/format.ts` (`formatMoney`, `formatDate`, `formatDateTime`, `formatTime`)
  con `Intl` y el locale del navegador (`undefined`), moneda ARS. Respeta la preferencia de 12 o
  24 horas. Un `day` (`YYYY-MM-DD`) se muestra como fecha sin pasar por la zona horaria.
- **Celular**: las tablas scrollean dentro de su tarjeta, sin scroll horizontal de la página. Los
  drawers ocupan el ancho completo.

### Drill-down del dashboard

El click pone los filtros de `sales-state` (o de la vista destino) y navega. El período del dashboard
se traduce al rango de días equivalente.

| Elemento | Lleva a |
|---|---|
| Facturación total | Ventas, con el período y la sucursal, sin otros filtros |
| Tickets emitidos / Ticket promedio | Ventas, mismo período y sucursal, estado vigentes |
| Deuda en cuenta corriente | Clientes con el filtro de deudores (se agrega si no existe) |
| Barra o punto del gráfico | Ventas de ese día (en "Hoy", el día completo) |
| Producto del ranking | Ventas, mismo período y sucursal, filtradas por ese producto |
| Línea libre del ranking | Sin link |
| Alerta de stock (producto) | Stock, con ese producto buscado |
| "Ver todo" de alertas | Stock (como hoy) |

## Casos de borde

| Caso | Comportamiento |
|---|---|
| Evento sin `createdAt` ni `ticket` (POS viejo) | El día sale del `created_at` de la fila |
| Evento sin `origin` | Sucursal de la key (como hoy) y punto de venta nulo: "Sin punto de venta" |
| Ticket numerado antes de la medianoche que llega con `createdAt` del día siguiente | Manda `ticket.date` |
| Anulación en otro día que el original | El original queda *Anulada* y suma en su día; la anulación resta en el suyo. Igual con las cobranzas |
| Medio desconocido | "Otro"; nunca rompe el resumen |
| Cliente desconocido | "Cliente desconocido" con su id |
| Producto borrado | "Producto eliminado" |
| Payload que no valida | El ítem sale sin líneas; nunca da `500` |
| Cobranza del admin | Caja "Admin", sin número de recibo |
| Rango inválido o de más de 366 días | `400` |

## Pruebas

- **Vitest, con TDD**, en `test/`:
  - migración v5;
  - `argentinaDay` contra el SQL;
  - `day-summary` con los casos del POS;
  - servicio y endpoints con cada filtro, la paginación y los casos de borde;
  - dashboard con días argentinos, neteo y vigentes;
  - permisos;
  - push y `registerPayment` completando las columnas;
  - semilla con forma de contrato;
  - lógica pura del cliente: `format.ts` y la traducción del drill-down a filtros.
- **Prueba de cuadre**: sobre ventas, una devolución, una anulación de otro día, una cobranza y su
  anulación, ingresos, egresos y un ajuste por arqueo, el resumen de mini contra números escritos a
  mano con las reglas del `/RESUMEN`.
- **e2e** (`pnpm test:e2e`, porque M4 toca el push): push de una venta, su anulación y una cobranza
  por el Connector API; en el admin, verlas en Ventas, abrir el ticket y ver el Resumen del día.
- **Antes de cada commit**: `pnpm lint && pnpm typecheck && pnpm test`, más `pnpm build` cuando se
  toca el cliente.

## Etapas

1. `argentinaDay`, migración v5, push con columnas, `registerPayment` y semilla con forma de contrato.
2. `day-summary` portado del POS.
3. `SalesQueryService` y endpoints de ventas (lista y detalle) y `registers`.
4. Endpoints de cobranzas y movimientos de caja.
5. Endpoints del resumen (rango y día).
6. Dashboard: días argentinos, neteo y vigentes.
7. Cliente: `format.ts`, `sales-state`, menú y solapa Ventas con el drawer del ticket.
8. Cliente: Cobranzas y Movimientos de caja.
9. Cliente: Resumen y drawer del día.
10. Drill-down del dashboard.
11. e2e, documentación (AGENTS.md), versión 0.6.0 e informe con la prueba manual en checklist.

## Afuera de M4

- Links profundos con filtros en la URL.
- Exportar las consultas (va con M6 o backlog).
- Unificar el formato del resto del admin (#51).
- La caja como key con equipo ligado (M5) y la vista "mi caja" (M10).
