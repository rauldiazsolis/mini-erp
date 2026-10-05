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
