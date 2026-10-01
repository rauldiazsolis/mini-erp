# MVP de mini contax (mini.contax.ar + pos.contax.ar)

Sesión de definición del 2026-10-01 (#17). Sin código: este documento fija **qué es el MVP**, las
decisiones de fondo de cada bloque, qué queda afuera y el orden de las etapas. Cada etapa tiene
después su propio brainstorming de detalle (pantallas, esquema y endpoints) en una sesión aparte, en
un solo repo.

## Producto

**mini contax** (marca Contax) es un SaaS para comercios chicos, *powered by*
[offline-pos](https://github.com/rauldiazsolis/offline-pos): el POS publicado en `pos.contax.ar`
vende aunque se corte internet, y mini (`mini.contax.ar`, este repo) es su backend y su admin
(catálogo, stock, clientes y cuentas corrientes, ventas y caja). El producto son esas dos apps
interactuando. Recauda desde el primer día.

Estamos en una etapa temprana: **reiniciar producción a cero (borrar todo) sigue siendo aceptable**.
Por eso las etapas no migran datos de producción.

## Cuándo está terminado

Dos hitos; las etapas se ordenan para llegar primero al 1.

- **Hito 1: un comercio conocido**, acompañado, usa mini y el POS de verdad (carga su catálogo y
  clientes, invita a un empleado, vende con ticket impreso, ve sus ventas y su caja) y **paga**.
- **Hito 2: un comercio desconocido recorre el funnel completo sin ayuda**: llega a
  `mini.contax.ar`, prueba la demo, se da de alta, carga sus datos, vende, consume créditos y,
  cuando se le terminan, paga y root o soporte registra el pago. Root y soporte ven todo el
  recorrido y pueden entrar como cualquier usuario para ayudar.

## Identidad, roles y accesos

### Roles

Dos familias, cada una delegada por invitación:

- **Plataforma**: `root` y `soporte`. Root invita a soporte. Root y soporte **no son miembros** de
  los comercios: fuera de la impersonación no ven el admin de ningún comercio ("Tus comercios"
  lista solo las membresías reales; resuelve #16.1).
- **Comercio**: `owner`, `admin` y `member` (los tres que ya existen en `memberships`; hoy ninguno
  restringe nada). Quien crea el comercio en el alta es su owner. Un usuario puede estar en varios
  comercios con roles distintos.

| Acción en el comercio | owner | admin | member |
|---|:-:|:-:|:-:|
| Dashboard, ventas y caja, consultar catálogo, stock y clientes | ✓ | ✓ | ✓ |
| Editar productos y precios de a uno, ajustar stock con motivo | ✓ | ✓ | ✓ |
| Clientes y cobranzas | ✓ | ✓ | ✓ |
| Operaciones masivas (precios, intereses), importar y exportar | ✓ | ✓ | — |
| Sucursales, cajas y keys del POS | ✓ | ✓ | — |
| Invitar y desactivar usuarios | ✓ | admin y member | — |
| Créditos: ver saldo y consumo | ✓ | ✓ | — |
| Nombrar owners, reiniciar o borrar el comercio | ✓ | — | — |

Puede haber más de un owner; el último no se puede ir ni bajar de rol. Permisos fijos: nada
configurable en el MVP.

| Acción de plataforma | root | soporte |
|---|:-:|:-:|
| Ver todos los comercios, usuarios, demos y el funnel | ✓ | ✓ |
| Impersonar a cualquier owner, admin o member | ✓ | ✓ |
| Generar links de restablecimiento de contraseña | ✓ | ✓ |
| Otorgar créditos regalados (sin tope) | ✓ | ✓ |
| Registrar pagos y subir la planilla de cobranzas | ✓ | ✓ |
| Reiniciar demos (todas o un rubro) | ✓ | ✓ |
| Desactivar un usuario o suspender un comercio | ✓ | ✓ |
| Invitar y desactivar a soporte; configurar precio, reglas de créditos, número de WhatsApp de soporte y datos de cobro | ✓ | — |
| Borrar un comercio (y reiniciar producción) | ✓ | — |

Todo lo de plataforma y lo hecho impersonando queda en un **registro de auditoría** (quién, como
quién, qué, cuándo).

### Invitaciones y contraseñas: links, sin mail

El servidor no manda mails en el MVP. Las invitaciones y los restablecimientos de contraseña son
**links de un solo uso que vencen en 48 h**: los genera quien invita (root, soporte, owner o admin
según la matriz) o, para restablecer, soporte o el owner, y se comparten por donde se quiera
(WhatsApp). No hay registro suelto: una cuenta nace en el alta o por una invitación. Cada usuario
puede cambiar su propia contraseña.

### Accesos anónimos

No son un rol nuevo: son un **tipo de identidad** sin mail ni contraseña, atada a **un solo
comercio** y a algo que la origina, que lleva **un rol existente** con un alcance:

| Origen | Rol | Qué ve |
|---|---|---|
| La key de una caja del POS (portal, ver más abajo) | `member` limitado a su caja | el estado de su caja; consultar precios, stock y clientes |
| Una sesión de demo | `admin` del comercio demo | el admin completo del rubro, menos usuarios, créditos y reinicio |
| Un link de relevamiento | solo relevar | la pantalla de relevamiento |

Nunca crean comercios, ni invitan, ni ven usuarios o créditos. Vencen o se revocan con lo que los
originó (revocar la key corta al cajero; el reinicio de la demo corta a los visitantes). Lo que
hacen queda registrado con su origen.

### Impersonación de usuario

Reemplaza a la impersonación de comercio de hoy.

- Root o soporte entra **como un usuario**: ve sus comercios con su rol, ni más ni menos. Una franja
  fija dice "Estás viendo como Juan (owner de Kiosco X) · Salir". Mientras impersona no puede
  cambiar la contraseña ni el mail del usuario, ni nombrar owners.
- **Una pestaña por cliente**: cada impersonación es una sesión aparte en el servidor (ligada a la
  de soporte) que el admin guarda en el `sessionStorage` de esa pestaña; la sesión propia de soporte
  sigue en `localStorage`. El comercio activo también pasa a ser de la pestaña. Así soporte atiende
  a varios clientes a la vez sin que se pisen. Vence a las 2 h sin uso o con "Salir".
- **Pedido de ayuda**: el usuario toca "Pedir ayuda", escribe opcionalmente qué le pasa, y se abre
  WhatsApp al **número único de soporte** (configurado por root) con el mensaje y un link. El link
  lleva solo el id del pedido, no un token: abrirlo exige estar logueado como root o soporte, y
  entonces inicia la impersonación en ese comercio y esa pantalla, en una pestaña nueva. El pedido
  guarda quién, dónde y cuándo; vence a las 24 h. El usuario ve "Soporte (Ana) entró a las 10:32
  por tu pedido". Los pedidos son una lista simple en el panel de plataforma (abiertos y tomados),
  sin conversación.
- La impersonación libre (sin pedido) se mantiene, y también queda registrada.

## Demos

- **Un comercio fijo por rubro** (kiosco, almacén, ferretería), con una sola sucursal, sembrado
  desde `src/server/seeds/` con un historial simulado de días anteriores (fechas relativas).
  Reemplaza al tenant por visitante de #9.
- **Cada demo crea una caja** (key y acceso anónimo) en la sucursal. Los visitantes **comparten** el
  comercio: la demo se ve viva. Al entrar a mini desde el POS, el visitante cae primero en su caja.
  El stock se repone solo en las demos.
- **Reinicio total** (un rubro o todos): vuelve a la foto inicial y revoca las cajas de visitantes.
  Automático todas las noches a las 4:00 y manual desde la plataforma.
- **Reinicio parcial** (manual): restaura catálogo, precios, stock y clientes; conserva ventas y
  cajas. Sirve para deshacer un "vandalismo" sin cortarle la demo a nadie.
- Una caja de visitante sin uso por 24 h se revoca sola.
- El registro de las sesiones **nunca se borra con un reinicio**: vive fuera del comercio.

## Funnel

**Landing → Demo → Venta demo → Mini desde el POS → (Contacto) → Alta → Cuenta → Comercio → Carga →
Venta real → Pago**

- Cada paso es un evento con fecha, registrado por mini. Sin analíticas de terceros, sin IP
  completas.
- Un **id de visitante** viaja de punta a punta (la caja de la demo, el link de `/ALTA`, el
  `#connect` de vuelta). El comercio que nace de un alta queda ligado a su demo: root y soporte ven
  la historia completa.
- **Contacto** (opcional, en cualquier momento de la demo, en el POS o en mini): "¿Querés que te
  ayudemos a empezar?" deja nombre y WhatsApp. El visitante pasa a ser un contacto en el panel, con
  su historia.
- Panel de plataforma: embudo por etapa y por rubro, y la lista de demos, contactos y altas con su
  historia.

## Alta y carga inicial

- **El alta identifica**: nombre, mail, contraseña y WhatsApp del responsable; nombre, rubro y
  CUIT del comercio (CUIT validado por formato y dígito verificador, sin consultar a ARCA). Nada se
  verifica por mensaje: la verificación real llega con el primer pago.
- **Paso "Cargá tus datos"** con tres caminos: subir archivos, relevar escaneando, o empezar con el
  catálogo de ejemplo del rubro y corregirlo.
- **Importación con mapeo**: CSV de cualquier origen (detecta `;` y la coma decimal), mapeo de
  columnas con sugerencias, vista previa con errores por fila y confirmación. Clientes y saldos (el
  saldo entra como movimiento "Saldo inicial (importado)"); productos y stock en un archivo
  (actualiza por código de barras o SKU).
- **Relevamiento** (`/relevamiento`, dentro de mini, pensado para el celular): escanea con la cámara
  o un lector Bluetooth, pide precio y stock y, solo si el código no está en la base global, nombre
  (y opcionalmente marca y categoría). Funciona sin conexión: acumula y sube lotes a un endpoint de
  ingreso masivo, con revisión antes de confirmar. Lo usa owner o admin, o un empleado con un link
  de relevamiento.
- **Base global de productos**: propia de mini (código → nombre, marca, categoría; **nunca
  precio**). Root la alimenta con un importador de fuentes (bases que se consigan, listas de
  proveedores, Open Food Facts, con su licencia ODbL revisada en la etapa) y crece con lo que cargan
  los comercios.

## Créditos y cobro

- **Cargo**: $1000 por **caja** y por **día** con al menos una venta, generado por la primera venta
  del día de esa caja. Configurable por root. Un día sin ventas no se cobra.
- **Caja = punto de venta configurado en mini** (sucursal + punto de venta, con su key), **usado
  por un solo equipo a la vez**: la key queda ligada al primer `deviceId` que la usa; si aparece
  otro equipo, mini lo informa (aviso en el POS y en el panel) y el owner decide "pasar la caja a
  este equipo". Rotar la key no cambia la caja.
- **El día** es el día local de la venta (Argentina) según el `createdAt` del POS, no el del sync:
  una venta offline del martes que sincroniza el miércoles cobra el martes, una sola vez.
- **Dinero pagado**: es **del owner** (una cuenta por persona) y de ahí consumen todos sus
  comercios. Si el comercio tiene varios owners, la cuenta es la del **titular** (el que lo creó,
  transferible).
- **Créditos regalados**: son **de cada comercio**, con vencimiento, y registran su origen: el
  **bono de alta** (≈ $50.000, al crear el comercio; si quiere probar, el owner reinicia su
  comercio) o un otorgamiento manual de root o soporte, con quién y un motivo opcional.
- **Consumo de cada cargo**: con saldo pagado > 0, una **proporción configurable** por root entre
  pagado y regalado (el regalado funciona como descuento mientras paga); con saldo pagado en 0,
  100 % regalado hasta que se termine. Dentro de los regalados, primero los que vencen antes. Cada
  cargo guarda de qué salió y con qué regla, para que cambiarla no reescriba la historia.
- **Sin saldo**: aviso `warning` en el POS (`notices`) y franja en mini cuando el saldo cubre menos
  de 7 días; sin saldo, los cargos quedan como **deuda** con aviso `critical` y una **gracia**
  configurable (7 días de cargos). Pasada la gracia, **el admin de mini** del comercio queda
  restringido a créditos, pagos y exportar sus datos; **el POS sigue vendiendo y sincronizando**.
  Un pago cancela primero la deuda. Root o soporte pueden extender la gracia.
- **Pago**: por transferencia. La pantalla "Créditos" muestra saldo, consumo por caja y por día, y
  "Cómo pagar" (alias o CBU configurados por root, y un botón a WhatsApp de soporte con el mensaje
  armado). Root o soporte registra el pago de a uno o sube la **planilla de cobranzas** en CSV
  (fecha, comercio, importe, info del pago), idempotente. El importe va a la cuenta del titular.
- **Devolución**: se promete devolver el saldo pagado que quede si deja de usar mini (se muestra en
  el alta y en "Créditos"). Es un movimiento cargado por root; qué pasa con los regalados en ese
  caso lo decide root o soporte.

## Ventas y caja

Sección nueva "Ventas & Caja" en el admin: listado de ventas (filtros por fecha, caja, medio de
pago, cliente y anuladas), detalle de cada ticket, cobranzas y movimientos de caja, y resumen por
caja y por día. **Drill-down del dashboard**: cada KPI, gráfico y ranking lleva a la consulta
filtrada (ventas y caja, o catálogo, stock y clientes). La vista "mi caja" del portal la reutiliza.

## Marca

Solo lo visible: "mini contax" en el título, el landing, el login, el alta y el admin; sin
"Mini-ERP", "Express", "Multitenant", "Connector v4.2.0" ni "Offline-POS · Puerto 4100". Se muestra
la **versión de mini** (la de `package.json`) en el pie del menú y del login. El landing le habla al
comerciante, con un "powered by offline-pos" discreto. **Logo** nuevo relacionado con la marca o el
producto (no el rayo), en SVG, con favicon, compatible con modo claro y oscuro; los colores siguen
como están. El repo, el paquete y los nombres del servidor siguen siendo `mini-erp` (backlog).

## POS (offline-pos)

- **Impresión**: no imprimir, 58 mm, 80 mm y A6 (láser, para probar y para quien tenga una).
  `window.print()` con esos diseños como base universal, y ESC/POS directo (WebSerial o WebUSB)
  cuando el navegador lo permite, con corte y cajón. **Dónde se configura queda abierto**: no en
  `/CONFIG`, que ya está mezclado; quizás un comando propio, la URL o el `#connect`, o un dato de la
  caja que llega desde el backend.
- **Una sola pestaña** por instancia del navegador (las que comparten el almacenamiento), como
  WhatsApp Web, con un aviso y, si los navegadores lo permiten, un link a la pestaña original.
- **Link de demo con confirmación**: si el POS tiene datos, abrir un link de demo muestra qué se
  pierde y deja decidir al usuario (hoy decide el POS). Una caja de demo revocada ofrece empezar una
  demo nueva.
- **Modo entrenamiento**: el POS sigue haciendo pull (datos reales) pero lo que se hace queda local,
  marcado y nunca se empuja; al salir se descarta y sigue con su estado real. Franja inconfundible,
  "ENTRENAMIENTO" en el ticket y aviso al salir. No genera cargos. No toca el contrato.
- **Portal**: capacidad opcional nueva del contrato (nombre a definir en offline-pos). `GET /info`
  la declara con el nombre del comando (por ejemplo `/MINI`); el POS pide con su key un link de un
  solo uso que vence en 60 s y lo abre en una pestaña nueva; el backend lo canjea por la sesión
  anónima de esa caja. La key nunca viaja en la URL. Un backend sin la capacidad no muestra nada.

## Etapas y orden

### mini-erp

| # | Etapa | Incluye |
|---|---|---|
| M1 | Marca y limpieza | Rebranding visible, logo, versión de mini, restos de desarrollo en producción (login precargado, "Rellenar credenciales demo", pie del menú; #16.2-3), #15 y #7 |
| M2 | Roles de comercio e invitaciones | Matriz owner/admin/member en servidor y UI, links de invitación y restablecimiento, desactivar usuarios, cambiar la propia contraseña, sin registro suelto, auditoría. Reinicio de producción al publicarla |
| M3 | Contrato 4.4.0 (#2) | `notices`, `customer-payment-void`, reglas de evolución |
| M4 | Ventas y caja | Consultas de ventas, cobranzas, movimientos y resumen por caja y día; drill-down del dashboard |
| M5 | Créditos y cobro | Caja con equipo ligado, cargos, cuentas, proporción, bono de alta, deuda con gracia y restricción, avisos, pagos y planilla, devolución, pantalla "Créditos" |
| M6 | Importación con mapeo | CSV con mapeo y vista previa, clientes y saldos, productos y stock, paso "Cargá tus datos" del alta (sin el relevamiento) |
| | **Hito 1** | |
| M7 | Plataforma: soporte e impersonación | Invitar a soporte, panel de comercios y usuarios, impersonación de usuario por pestaña, pedidos de ayuda, configuración de plataforma (#16.1) |
| M8 | Demos v2 | Comercio por rubro, caja por demo, reinicios, caja inactiva revocada |
| M9 | Funnel y contactos | Id de visitante, eventos, panel del embudo, contacto |
| M10 | Portal (lado mini) | Capacidad, canje por sesión anónima, vista "mi caja" |
| M11 | Relevamiento y base global | `/relevamiento` sin conexión, ingreso masivo, base global con importador, link de relevamiento |
| | **Hito 2** | |

### offline-pos (en paralelo, código siempre en sesiones aparte)

| # | Etapa | Antes de |
|---|---|---|
| P1 | Impresión (no imprimir, 58, 80, A6, ESC/POS) | Hito 1 |
| P2 | Una sola pestaña | Hito 1 |
| P3 | Link de demo con confirmación y caja de demo revocada | M8 |
| P4 | Modo entrenamiento | Hito 2 |
| P5 | Contrato: capacidad portal (+ 429 y 503 de #173) | M10 |
| P6 | Comando y botón del portal | Hito 2 (después de P5 y M10) |

Cada etapa tiene su issue, redactado para arrancar una sesión con un prompt corto. El epic de mini
contax es #17; el del POS reemplaza al cierre del MVP de rauldiazsolis/offline-pos#166, que queda
cerrado (el circuito con mini está hecho, #2 pasa a M3 y Sheets va a su epic).

## Afuera del MVP (backlog)

- Mail (AWS SES): invitaciones, "olvidé mi contraseña", verificación.
- Verificación del WhatsApp por código.
- Regalos automáticos por escala de pago.
- Mercado Pago (acreditación automática).
- Cortar el procesamiento de lotes por deuda (opción B de la deuda).
- `.xlsx` y otros formatos y orígenes de importación.
- Colaborar con Open Food Facts.
- Google Sheets como acceso gratuito: epic propio en offline-pos, después del hito 1. Mientras tanto,
  un comercio gratis recibe créditos regalados sin vencimiento.
- Renombrar repo, paquete y servidor a `mini-contax`.
- Permisos configurables por usuario.
- Iniciar la caja del POS con datos de mini.
- #6 (Zod 4 y `@types/node` 24).

## Cuentas de prueba en producción

Las cuentas del deploy (`prueba-deploy-22778@example.com` y la de "Kiosco Deploy") se van con el
reinicio de producción de M2.
