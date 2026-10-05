# Modales y drawers en la top layer (#56)

## Problema

`Modal` y `Drawer` (`src/client/components/ui/`) son un `div` `fixed inset-0 z-50` que se dibuja donde
está en el árbol. Si un ancestro tiene `backdrop-filter`, `transform` o `filter` (`Card`,
`FilterToolbar`, `StatCard`, `Header` y la barra de impersonación tienen `backdrop-blur`), ese ancestro
pasa a ser el contenedor del `fixed` y el modal se abre recortado adentro. Pasó en M5 con "Acciones de
plataforma" y se arregló sacando el modal del `Card`, con un test que cubre solo ese caso.

Además, hoy los modales no tienen `role="dialog"`, no cierran con Escape, el foco no entra ni vuelve
al botón que los abrió y el body se scrollea detrás.

## Decisión: `<dialog>` nativo con `showModal()`

Se descartó un `render` de Preact en un nodo colgado de `body` (`createPortal` de `preact/compat` está
prohibido por el lint): arregla el recorte, pero el foco, el trap, Escape, `aria-modal`, el fondo
inerte y el `z-index` frente a toasts y menú mobile quedan a mano, y es otra raíz de render que hay que
sincronizar en cada update.

`showModal()` lleva el diálogo a la **top layer**: ningún ancestro lo recorta ni le gana en
`z-index`. El navegador deja inerte el resto de la página (el foco no se escapa), le da semántica de
diálogo modal, respeta los `autoFocus` de los formularios, devuelve el foco al elemento anterior con
`close()` y dispara `cancel` con Escape.

## Diseño

### `ui/DialogShell.tsx`

Un componente de clase de Preact (`Component` de `preact`: no son hooks, el lint lo permite y no hace
falta `useEffect`). Recibe `onClose`, la clase del overlay y los hijos.

- `componentDidMount`: `showModal()` sobre su `<dialog>` (ref con `createRef`).
- `componentWillUnmount`: marca que se está cerrando y llama a `close()` **antes** de que Preact saque
  el nodo del DOM, para que el navegador devuelva el foco al botón que abrió el diálogo.
- El estado manda: `isOpen` sigue en los signals de cada pantalla y el `<dialog>` no se cierra solo.
  - **Escape**: `cancel` → `preventDefault()` y `onClose()`. Es el mismo camino que la X y el clic en
    el fondo; el dueño del modal decide.
  - Si el navegador cierra igual (Escape repetido sin interacción del usuario saltea `cancel`), el
    evento `close` llama a `onClose()`, salvo que el cierre venga del propio desmontaje.
- **Fondo**: el `<dialog>` ocupa toda la ventana, transparente y sin los estilos del navegador (margen,
  padding, borde, fondo, `max-width`/`max-height`, `::backdrop` transparente). Adentro va el mismo
  overlay de hoy (color, blur, claro y oscuro); un clic cuyo `target` es el overlay llama a `onClose()`.
- **Temas**: el `<dialog>` sigue siendo descendiente de `html.dark`, así que las variantes `dark:`
  funcionan igual.

`Modal` y `Drawer` conservan sus props y su aspecto: solo cambian el `div` exterior por `DialogShell`.
Las 18 pantallas que los usan no se tocan.

### Scroll del body

`html:has(dialog[open]) { overflow: hidden; }` en `index.css`, sin JS.

### Toasts

Un toast que aparece con un modal abierto (el error al guardar) quedaría debajo del fondo del modal y,
además, inerte: el clic en su X atraviesa el toast, le llega al fondo y cierra el modal. Se probó un
`popover="manual"` (va a la top layer y se ve arriba), pero sigue inerte por estar fuera del diálogo:
descartado.

Los toasts se dibujan **adentro del diálogo de más arriba**:

- `state/dialog-stack.ts`: la pila de diálogos abiertos en un signal; `DialogShell` se agrega al
  montarse y se saca al desmontarse.
- El diálogo de más arriba dibuja `<ToastContainer />` adentro de su `<dialog>`, al lado del fondo (no
  dentro de él, que tiene `backdrop-blur`): queda arriba del fondo y se puede clickear.
- `AppShell` usa `PageToasts`, que dibuja los toasts solo sin diálogos abiertos. Si un modal se cierra
  con un toast visible, el toast pasa a la página (viven en su signal).
- `ToastContainer` no cambia.

### "Acciones de plataforma"

`ActionModal` vuelve adentro del `Card` de `PlatformActionsBar` y se borra el comentario del workaround:
queda un caso real de modal dentro de una tarjeta. El guardián general reemplaza a
`test/platform-actions-modal.test.ts`.

### Fuera de alcance

- El menú mobile de `Sidebar` tiene su propio `fixed inset-0`, pero no está dentro de un contenedor con
  blur: queda como excepción explícita del guardián.
- Confirmar antes de descartar un formulario con cambios: #70.

## Tests

Vitest corre en Node, sin DOM:

- `test/dialog-shell.test.ts`: instancia `DialogShell` con un `<dialog>` falso (`showModal`, `close`,
  `open` con `vi.fn`): al montar, un `showModal()`; Escape → `preventDefault` y `onClose`; un `close`
  externo → `onClose`; al desmontar, `close()` sin `onClose`; clic en el overlay cierra y clic adentro
  no.
- `Modal` y `Drawer`: cerrados devuelven `null`; abiertos, la raíz es un `DialogShell`.
- **Guardián** `test/overlay-guard.test.ts`: recorre `src/client/**/*.tsx` y falla si aparece
  `fixed inset-0` fuera de `DialogShell` (salvo `Sidebar`, documentado), si aparece `<dialog` fuera de
  `DialogShell`, o si falta la regla del scroll en `index.css`. Así un overlay nuevo solo puede abrirse
  por la top layer, esté donde esté en el árbol.
- `test/dialog-toasts.test.ts`: la pila de diálogos, que solo el de más arriba dibuja los toasts y que
  `PageToasts` no los dibuja con un diálogo abierto.
- e2e: en `sales-cash`, un drawer se cierra con Escape y se verifica `getByRole('dialog')`.
  `roles-invitations` y `navigation` deberían pasar sin cambios.

## Prueba manual

Abrir cada modal y drawer del admin (en especial "Acciones de plataforma", dentro de su `Card`), en
claro y oscuro, desktop y mobile: se ve centrado en la ventana sin recortes, Escape y el fondo lo
cierran, Tab no sale del diálogo, el foco vuelve al botón que lo abrió y la página de atrás no
scrollea.
