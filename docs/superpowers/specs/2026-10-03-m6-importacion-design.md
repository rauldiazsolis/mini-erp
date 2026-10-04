# M6 · Importación con mapeo de columnas y carga inicial en el alta (#22)

Fecha: 2026-10-03. Issue: rauldiazsolis/mini-erp#22 (epic #17, hito 1). Versión: 0.8.0.

## Contexto

El MVP (`2026-10-01-mvp-mini-contax-design.md`, sección "Alta y carga inicial") pide importar CSV de
cualquier origen con mapeo de columnas, sugerencias y vista previa; clientes con su saldo como
movimiento "Saldo inicial (importado)"; productos y stock en un archivo; y un paso "Cargá tus datos"
en el alta.

Criterio de aceptación de #22: un CSV exportado de Excel (con `;`, coma decimal y nombres de columnas
propios) se importa mapeando columnas; los saldos aparecen en el extracto como saldo inicial;
reimportar actualiza sin duplicar.

Así está hoy:

- **`ImportExportService`** (Fase 2.5) importa productos y clientes con columnas fijas en inglés, un
  parser propio que solo entiende `,` y un `dryRun` sin detalle por fila. Se usa en Operaciones
  masivas.
- **Clientes**: se reconocen solo por documento (uno sin documento se duplica en cada importación) y
  el saldo se escribe directo en `customers.balance`, sin pasar por el libro
  (`customer/account-ledger.ts`).
- **Productos**: se reconocen por SKU, el stock no se importa (se crea en 0 en todas las sucursales)
  y nada pasa por el kardex.
- **Discrepancias** (M3): un cliente nuevo de la importación llama a `applyPendingFor`, que aplica
  los movimientos pendientes del POS **por id de cliente**.
- **`billing/payment-sheet.ts`** (M5) ya detecta `;` o `,`, el BOM, la coma decimal y las fechas
  `DD/MM/AAAA`.
- **El alta** (`alta/alta-service.ts`, `MerchantOnboardingView`) pide cuenta (nombre, mail y
  contraseña) y comercio (nombre y plantilla: kiosco, almacén, ferretería o vacío), y aplica el preset
  al crear el comercio. No guarda WhatsApp ni rubro.

## Decisiones

1. **El servidor parsea, sugiere y valida, sin estado.** El cliente lee el archivo y manda el texto;
   cada vista previa y la confirmación reenvían el CSV con el mapeo. Una sola fuente de las reglas,
   probada con Vitest. Nada de borradores guardados ni filas normalizadas en el cliente.
2. **Encabezados obligatorios, orden libre.** La primera fila nombra las columnas; cada columna se
   asigna a un campo o a "No importar". Las que sobran se ignoran. No se soportan archivos sin
   encabezado.
3. **Parser común** en `src/server/io/csv.ts`, extraído de `payment-sheet.ts`, que pasa a usarlo.
4. **Codificación**: Excel en Windows en español guarda el CSV en Windows-1252. El cliente lee los
   bytes, intenta UTF-8 estricto (`TextDecoder('utf-8', { fatal: true })`) y, si falla, decodifica
   como `windows-1252`.
5. **Filas con error se omiten**; las válidas se aplican **en una transacción**. Un error inesperado
   deshace todo. Una clave repetida dentro del archivo da error en la segunda aparición.
6. **Clientes, reconocimiento**: por id (si se mapeó), después por documento y, si la fila no trae
   ninguno de los dos, por nombre normalizado (minúsculas, sin tildes ni espacios de más). Un nombre
   que coincide con varios clientes da error en la fila.
7. **Discrepancias**: los pendientes de un cliente desconocido se aplican cuando un cliente se crea
   con ese id (columna id del archivo, como el export de mini) o, como hoy, cuando llega por el POS o
   el alta del admin. No se inventa otro emparejamiento.
8. **Saldo inicial** (opción A):
   - Cliente nuevo con saldo ≠ 0: movimiento de tipo **`opening`**, "Saldo inicial (importado)", por
     `applyToBalance`; después `applyPendingFor`.
   - Reimportación, si **todos** sus movimientos son `opening`: la diferencia se corrige con otro
     `opening`, "Saldo inicial (corrección)". Si la diferencia es 0, nada.
   - Reimportación con movimientos de otro tipo (POS, admin, intereses): el saldo del archivo se
     ignora y la fila avisa "Tiene movimientos posteriores: el saldo no se cambia". El resto de los
     campos se actualiza.
   - Saldo positivo = el cliente debe. La fecha del movimiento es la de la importación (fechar hacia
     atrás rompería el orden de `balance_after`).
   - `opening` es un valor nuevo de `account_movements.type` (TEXT sin CHECK): no necesita migración.
     El libro no viaja al POS, así que no toca el contrato.
9. **Productos, reconocimiento**: por código de barras (contra cualquiera de los del producto) o por
   SKU y, si la fila no trae ninguno de los dos, por nombre normalizado, como los clientes (así
   reimportar una lista sin códigos no duplica). Si código y SKU apuntan a productos distintos, o el
   nombre coincide con varios, error. Al actualizar se tocan **solo los campos mapeados** con celda no
   vacía.
10. **SKU**: obligatorio en la base. Si el archivo no lo trae, se usa el primer código de barras y, si
    tampoco hay, un correlativo `IMP-000123` (el siguiente libre).
11. **Stock por sucursal**: cada sucursal es un campo "Stock · <sucursal>". La cantidad **se fija**
    (recuento): el kardex registra la diferencia con motivo `inventory_count` y nota "Importación",
    y no hay movimiento si la diferencia es 0. Solo se tocan las sucursales con columna mapeada y
    celda no vacía. Reimportar el mismo archivo no cambia nada.
12. **Columna de stock genérica** ("Stock", "Cantidad", "Existencia"): con una sola sucursal se asigna
    a esa; con varias queda "Stock · ¿qué sucursal?" y no se puede confirmar hasta elegirla.
13. **Alta sin datos fiscales**: no se pide CUIT ni nada fiscal hasta que el POS emita facturas (la
    spec del MVP queda como está: el CUIT llega con la facturación). Sí se pide el **WhatsApp** del responsable.
14. **El alta crea el comercio vacío**; el catálogo de ejemplo se elige después, en "Cargá tus datos".

## Servidor

### Parser (`src/server/io/csv.ts`)

- `parseCsv(text)`: quita el BOM; detecta el separador por la primera línea (`;`, `,` o tabulación, el
  que más aparezca fuera de comillas); respeta comillas dobles (`""` escapa), campos con saltos de
  línea y `\r\n`; saltea filas vacías. Devuelve `{ separator, headers, rows: { line, cells }[] }`
  (`line` = número de línea del archivo, para los mensajes).
- `parseAmount(raw)`: `$ 12.345,50`, `1.234.567`, `12345.50`, `-1.500`, con o sin `$` y espacios;
  redondea a centavos. `undefined` si no es un número. En un archivo con `;` (el Excel argentino) el
  punto es siempre de miles: `1.200` es 1200, no 1,2. Con `,` o tabulación, un solo punto es decimal.
- `parseDay(raw)`: `DD/MM/AAAA` o `AAAA-MM-DD`, y que la fecha exista.
- `parseBool(raw)`: sí, si, s, x, 1, true, verdadero / no, n, 0, false, falso (sin distinguir
  mayúsculas ni tildes). `undefined` si no es ninguno.
- `normalizeHeader(raw)`: minúsculas, sin tildes, sin puntuación, espacios simples.

### Campos (`src/shared/import-fields.ts`)

TS puro, lo usan servidor y cliente (etiquetas y obligatorios).

- **Clientes**: `id`, `name` (Nombre, obligatorio para crear), `document` (Documento), `phone`
  (Teléfono), `creditLimit` (Límite de crédito), `margin` (Margen), `balance` (Saldo),
  `unrestricted` (Sin restricción), `blockedReason` (Motivo de bloqueo).
- **Productos**: `sku` (SKU), `barcodes` (Código de barras; varios separados por `|`, `;` o `,` dentro
  de la celda), `name` (Nombre, obligatorio para crear), `price` (Precio, obligatorio para crear),
  `taxRate` (IVA: `21`, `21%` o `0,21` → 0.21), `category` (Categoría), `tracksStock` (Controla
  stock), y `stock:<branchId>` (Stock · <sucursal>) por sucursal.
- **Sugerencias** (`suggestMapping(entity, headers, branches)`): el encabezado normalizado se compara
  contra sinónimos por campo, primero exacto y después por inclusión. Ejemplos: nombre ← nombre,
  descripción, producto, artículo, razón social, cliente; precio ← precio, precio venta, p venta, pvp;
  código de barras ← código de barras, cod barras, ean, barras; SKU ← sku, código, cod, código
  interno; documento ← dni, cuit, cuil, documento, nro doc; teléfono ← teléfono, tel, celular,
  whatsapp; saldo ← saldo, deuda, debe, saldo cc, cuenta corriente; stock de una sucursal ← un
  encabezado que contiene el nombre o el código de la sucursal. Nunca el mismo campo en dos columnas:
  gana la coincidencia más exacta y, a igual calidad, la primera columna.

### Servicio

`ImportService` (de comercio, por `req.tenantScope`), en `src/server/io/`, con un módulo por entidad
(`import-customers.ts`, `import-products.ts`) y la parte común (mapeo, resultado). El export queda en
`ImportExportService`, sin cambios; su importación vieja se borra.

Entrada: `{ csv, mapping?, dryRun }`. `mapping` es `Record<número de columna, campo | null>`; si no
viene, se usa la sugerencia.

Resultado:

```ts
type ImportPreview = {
  separator: ';' | ',' | '\t';
  columns: { index: number; header: string; samples: string[] }[]; // hasta 3 ejemplos
  mapping: Record<number, ImportField | null>;
  branches: { id: string; name: string }[]; // para las etiquetas de "Stock · <sucursal>"
  missing: ImportField[];        // ['name'] si ninguna columna identifica las filas (ver abajo)
  needsBranch: number[];         // columnas de stock genérico sin sucursal
  rows: { line: number; key: string; action: 'create' | 'update' | 'unchanged' | 'error'; messages: string[] }[];
  totals: { create: number; update: number; unchanged: number; error: number };
  dryRun: boolean;
};
```

`messages` lleva errores (con `action: 'error'`) o avisos (con cualquier otra acción, como el del
saldo). `missing` no exige nombre y precio como columnas: un archivo de "código de barras + stock"
solo actualiza, y es válido. Exige una columna que identifique las filas (clientes: id, documento o
nombre; productos: SKU, código de barras o nombre) y, si no hay ninguna, vale `['name']`. Crear una
fila sin nombre (o un producto sin precio) es un error de esa fila. Con `missing` o `needsBranch` no
vacíos, `dryRun: false` responde `400`.

### Stock

La lógica de `StockService.adjustStock` (movimiento en `stock_movements`, upsert en `stock`,
`products.updated_at` para el pull) se extrae a una función que recibe la base y la usan los dos.

### Rutas

- `POST /api/tenants/:tenantId/import/:entity` (`customers` | `products`), `requirePermission('bulk')`.
  Cuerpo validado con Zod. Reemplaza al de hoy (`items`, `updateExisting` y las columnas en inglés
  desaparecen).
- `POST /api/tenants/:tenantId/catalog/example`, `requirePermission('bulk')`: aplica el preset del
  rubro del comercio (`tenants.business_type`). Idempotente (no duplica SKU). `409` si el rubro es
  `otro` o no tiene.
- Las dos van en la tabla de `test/permissions-api.test.ts`.

## Alta

### Migración de sistema v6 (`v6-alta-whatsapp-rubro`)

`ALTER TABLE users ADD COLUMN whatsapp TEXT` y `ALTER TABLE tenants ADD COLUMN business_type TEXT`
(`kiosco`, `almacen`, `ferreteria`, `otro`). Nulas: los existentes no las tienen. Su test parte de una
base v5 con datos. El seed de desarrollo completa el rubro de sus tres comercios.

### `POST /api/alta`

- Cuerpo: `businessName`, `businessType` (en lugar de `template`) y, sin sesión, `name`, `email`,
  `password` y `whatsapp`.
- WhatsApp: se quitan espacios, guiones, paréntesis y `+`; tienen que quedar entre 8 y 15 dígitos; se
  guardan solo los dígitos. Obligatorio para una cuenta nueva; con sesión no se pide. A los invitados
  tampoco. Por ahora solo se guarda (lo muestra el panel del embudo, M8).
- Crea el comercio **vacío** con su rubro, la caja, el bono y la auditoría, como hoy. Ya no aplica el
  preset.

### Cliente

- **Paso 1 · Tu cuenta**: nombre, mail, contraseña y WhatsApp.
- **Paso 2 · Tu comercio**: nombre y rubro (Kiosco, Almacén, Ferretería, Otro), preseleccionado por el
  `template` de la URL. "Crear mi comercio" llama al alta.
- **Paso 3 · Cargá tus datos**: "Subir mis archivos" (abre el `ImportWizard` ahí mismo; al terminar un
  archivo se puede importar otro o seguir), "Empezar con el catálogo de ejemplo de <rubro>" (no
  aparece con "Otro"), "Relevar escaneando · próximamente" (deshabilitada, M11) y "Lo hago después".
  No se vuelve al paso 2: el comercio ya existe.
- **Paso 4 · Listo**: el de hoy (key de la caja, volver al POS con `#connect` o entrar al admin).
- "Crear nuevo comercio…" del admin (`OnboardingModal`, con sesión) manda `businessType` y también
  crea el comercio vacío. Su paso final dice dónde cargar los datos (Operaciones masivas: archivos o
  catálogo de ejemplo).
- Si se cierra la pestaña en el paso 3, el comercio queda vacío. En Operaciones masivas, un botón
  "Cargar el catálogo de ejemplo de <rubro>" aparece mientras el comercio tenga rubro con ejemplo y
  cero productos.

## Asistente de importación (cliente)

`ImportWizard` en `src/client/components/import/`, con su store `state/import-state.ts` (solo
signals). Se usa en **Operaciones masivas → Importar** (reemplaza la tarjeta de importación; la de
exportar queda) y en el paso 3 del alta.

1. **Qué y de dónde**: "Productos y stock" o "Clientes y saldos", y el archivo (elegir o arrastrar).
   Ayuda: "Exportalo desde Excel como CSV. La primera fila tiene que tener los nombres de las
   columnas, en cualquier orden. Saldo positivo: el cliente te debe." Se lee con la decodificación de
   la decisión 4 y se pide la vista previa sin mapeo.
2. **Mapeo**: una fila por columna (encabezado, hasta tres ejemplos y un desplegable de campo con la
   sugerencia o "No importar"). Arriba, lo que falta ("Falta asignar: Nombre") y las columnas de stock
   sin sucursal. Cada cambio pide otra vista previa (con un retardo corto).
3. **Vista previa**: totales (se crean, se actualizan, sin cambios, con error) y la tabla (línea,
   clave, acción y mensajes), con el filtro "Solo errores y avisos". Botón "Importar N" (y "se omiten M
   con errores" si hay).
4. **Resultado**: lo aplicado, con "Importar otro archivo" y, en clientes, "Ver clientes".

Números con `src/client/format.ts`. El movimiento `opening` tiene su etiqueta y estilo en
`state/movement-style.ts` ("Saldo inicial").

## Casos de borde

- Archivo vacío o solo con encabezado: vista previa sin filas; "Importar" deshabilitado.
- Filas con menos celdas que encabezados: las que faltan cuentan como vacías.
- Números inválidos ("abc" en precio), precio negativo, IVA fuera de 0–100 %: error en la fila.
- Booleano inválido: error en la fila.
- Documento con puntos o guiones (`20.123.456`, `20-12345678-9`): se compara sin puntos, guiones ni
  espacios (`20.123.456` reconoce al cliente guardado como `20123456`) y se guarda tal cual viene.
- Un código de barras que ya tiene otro producto: el producto se reconoce por ese código; si la fila
  trae además un SKU de otro producto, error.
- Reimportar el export de mini: las columnas en inglés se sugieren también (`name`, `price`, `sku`,
  `barcodes`, `document`, `balance`…), y la columna `id` engancha los pendientes.
- Un comercio restringido por deuda (M5): la importación sigue bajo la restricción de hoy (`402`),
  igual que el resto del admin.

## Etapas

Cada una con tests primero y `pnpm lint && pnpm typecheck && pnpm test` en verde.

1. **Parser común**. *Criterio*: tests del parser; `payment-sheet.test.ts` sin cambios y en verde.
2. **Campos y sugerencias**. *Criterio*: los encabezados de un CSV de Excel (Descripción, P. Venta,
   Cód. Barras, Stock Central, Deuda, DNI) se mapean bien, sin campos repetidos, y el stock genérico
   se resuelve según la cantidad de sucursales.
3. **Importación de clientes** (servicio). *Criterio*: importar dos veces el mismo archivo no duplica
   clientes ni movimientos; el extracto muestra "Saldo inicial (importado)"; la corrección y el aviso
   de la decisión 8; los pendientes de discrepancias se aplican con la columna id.
4. **Importación de productos y stock** (servicio). *Criterio*: reimportar da "sin cambios" y no
   genera movimientos de kardex.
5. **Endpoint**. *Criterio*: tests de API (owner y admin sí, member `403`), la tabla de permisos y el
   criterio de aceptación de #22 con un CSV de Excel en un test.
6. **Asistente en Operaciones masivas**. *Criterio*: tests del store (decodificación, mapeo, vista
   previa) y `pnpm build`.
7. **Alta en el servidor**: migración v6, `POST /api/alta` con `businessType` y WhatsApp, ruta del
   catálogo de ejemplo y seed con rubro. *Criterio*: test de la migración con datos y tests de alta y
   permisos.
8. **Alta en el cliente**: pasos 1 a 4 y el botón del catálogo de ejemplo en Operaciones masivas.
   *Criterio*: tests del store, `pnpm build` y `pnpm test:e2e`.
9. **Cierre**: AGENTS.md (importación, alta, `opening`), versión 0.8.0 y
   borrar el plan. *Criterio*: la prueba manual en el informe final.

## Fuera de alcance

- `.xlsx` y otros formatos (spec del MVP, fuera del MVP).
- Relevamiento y base global (M11).
- Importar ventas, historial de cuenta corriente o sucursales.
- Datos fiscales del comercio.
