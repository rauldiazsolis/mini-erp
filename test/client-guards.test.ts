import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TENANT_SECTIONS } from '../src/client/routing/admin-routes.ts';
import { navItems } from '../src/client/components/shell/Sidebar.tsx';
import { isPlainLeftClick } from '../src/client/components/ui/Link.tsx';

const ROOT = 'src/client';
const files = (readdirSync(ROOT, { recursive: true, encoding: 'utf8' }))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => f.replaceAll('\\', '/'));
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

describe('Guardianes del cliente (#59)', () => {
  it('cada sección del comercio tiene su ítem en el menú y viceversa (#81: la plataforma tiene el suyo)', () => {
    expect([...navItems.map((i) => i.id)].sort()).toEqual([...TENANT_SECTIONS].sort());
  });

  it('solo route-state navega con el historial; la vuelta al POS del alta es la excepción', () => {
    const allowed = new Set(['state/route-state.ts', 'state/merchant-onboarding-state.ts']);
    const offenders = files.filter((f) => !allowed.has(f) && /history\.(pushState|replaceState)|location\.(assign|replace)\(|location\.href\s*=/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('solo query-client crea el QueryClient y los observers', () => {
    const offenders = files.filter((f) => f !== 'api/query-client.ts' && /new (QueryClient|QueryObserver)\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('un link navega solo con el clic izquierdo sin teclas', () => {
    const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
    expect(isPlainLeftClick(base)).toBe(true);
    expect(isPlainLeftClick({ ...base, ctrlKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...base, metaKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...base, button: 1 })).toBe(false);
    expect(isPlainLeftClick({ ...base, defaultPrevented: true })).toBe(false);
  });

  it('solo auth-state toca el sessionStorage (#23)', () => {
    const offenders = files.filter((f) => f !== 'state/auth-state.ts' && /sessionStorage/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
