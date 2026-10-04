# Modales y drawers en la top layer — plan de implementación

> **Para agentes:** se ejecuta con `superpowers:executing-plans`, **tarea por tarea en la misma
> conversación** (nunca un subagente por tarea, AGENTS.md). Al terminar cada tarea: verificar, commitear
> y frenar para que el usuario la revise. Pasos con `- [ ]`.

**Objetivo:** que `Modal` y `Drawer` se abran siempre en la top layer con `<dialog>` + `showModal()`,
sin recortes por el contenedor, con Escape, foco atrapado y devuelto, y sin scroll del body (#56).

**Arquitectura:** un `DialogShell` de clase (Preact, sin hooks) monta el `<dialog>`, llama a
`showModal()` al montarse y a `close()` al desmontarse, y traduce Escape, el clic en el fondo y un
`close` externo a `onClose()`. `Modal` y `Drawer` solo cambian su `div` exterior por el shell. Los
toasts pasan a un `popover="manual"` para quedar arriba del modal. Un guardián estático impide overlays
fuera del shell.

**Stack:** Preact 10 + `@preact/signals`, Tailwind CSS v4, Vitest (Node, sin DOM), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-modales-top-layer-design.md`

## Restricciones globales

- Todo en español: código, comentarios, commits.
- Sin hooks ni `preact/compat` (lint `no-restricted-imports`); `Component` y `createRef` de `preact` sí.
- TypeScript estricto: sin `any`, sin `as` ni `!` para callar errores; sin parameter properties.
- TDD: el test primero, verlo fallar, implementar, verlo pasar.
- Antes de cada commit: `pnpm lint && pnpm typecheck && pnpm test` (en PowerShell); `pnpm build` si se
  toca el cliente.
- Commits convencionales en español, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Tarea 1: `DialogShell`

**Archivos:**
- Crear: `src/client/components/ui/DialogShell.tsx`
- Test: `test/dialog-shell.test.ts`

**Interfaces:**
- Produce: `class DialogShell extends Component<DialogShellProps>` con
  `DialogShellProps = { onClose: () => void; label: string; overlayClass: string; children: ComponentChildren }`,
  `type DialogLike = Pick<HTMLDialogElement, 'showModal' | 'close' | 'open'>`, campo público
  `dialog: DialogLike | null` y los handlers públicos `handleCancel`, `handleClose`,
  `handleOverlayClick`.

- [ ] **Paso 0: dependencias del worktree**

Run (PowerShell): `pnpm install`
Esperado: termina sin errores y aparece `node_modules/`.

- [ ] **Paso 1: test que falla**

`test/dialog-shell.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DialogShell, type DialogLike } from '../src/client/components/ui/DialogShell.tsx';

function setup() {
  const onClose = vi.fn();
  const shell = new DialogShell({ onClose, label: 'Prueba', overlayClass: 'x', children: null });
  const dialog: DialogLike & { showModal: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } = {
    open: false,
    showModal: vi.fn(() => { dialog.open = true; }),
    close: vi.fn(() => { dialog.open = false; }),
  };
  shell.dialog = dialog;
  return { shell, dialog, onClose };
}

describe('DialogShell (#56)', () => {
  it('al montarse abre el diálogo como modal, en la top layer', () => {
    const { shell, dialog } = setup();
    shell.componentDidMount();
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
  });

  it('Escape no cierra solo el diálogo: pide el cierre con onClose', () => {
    const { shell, onClose } = setup();
    const preventDefault = vi.fn();
    shell.handleCancel({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('si el navegador lo cierra por su cuenta, avisa con onClose', () => {
    const { shell, onClose } = setup();
    shell.componentDidMount();
    shell.handleClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('al desmontarse cierra el diálogo (el foco vuelve) sin volver a llamar a onClose', () => {
    const { shell, dialog, onClose } = setup();
    shell.componentDidMount();
    shell.componentWillUnmount();
    shell.handleClose(); // el evento close que dispara close()
    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('un clic en el fondo cierra; un clic adentro del panel, no', () => {
    const { shell, onClose } = setup();
    const overlay = {};
    shell.handleOverlayClick({ target: {}, currentTarget: overlay });
    expect(onClose).not.toHaveBeenCalled();
    shell.handleOverlayClick({ target: overlay, currentTarget: overlay });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

Nota de tipos: los handlers reciben `Pick<Event, …>`, así los objetos del test encajan sin `as`. Si
`target`/`currentTarget` (`EventTarget | null`) no aceptan `{}`, tiparlos en el handler como
`{ target: unknown; currentTarget: unknown }`.

- [ ] **Paso 2: verlo fallar**

Run: `pnpm vitest run test/dialog-shell.test.ts`
Esperado: FAIL (no existe `DialogShell.tsx`).

- [ ] **Paso 3: implementación**

`src/client/components/ui/DialogShell.tsx`:

```tsx
import { Component, type ComponentChildren } from 'preact';

/** Lo que el shell usa del `<dialog>`: alcanza para probarlo sin DOM. */
export type DialogLike = Pick<HTMLDialogElement, 'showModal' | 'close' | 'open'>;

export type DialogShellProps = {
  onClose: () => void;
  /** Nombre accesible del diálogo (el título del modal o del drawer). */
  label: string;
  /** Clases del fondo que ocupa toda la ventana: color, blur y dónde va el panel. */
  overlayClass: string;
  children: ComponentChildren;
};

/**
 * Base de `Modal` y `Drawer` (#56): un `<dialog>` abierto con `showModal()`, que va a la top layer.
 * Así ningún contenedor (un `Card` con `backdrop-blur`, un `transform`) lo recorta, el resto de la
 * página queda inerte y el navegador devuelve el foco al cerrarse. El estado manda: el diálogo vive
 * mientras el componente está montado y Escape, el fondo o un cierre del navegador piden `onClose`.
 */
export class DialogShell extends Component<DialogShellProps> {
  dialog: DialogLike | null = null;
  private unmounting = false;

  setDialog = (el: HTMLDialogElement | null): void => {
    if (el !== null) this.dialog = el;
  };

  componentDidMount(): void {
    this.dialog?.showModal();
  }

  componentWillUnmount(): void {
    // Antes de que Preact saque el nodo: con close() el navegador devuelve el foco
    this.unmounting = true;
    if (this.dialog?.open === true) this.dialog.close();
  }

  handleCancel = (e: Pick<Event, 'preventDefault'>): void => {
    e.preventDefault();
    this.props.onClose();
  };

  handleClose = (): void => {
    if (!this.unmounting) this.props.onClose();
  };

  handleOverlayClick = (e: Pick<Event, 'target' | 'currentTarget'>): void => {
    if (e.target === e.currentTarget) this.props.onClose();
  };

  render() {
    return (
      <dialog
        ref={this.setDialog}
        aria-label={this.props.label}
        onCancel={this.handleCancel}
        onClose={this.handleClose}
        class="fixed inset-0 m-0 p-0 border-0 bg-transparent w-full h-full max-w-none max-h-none overflow-hidden backdrop:bg-transparent"
      >
        <div class={this.props.overlayClass} onClick={this.handleOverlayClick}>
          {this.props.children}
        </div>
      </dialog>
    );
  }
}
```

`setDialog` ignora el `null` del desmontaje: Preact llama a `componentWillUnmount` antes de limpiar
las refs de los hijos, pero así no depende de ese orden.

- [ ] **Paso 4: verlo pasar**

Run: `pnpm vitest run test/dialog-shell.test.ts`
Esperado: 5 tests PASS.

- [ ] **Paso 5: verificación y commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`

```bash
git add src/client/components/ui/DialogShell.tsx test/dialog-shell.test.ts
git commit -m "feat: DialogShell abre los diálogos en la top layer con showModal (#56)"
```

---

### Tarea 2: `Modal` y `Drawer` sobre `DialogShell`, sin scroll del body

**Archivos:**
- Modificar: `src/client/components/ui/Modal.tsx`, `src/client/components/ui/Drawer.tsx`,
  `src/client/index.css`
- Test: `test/modal-drawer.test.ts`

**Interfaces:**
- Consume: `DialogShell` y `DialogShellProps` (Tarea 1).
- Produce: `Modal` y `Drawer` con las mismas props de hoy.

- [ ] **Paso 1: test que falla**

`test/modal-drawer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Modal } from '../src/client/components/ui/Modal.tsx';
import { Drawer } from '../src/client/components/ui/Drawer.tsx';
import { DialogShell } from '../src/client/components/ui/DialogShell.tsx';

describe('Modal y Drawer (#56)', () => {
  it('cerrados no dibujan nada', () => {
    expect(Modal({ isOpen: false, onClose: vi.fn(), title: 'M', children: null })).toBeNull();
    expect(Drawer({ isOpen: false, onClose: vi.fn(), title: 'D', children: null })).toBeNull();
  });

  it('abiertos van por DialogShell, con el título como nombre del diálogo', () => {
    const onClose = vi.fn();
    const modal = Modal({ isOpen: true, onClose, title: 'Nuevo cliente', children: null });
    const drawer = Drawer({ isOpen: true, onClose, title: 'Resumen del día', children: null });
    expect(modal?.type).toBe(DialogShell);
    expect(modal?.props).toMatchObject({ label: 'Nuevo cliente', onClose });
    expect(drawer?.type).toBe(DialogShell);
    expect(drawer?.props).toMatchObject({ label: 'Resumen del día', onClose });
  });

  it('con un diálogo abierto la página de atrás no scrollea', () => {
    expect(readFileSync('src/client/index.css', 'utf8')).toMatch(/html:has\(dialog\[open\]\)\s*\{\s*overflow:\s*hidden;?\s*\}/);
  });
});
```

- [ ] **Paso 2: verlo fallar**

Run: `pnpm vitest run test/modal-drawer.test.ts`
Esperado: FAIL en "abiertos van por DialogShell" (hoy la raíz es un `div`) y en el CSS.

- [ ] **Paso 3: implementación**

En `Modal.tsx`, importar `DialogShell` y reemplazar el `div` exterior (con su `onClick`) por:

```tsx
    <DialogShell
      label={props.title}
      onClose={props.onClose}
      overlayClass="w-full h-full bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      {/* el panel de hoy, sin cambios */}
    </DialogShell>
```

En `Drawer.tsx`, igual:

```tsx
    <DialogShell
      label={props.title}
      onClose={props.onClose}
      overlayClass="w-full h-full bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm flex justify-end"
    >
      {/* el panel de hoy, sin cambios */}
    </DialogShell>
```

Se van del overlay `fixed inset-0`, `z-50` y las clases `animate-in …` (no hay plugin que las
defina); el resto queda igual. En `index.css`, después del `@import`:

```css
/* Con un Modal o un Drawer abierto (#56), la página de atrás no scrollea */
html:has(dialog[open]) {
  overflow: hidden;
}
```

- [ ] **Paso 4: verlo pasar**

Run: `pnpm vitest run test/modal-drawer.test.ts`
Esperado: 3 tests PASS.

- [ ] **Paso 5: verificación en el navegador integrado**

`pnpm dev` (PowerShell, en segundo plano) y con el navegador integrado, logueado como
`dueno-a@local.test`: abrir "Nuevo cliente" (Clientes) y un ticket (Ventas & Caja). Verificar que el
fondo cubre toda la ventana con blur, Escape cierra, el foco vuelve al botón y el body no scrollea, en
claro y oscuro. Si el `backdrop-blur` del overlay no difumina la página dentro de la top layer, moverlo
a `backdrop:backdrop-blur-sm` en el `<dialog>` y anotarlo en la spec.

- [ ] **Paso 6: verificación y commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

```bash
git add src/client/components/ui/Modal.tsx src/client/components/ui/Drawer.tsx src/client/index.css test/modal-drawer.test.ts
git commit -m "feat: Modal y Drawer se abren en la top layer, con Escape y sin scroll del body (#56)"
```

---

### Tarea 3: guardián de overlays y "Acciones de plataforma" de vuelta en su `Card`

**Archivos:**
- Crear: `test/overlay-guard.test.ts`
- Borrar: `test/platform-actions-modal.test.ts`
- Modificar: `src/client/components/credits/PlatformActionsBar.tsx:230-259`

**Interfaces:**
- Consume: `DialogShell.tsx` (único archivo con `<dialog` y `fixed inset-0`).

- [ ] **Paso 1: el guardián**

`test/overlay-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/client';
const files = readdirSync(ROOT, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => f.replaceAll('\\', '/'));
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

describe('Guardián de overlays (#56)', () => {
  // Un fixed a pantalla completa dentro de un Card (backdrop-blur) se recorta contra la tarjeta.
  // Los modales y drawers van por DialogShell, en la top layer; el menú mobile no está dentro de
  // ningún contenedor con blur.
  it('solo DialogShell (y el menú mobile) dibujan un overlay a pantalla completa', () => {
    const allowed = new Set(['components/ui/DialogShell.tsx', 'components/shell/Sidebar.tsx']);
    const offenders = files.filter((f) => !allowed.has(f) && read(f).includes('fixed inset-0'));
    expect(offenders).toEqual([]);
  });

  it('solo DialogShell usa <dialog>: el resto, Modal o Drawer', () => {
    const offenders = files.filter((f) => f !== 'components/ui/DialogShell.tsx' && /<dialog\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Paso 2: correrlo**

Run: `pnpm vitest run test/overlay-guard.test.ts`
Esperado: PASS (la Tarea 2 ya sacó el `fixed inset-0` de `Modal` y `Drawer`). Para comprobar que
muerde, agregar a mano `fixed inset-0` en un componente cualquiera, verlo fallar con ese archivo en
`offenders` y deshacerlo.

- [ ] **Paso 3: `ActionModal` adentro del `Card`**

En `PlatformActionsBar`, borrar el comentario del workaround y el fragmento, y poner
`<ActionModal />` como último hijo del `Card`:

```tsx
export function PlatformActionsBar() {
  const isRoot = currentUserSignal.value?.globalRole === 'root';
  return (
    <Card class="space-y-3 border-amber-300 dark:border-amber-500/30">
      <h3 class="text-sm font-bold text-amber-700 dark:text-amber-300">Acciones de plataforma</h3>
      <div class="flex flex-wrap gap-2">
        {/* los botones de hoy, sin cambios */}
      </div>
      <ActionModal />
    </Card>
  );
}
```

Borrar `test/platform-actions-modal.test.ts` (lo cubre el guardián).

- [ ] **Paso 4: verificación en el navegador integrado**

Logueado como `root@local.test`, impersonar el Kiosco y abrir Uso y pagos → "Registrar pago": el modal
se ve centrado en la ventana, sin recorte, con el fondo cubriendo toda la página.

- [ ] **Paso 5: verificación y commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

```bash
git add test/overlay-guard.test.ts src/client/components/credits/PlatformActionsBar.tsx
git rm test/platform-actions-modal.test.ts
git commit -m "test: guardián de overlays y el modal de acciones de plataforma vuelve a su Card (#56)"
```

---

### Tarea 4: toasts arriba de los diálogos

**Archivos:**
- Modificar: `src/client/components/ui/ToastContainer.tsx`
- Test: `test/toast-layer.test.ts`

**Interfaces:**
- Produce: `class ToastContainer extends Component` (el uso `<ToastContainer />` en `AppShell.tsx` no
  cambia), con campo público `layer: PopoverLike | null` y método público `syncLayer(): void`;
  `type PopoverLike = Pick<HTMLElement, 'showPopover' | 'hidePopover'>`.

- [ ] **Paso 1: test que falla**

`test/toast-layer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToastContainer } from '../src/client/components/ui/ToastContainer.tsx';
import { toastsSignal } from '../src/client/state/toast-state.ts';

function setup() {
  const container = new ToastContainer({});
  const layer = { showPopover: vi.fn(), hidePopover: vi.fn() };
  container.layer = layer;
  return { container, layer };
}

const toast = { id: 't1', type: 'error' as const, title: 'No se pudo guardar' };

describe('Toasts sobre los diálogos (#56)', () => {
  beforeEach(() => { toastsSignal.value = []; });

  it('sin toasts la capa queda oculta', () => {
    const { container, layer } = setup();
    container.syncLayer();
    expect(layer.showPopover).not.toHaveBeenCalled();
  });

  it('con un toast nuevo la capa se vuelve a mostrar, arriba del último diálogo', () => {
    const { container, layer } = setup();
    toastsSignal.value = [toast];
    container.syncLayer();
    toastsSignal.value = [toast, { ...toast, id: 't2' }];
    container.syncLayer();
    expect(layer.showPopover).toHaveBeenCalledTimes(2);
    expect(layer.hidePopover).toHaveBeenCalledTimes(1);
  });

  it('cuando se van todos, se oculta', () => {
    const { container, layer } = setup();
    toastsSignal.value = [toast];
    container.syncLayer();
    toastsSignal.value = [];
    container.syncLayer();
    expect(layer.hidePopover).toHaveBeenCalledTimes(1);
  });

  it('la capa es un popover manual', () => {
    const tree = new ToastContainer({}).render();
    expect(tree.props).toMatchObject({ popover: 'manual' });
  });
});
```

`type: 'error' as const` es un literal, no un `as` que calle un error; si el lint lo objeta, tipar
`toast` como `ToastItem`.

- [ ] **Paso 2: verlo fallar**

Run: `pnpm vitest run test/toast-layer.test.ts`
Esperado: FAIL (`ToastContainer` es una función, no una clase).

- [ ] **Paso 3: implementación**

`ToastContainer.tsx` pasa a clase. El JSX de cada toast y `typeStyles` no cambian (mover `typeStyles`
afuera, como constante del módulo). La raíz se dibuja siempre (el popover necesita el nodo) y el
navegador la oculta mientras no se muestre:

```tsx
import { Component } from 'preact';
import { toastsSignal, dismissToast, type ToastType } from '../../state/toast-state.ts';

/** Lo que la capa usa del popover: alcanza para probarlo sin DOM. */
export type PopoverLike = Pick<HTMLElement, 'showPopover' | 'hidePopover'>;

const typeStyles: Record<ToastType, { border: string; bg: string; iconBg: string; text: string }> = {
  /* los estilos de hoy, sin cambios */
};

/**
 * Los toasts van en un popover (#56): como los diálogos, está en la top layer, y al volver a
 * mostrarlo con cada toast nuevo queda arriba del último Modal o Drawer abierto.
 */
export class ToastContainer extends Component {
  layer: PopoverLike | null = null;
  private shown = false;

  setLayer = (el: HTMLDivElement | null): void => {
    if (el !== null) this.layer = el;
  };

  componentDidMount(): void {
    this.syncLayer();
  }

  componentDidUpdate(): void {
    this.syncLayer();
  }

  syncLayer(): void {
    if (this.layer === null) return;
    if (this.shown) this.layer.hidePopover();
    this.shown = toastsSignal.value.length > 0;
    if (this.shown) this.layer.showPopover();
  }

  render() {
    const toasts = toastsSignal.value;
    return (
      <div
        ref={this.setLayer}
        popover="manual"
        class="fixed inset-auto bottom-4 right-4 m-0 border-0 bg-transparent overflow-visible flex flex-col gap-2 max-w-sm w-full pointer-events-none p-2"
      >
        {toasts.map((toast) => {
          /* el toast de hoy, sin cambios */
        })}
      </div>
    );
  }
}
```

Notas: `[popover]:not(:popover-open)` del navegador (`display: none`) le gana a `flex` por
especificidad, así que cerrado no se ve. `z-50` se va (la top layer no usa `z-index`). La señal se lee
en `render`: `@preact/signals` redibuja también los componentes de clase.

- [ ] **Paso 4: verlo pasar**

Run: `pnpm vitest run test/toast-layer.test.ts`
Esperado: 4 tests PASS.

- [ ] **Paso 5: verificación en el navegador integrado**

Con un modal abierto, provocar un toast con un error real de una mutación (por ejemplo, en "Invitar"
un correo que ya es miembro del comercio). El toast se ve arriba del fondo del modal y se va solo. Sin modal, los toasts se
ven como siempre, abajo a la derecha, en claro y oscuro.

- [ ] **Paso 6: verificación y commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

```bash
git add src/client/components/ui/ToastContainer.tsx test/toast-layer.test.ts
git commit -m "feat: los toasts van en un popover, arriba de los modales abiertos (#56)"
```

---

### Tarea 5: e2e con Escape

**Archivos:**
- Modificar: `e2e/sales-cash.spec.ts:69-76`

- [ ] **Paso 1: cambiar el cierre del resumen del día**

Reemplazar el `Cerrar panel` de la línea 75 por:

```ts
  // #56: el drawer es un diálogo modal y Escape lo cierra
  await expect(page.getByRole('dialog', { name: 'Resumen del día' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
```

- [ ] **Paso 2: correr los e2e**

Run (PowerShell): `pnpm test:e2e`
Esperado: todos en verde (`demo-onboarding`, `navigation`, `roles-invitations`, `sales-cash`). Si
alguno falla por el diálogo (por ejemplo, un selector que ahora encuentra el fondo inerte), arreglar el
selector y anotarlo en el informe.

- [ ] **Paso 3: commit**

```bash
git add e2e/sales-cash.spec.ts
git commit -m "test: el e2e de ventas cierra el resumen del día con Escape (#56)"
```

---

### Tarea 6: AGENTS.md, versión y cierre

**Archivos:**
- Modificar: `AGENTS.md`, `package.json`
- Borrar: `docs/superpowers/plans/2026-10-04-modales-top-layer.md` (el plan se borra en el PR que cierra
  la etapa; la spec queda)

- [ ] **Paso 1: convención en AGENTS.md**

En la sección del cliente, después de "Componentes propios estilo shadcn…":

```markdown
  - **Modales y drawers en la top layer** (#56, spec `docs/superpowers/specs/2026-10-04-modales-top-layer-design.md`):
    todo overlay va por `Modal` o `Drawer`, que se abren con `<dialog>` y `showModal()`
    (`ui/DialogShell.tsx`, de clase, sin hooks). Ningún contenedor los recorta, el resto queda inerte,
    Escape y el fondo piden `onClose` y el foco vuelve solo; con un diálogo abierto el body no
    scrollea (`index.css`). Los toasts van en un `popover` para quedar arriba.
    `test/overlay-guard.test.ts` falla si aparece otro `fixed inset-0` o `<dialog`.
```

- [ ] **Paso 2: sección "Estado"**

Reemplazar el párrafo "Antes de M7, en este orden (#17): …" por:

```markdown
Antes de M7, en este orden (#17): el POS en el canal `/v4/`, `POS_URL` por omisión y contrato 4.5.0
(#58 con #38, hecha), la parte chica del contrato 4.6.0 (#63, hecha sin el portal: la capacidad
`portal` queda para M10, #26, y por eso el issue sigue abierto), formato según el navegador (#51,
hecha), router y TanStack Query (#59, hecha, con #55: "Uso y pagos" y bonos), modales y drawers en la
top layer (#56, hecha) y después #6.
```

- [ ] **Paso 3: versión patch**

Run (PowerShell): `pnpm version patch --no-git-tag-version`
Esperado: `package.json` pasa de `0.11.0` a `0.11.1`.

- [ ] **Paso 4: borrar el plan**

Run: `git rm docs/superpowers/plans/2026-10-04-modales-top-layer.md`

- [ ] **Paso 5: verificación completa**

Run (PowerShell): `pnpm lint && pnpm typecheck && pnpm test`, `pnpm build`, `pnpm test:e2e`
Esperado: todo en verde.

- [ ] **Paso 6: commit**

```bash
git add AGENTS.md package.json
git commit -m "docs: modales en la top layer en AGENTS.md, estado al día y versión 0.11.1 (#56)"
```

- [ ] **Paso 7: informe con la prueba manual**

Lista tildable, empezando por la carpeta del worktree y la rama, en el navegador integrado: cada modal
y drawer del admin (catálogo: producto y bloqueo; clientes: alta, cobranza, ajuste de saldo, cuenta
corriente, discrepancias; ventas: ticket, cobranza, resumen del día; stock: ajuste y kardex; usuarios:
invitar y link listo; configuración: sucursales y cajas; impersonación; Uso y pagos → acciones de
plataforma, dentro de su `Card`), en claro y oscuro, desktop y mobile: centrado sin recortes, Escape y
el fondo cierran, Tab no sale, el foco vuelve y el body no scrollea. Con el OK del usuario, el PR con
"Closes #56"; después del merge, verificar que #56 se cerró.
