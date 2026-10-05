import { Component, type ComponentChildren } from 'preact';
import { pushDialog, popDialog, isTopDialog } from '../../state/dialog-stack.ts';
import { ToastContainer } from './ToastContainer.tsx';

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
 * El diálogo de más arriba dibuja los toasts: afuera quedarían inertes.
 */
export class DialogShell extends Component<DialogShellProps> {
  dialog: DialogLike | null = null;
  private unmounting = false;
  private stackId: number | null = null;

  setDialog = (el: HTMLDialogElement | null): void => {
    if (el !== null) this.dialog = el;
  };

  override componentDidMount(): void {
    this.dialog?.showModal();
    this.stackId = pushDialog();
  }

  override componentWillUnmount(): void {
    // Antes de que Preact saque el nodo: con close() el navegador devuelve el foco
    this.unmounting = true;
    if (this.dialog?.open === true) this.dialog.close();
    if (this.stackId !== null) popDialog(this.stackId);
  }

  handleCancel = (e: Pick<Event, 'preventDefault'>): void => {
    e.preventDefault();
    this.props.onClose();
  };

  handleClose = (): void => {
    if (!this.unmounting) this.props.onClose();
  };

  handleOverlayClick = (e: { target: unknown; currentTarget: unknown }): void => {
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
        {isTopDialog(this.stackId) && <ToastContainer />}
      </dialog>
    );
  }
}
