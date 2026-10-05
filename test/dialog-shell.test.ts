import { describe, it, expect, vi } from 'vitest';
import { DialogShell } from '../src/client/components/ui/DialogShell.tsx';

function setup() {
  const onClose = vi.fn();
  const shell = new DialogShell({ onClose, label: 'Prueba', overlayClass: 'x', children: null });
  const dialog = {
    open: false,
    showModal: vi.fn(() => {
      dialog.open = true;
    }),
    close: vi.fn(() => {
      dialog.open = false;
    }),
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
