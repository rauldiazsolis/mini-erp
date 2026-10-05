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
