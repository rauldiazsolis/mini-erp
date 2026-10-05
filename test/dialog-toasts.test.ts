import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VNode } from 'preact';
import { DialogShell } from '../src/client/components/ui/DialogShell.tsx';
import { PageToasts, ToastContainer } from '../src/client/components/ui/ToastContainer.tsx';
import { openDialogsSignal, isTopDialog } from '../src/client/state/dialog-stack.ts';

type AnyNode = VNode<{ children?: unknown }>;

function isNode(x: unknown): x is AnyNode {
  return typeof x === 'object' && x !== null && 'type' in x && 'props' in x;
}

function hasToasts(node: unknown): boolean {
  if (!isNode(node)) return false;
  if (node.type === ToastContainer) return true;
  const c = node.props.children;
  return (Array.isArray(c) ? c : [c]).some(hasToasts);
}

function mountShell(): DialogShell {
  const shell = new DialogShell({ onClose: vi.fn(), label: 'D', overlayClass: 'x', children: null });
  shell.dialog = { open: false, showModal: vi.fn(), close: vi.fn() };
  shell.componentDidMount();
  return shell;
}

describe('Toasts con diálogos abiertos (#56)', () => {
  beforeEach(() => {
    openDialogsSignal.value = [];
  });

  it('los diálogos abiertos forman una pila', () => {
    const a = mountShell();
    const b = mountShell();
    expect(openDialogsSignal.value).toHaveLength(2);
    b.componentWillUnmount();
    expect(openDialogsSignal.value).toHaveLength(1);
    a.componentWillUnmount();
    expect(openDialogsSignal.value).toEqual([]);
    expect(isTopDialog(null)).toBe(false);
  });

  // Fuera del diálogo los toasts quedan inertes: un clic en su X le llega al fondo y cierra el modal
  it('solo el diálogo de más arriba dibuja los toasts, adentro del <dialog>', () => {
    const a = mountShell();
    expect(hasToasts(a.render())).toBe(true);
    const b = mountShell();
    expect(hasToasts(a.render())).toBe(false);
    expect(hasToasts(b.render())).toBe(true);
    b.componentWillUnmount();
    expect(hasToasts(a.render())).toBe(true);
  });

  it('la página dibuja los toasts solo sin diálogos abiertos', () => {
    expect(hasToasts(PageToasts())).toBe(true);
    const a = mountShell();
    expect(PageToasts()).toBeNull();
    a.componentWillUnmount();
    expect(hasToasts(PageToasts())).toBe(true);
  });
});
