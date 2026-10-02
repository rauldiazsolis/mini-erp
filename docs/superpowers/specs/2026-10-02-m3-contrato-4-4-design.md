# M3 · Contrato 4.4.0: notices, anulación de cobranzas y reglas de evolución (#2)

Fecha: 2026-10-02. Issue: rauldiazsolis/mini-erp#2 (epic #17, hito 1). Versión: 0.5.0.

## Contexto

El mini-erp implementa hoy el contrato **4.2.0** más la capacidad `demo-sessions` de 4.4.0 (#9). El
POS habla 4.4.0 y acepta backends desde el piso 4.0.0. Del issue #2 ya están hechos `demo-sessions`, la
página de alta y la vuelta con `#connect` (#9). Para M3 quedan tres cosas:

- **`customer-payment-void`** (4.3.0): la anulación de una cobranza.
  - Es otra cobranza: mismos medios en negativo, `total` negativo, mismo cliente y `voidsPaymentId`
    apuntando a la original.
  - Sin la capacidad declarada, el POS no anula cobranzas contra el mini-erp.
- **`notices`** en el pull (4.4.0): la lista vigente y completa de avisos para la terminal.
- **Reglas de evolución** (4.4.0) del lado del backend.

Cuando se revisó el código aparecieron dos problemas:

1. **Una venta a cuenta o una cobranza de un cliente desconocido se pierde en silencio.**
   `adjustCustomerBalance` no hace nada si el cliente no existe, y el lote queda `ok`.
2. **El extracto de cuenta corriente colorea por tipo y no por signo.** Todo movimiento `payment` se
   ve como crédito, así que una anulación, que sube la deuda, se vería en verde.
3. **El push no es transaccional**, aunque el comentario diga "atómicamente":
   - un evento que tira un error a mitad de camino deja efectos parciales, el lote queda en
     `processing` y el request da 500;
   - el reintento del POS reprocesa el lote entero (`processing` no corta la idempotencia), y por
     ejemplo suma dos veces una venta a cuenta.

## Decisiones

- **Las discrepancias son datos del comercio y los avisos se calculan** (enfoque A):
  - una tabla `discrepancies` en la base del comercio;
  - un `NoticeService` que arma los `notices` del pull en el momento, a partir de las discrepancias
    abiertas de ese equipo;
  - un aviso desaparece cuando su discrepancia se resuelve;
  - en M5, créditos y caja suman sus productores al mismo servicio.
- **Un movimiento de un cliente desconocido queda pendiente y se aplica solo** cuando el cliente
  aparece, por cualquiera de los tres caminos que crean clientes. En el admin se puede descartar con un
  motivo.
- **El aviso de una discrepancia va solo al equipo que la generó** (`deviceId` del lote). En el admin
  se ven todas las del comercio.
- **Una anulación de cobranza nunca se rechaza ni se frena.** El saldo se mueve por `-total`, como dice
  el contrato. Si es inconsistente, queda una discrepancia para que alguien la mire.
- **Las discrepancias no son `issues` del lote.** El lote sigue `ok`: no es un error del lote, es algo
  para revisar.
- `/info` pasa a decir **4.4.0**, con `customer-payment-void` (y `demo-sessions` si las demos están
  prendidas).

## 1. Datos y migraciones

Dos migraciones nuevas de comercio, con la mecánica de #47 (un archivo por migración en
`src/server/db/migrations/tenant/`, test desde la versión anterior con datos).

### Comercio v3 `anulacion-cobranzas`

```sql
ALTER TABLE customer_payments ADD COLUMN voids_payment_id TEXT;
UPDATE customer_payments SET voids_payment_id = json_extract(payload, '$.voidsPaymentId')
  WHERE json_extract(payload, '$.voidsPaymentId') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_payments_voids ON customer_payments (voids_payment_id);
```

El relleno cubre una anulación que haya entrado antes. No debería haber ninguna, porque el mini-erp
nunca declaró la capacidad, pero el `payload` ya guardaba el campo.

### Comercio v4 `discrepancias`

```sql
CREATE TABLE IF NOT EXISTS discrepancies (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,          -- 'unknown-customer', 'void-unknown-payment', 'void-customer-mismatch', 'void-duplicate'
  device_id TEXT,              -- el equipo que mandó el evento: a quién va el aviso
  origin_branch TEXT,
  origin_pos TEXT,
  customer_id TEXT NOT NULL,   -- el id que mandó el POS (puede no existir)
  ref_type TEXT NOT NULL,      -- 'sale', 'customer-payment'
  ref_id TEXT NOT NULL,
  amount REAL NOT NULL,        -- el monto del movimiento (positivo sube la deuda)
  pending TEXT,                -- JSON del movimiento a aplicar (solo unknown-customer), o NULL
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT,             -- 'applied', 'dismissed'
  resolved_by TEXT,            -- id de usuario, o 'system'
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_discrepancies_open ON discrepancies (resolved_at, device_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_customer ON discrepancies (customer_id, resolved_at);
```

### Tipos

| `kind` | Cuándo | Movimiento | Se resuelve |
|---|---|---|---|
| `unknown-customer` | Venta a cuenta sin hold, confirmación de hold o cobranza (o su anulación) de un cliente que no existe | Queda **pendiente** en `pending` | Sola (`applied`, `system`) cuando el cliente aparece; o `dismissed` a mano, sin aplicarse |
| `void-unknown-payment` | Anulación cuya cobranza original no existe | Se aplica igual | Sola (`applied`, `system`) si después llega la original; o `dismissed` |
| `void-customer-mismatch` | La original es de otro cliente | Se aplica igual | `dismissed` |
| `void-duplicate` | La original ya tenía otra anulación | Se aplica igual | `dismissed` |

`pending` guarda lo que hoy recibe `adjustCustomerBalance`: `{ type, delta, description, saleId? }`.

## 2. Connector API

### Push (`connector-service.ts`)

- **`adjustCustomerBalance`** devuelve si aplicó el movimiento. Con un cliente que no existe, el
  llamador crea una discrepancia `unknown-customer`. Vale para la venta a cuenta sin hold, la
  confirmación de hold y la cobranza.
- **`customer-payment` con `voidsPaymentId`**:
  1. inserta como siempre, guardando también `voids_payment_id` (idempotente por `id`);
  2. mueve el saldo por `-total` con el tipo de movimiento **`payment-void`** y la descripción
     `Anulación de cobranza <voidsPaymentId>`;
  3. busca la original (`customer_payments.id = voidsPaymentId`):
     - si no está, crea `void-unknown-payment`;
     - si es de otro cliente, crea `void-customer-mismatch`;
     - si ya hay **otra** anulación con el mismo `voids_payment_id`, crea `void-duplicate`.
- **Una cobranza nueva sin `voidsPaymentId`** resuelve (`applied`, `system`) las `void-unknown-payment`
  abiertas que apuntaban a su `id`.
- **Transacciones** (arregla el problema 3 del contexto):
  - `processPushLot` aplica el lote entero dentro de una transacción (`BEGIN` … `COMMIT`), incluido
    el registro en `push_lots` con su estado final;
  - cada evento corre en un `SAVEPOINT`. Si un evento tira un error, se hace `ROLLBACK TO` de ese
    evento y queda como `LotIssue` con su `eventId` ("No se pudo aplicar: <motivo>"), y el resto del
    lote se aplica;
  - una discrepancia y su movimiento entran o no entran juntos;
  - un lote nunca queda en `processing` con efectos a medias.

### Pendientes (`src/server/discrepancy/discrepancy-service.ts`)

`DiscrepancyService` es un servicio por tenant, del contenedor del request (`tenantDbDef`):

- `recordUnknownCustomer(...)`, `recordVoidIssue(...)`: crean discrepancias. `id` = `disc_<uuid>`.
- `applyPendingFor(customerId, now)`: aplica en orden de `created_at` cada `unknown-customer` abierta
  de ese cliente, con la misma lógica de saldo y extracto que el push, y la marca `applied` por
  `system`.
- `resolveVoidUnknown(paymentId, now)`.
- `listOpen()`, `dismiss(id, userId, note, now)`.

`applyPendingFor` se llama después de crear un cliente en los tres caminos:

- el evento `customer` del push;
- `CustomerService.create`;
- la importación de clientes (`import-export-service.ts`).

La lógica de "sumar al saldo y escribir el movimiento" sale de `ConnectorService.adjustCustomerBalance`
a una función compartida (`src/server/customer/account-ledger.ts`) que usan los dos servicios, sin
duplicarla.

### Pull

- `notices: NoticeService.forDevice(deviceId)`. Va siempre, vacío si no hay nada o si el pull no trae
  `deviceId`.
- `NoticeService` (`src/server/notices/notice-service.ts`) junta productores. En M3 hay uno, las
  discrepancias abiertas de ese `device_id`, con este formato:

  | Campo | Valor |
  |---|---|
  | `id` | `discrepancy:<id>` |
  | `severity` | `warning` |
  | `ref` | `{ type: ref_type, id: ref_id }` |
  | `message` | Para la persona de la caja, con el monto en pesos (ver abajo) |

- Mensajes:

  | `kind` | Mensaje |
  |---|---|
  | `unknown-customer` (venta) | "La venta a cuenta de $950 es de un cliente que mini contax todavía no tiene: se suma a su saldo cuando llegue el cliente." |
  | `unknown-customer` (cobranza) | "La cobranza de $500 es de un cliente que mini contax todavía no tiene: se descuenta de su saldo cuando llegue el cliente." |
  | `void-unknown-payment` | "Se anuló una cobranza que mini contax no tiene registrada ($500): revisalo en mini contax." |
  | `void-customer-mismatch` | "Se anuló una cobranza de otro cliente ($500): revisalo en mini contax." |
  | `void-duplicate` | "Esa cobranza ya estaba anulada y se volvió a anular ($500): revisalo en mini contax." |

### `/info`

`backendInfo` (`src/server/connector/backend-info.ts`):

- `CONTRACT_VERSION = '4.4.0'`;
- `capabilities`: `['customer-payment-void']`, más `'demo-sessions'` si las demos están prendidas;
- vale para el app real, el de mantenimiento y el `409 incompatible-contract`.

### Reglas de evolución

Se fijan con tests de `test/connector-api.test.ts` (o uno nuevo, `contract-evolution.test.ts`). Si
alguno falla, se arregla:

- un tipo de evento desconocido queda como `issue` con su `eventId` y el resto del lote se aplica;
- un `Payment.method` desconocido, en una venta y en una cobranza, se guarda sin romper. Agrupar por
  medio llega en M4, que lo tiene que tratar como "otro";
- campos desconocidos en el lote, en el evento y en la venta se ignoran sin error;
- tickets y recibos con huecos o repetidos entre días se aceptan;
- la foto completa no se recorta: un pull sin cursor con más de 1000 productos los devuelve todos.

## 3. Admin

### Extracto de cuenta corriente (`AccountStatementDrawer.tsx`)

- El color sale **del signo**: `amount > 0` sube la deuda (rojo), `amount < 0` la baja (verde).
- `payment-void` lleva la etiqueta "Anulación de cobranza".

### Discrepancias, en Clientes y Cuentas Corrientes

- **Franja**: si hay discrepancias abiertas, va arriba de la grilla: "N movimientos para revisar". Sin
  abiertas, no aparece.
- **Panel lateral** (`Drawer`), con una fila por discrepancia:
  - el mismo mensaje que ve la caja;
  - caja y sucursal;
  - fecha;
  - el id de cliente;
  - monto;
  - venta o cobranza.
- **Descartar**, con un motivo obligatorio: queda `dismissed` con quién y por qué, y el aviso
  desaparece de la caja. Una `unknown-customer` descartada no aplica su movimiento. El botón aparece
  solo con `canDo('settings.manage')`.
- Estado en `src/client/state/discrepancy-state.ts`, con signals, y componentes en
  `components/customers/`.

### Rutas

| Ruta | Permiso |
|---|---|
| `GET /api/tenants/:tenantId/discrepancies` (abiertas) | `tenant.use` |
| `POST /api/tenants/:tenantId/discrepancies/:discrepancyId/dismiss` `{ note }` (`note` de 1 a 500 caracteres) | `settings.manage` |

- Las dos se suman a la tabla de `test/permissions-api.test.ts`.
- Descartar una que ya está resuelta da `409` (`DomainError`), y una que no existe, `404`.

## 4. Tests

TDD con Vitest:

- **Migraciones**:
  - v3: base v2 con cobranzas (una con `voidsPaymentId` en el `payload`) → columna rellenada, índice;
  - v4: base v3 con datos → tabla e índices, sin perder nada.
- **Push**:
  - un evento que tira un error a mitad de camino → se deshace solo ese evento, queda como `issue`
    con su `eventId`, el resto se aplica y el lote queda `issues`;
  - repetir ese lote no duplica nada;
  - venta a cuenta, confirmación de hold y cobranza de un cliente desconocido → saldo intacto,
    discrepancia abierta con `pending`, lote `ok`;
  - el cliente llega después (evento `customer`, alta en el admin, importación) → se aplica, el
    extracto tiene el movimiento y la discrepancia queda `applied`;
  - anulación de cobranza → saldo sube, movimiento `payment-void`, `voids_payment_id` guardado;
  - anulación de una cobranza desconocida, de otro cliente o ya anulada → discrepancia, saldo movido
    igual;
  - la original llega después de su anulación → `void-unknown-payment` resuelta;
  - repetir el lote no duplica nada.
- **Pull**: `notices` del equipo que generó la discrepancia (y no de otro), formato del aviso, vacío
  sin `deviceId`, el aviso desaparece al resolverse.
- **`/info`**: 4.4.0 y las capacidades, con y sin demos; el de mantenimiento igual.
- **Reglas de evolución**: lo de la parte 2.
- **Admin**: rutas, permisos, `dismiss` (motivo obligatorio, `409`, `404`).
- **Cliente**: el estado de las discrepancias y el color por signo del extracto.
- **e2e**: no cambia.

## 5. Docs y versión

- `AGENTS.md`:
  - "Contrato implementado" pasa a **4.4.0**, con `demo-sessions` y `customer-payment-void`;
  - discrepancias y avisos en Arquitectura.
- Issue #2:
  - "Closes #2" en el PR;
  - lo que quedaba abierto de su texto (demos y alta) ya está hecho en #9.
- La guía de integradores la publica offline-pos: no se toca.
- Versión **0.5.0** en el PR. El tag va después del merge, con `pnpm release:tag`.

## Criterios de aceptación

1. `GET /connector/info` responde `contractVersion: 4.4.0` con `customer-payment-void`.
2. Una cobranza anulada desde el POS sube el saldo del cliente y el extracto lo muestra como
   "Anulación de cobranza", en rojo.
3. Una venta a cuenta de un cliente que el mini-erp no tiene:
   - no se pierde: queda pendiente;
   - se ve como aviso en la caja que la hizo y en el admin;
   - se aplica sola cuando el cliente llega.
4. Owner o admin pueden descartar una discrepancia con un motivo, y el aviso desaparece de la caja.
5. La producción migra a comercio v4 sin perder datos.
