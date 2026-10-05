import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { VNode } from 'preact';
import { PLATFORM_SECTIONS } from '../src/client/routing/admin-routes.ts';
import { platformNavItems, visiblePlatformNavItems } from '../src/client/components/platform/platform-sections.tsx';
import { navItems } from '../src/client/components/shell/Sidebar.tsx';
import { Header } from '../src/client/components/shell/Header.tsx';
import { platformSectionSignal } from '../src/client/state/platform-state.ts';
import { currentUserSignal, profileLoadedSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';
import { locationSignal, navigate, setHistoryForTests } from '../src/client/state/route-state.ts';
import type { AuthUser } from '../src/client/state/auth-state.ts';
import { registerPermissionEffects } from '../src/client/state/permissions-state.ts';
import { freshSession } from './helpers/client-route.ts';

const root: AuthUser = { id: 'r', email: 'r@x.com', name: 'Root', globalRole: 'root' };
const support: AuthUser = { id: 's', email: 's@x.com', name: 'Sopo', globalRole: 'support' };
const user: AuthUser = { id: 'u', email: 'u@x.com', name: 'Juan', globalRole: 'user' };

type AnyNode = VNode<{ children?: unknown }>;
function isNode(x: unknown): x is AnyNode {
  return typeof x === 'object' && x !== null && 'type' in x && 'props' in x;
}
/** El texto de un árbol sin renderizar (solo los elementos, no los componentes hijos). */
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  return isNode(node) ? textOf(node.props.children) : '';
}

describe('Las secciones de la plataforma en el menú lateral (#81)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    freshSession();
    userTenantsSignal.value = [];
    profileLoadedSignal.value = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('el menú tiene un ítem por sección de la plataforma, en el orden de las URLs', () => {
    expect(platformNavItems.map((i) => i.id)).toEqual(PLATFORM_SECTIONS.map((s) => s.id));
    expect(platformNavItems.map((i) => i.label)).toEqual([
      'Comercios', 'Usuarios', 'Pedidos', 'Demos', 'Cobranzas', 'Soporte', 'Registro', 'Configuración',
    ]);
  });

  it('root ve las ocho secciones; soporte, seis (sin Soporte ni Configuración)', () => {
    currentUserSignal.value = root;
    expect(visiblePlatformNavItems().map((i) => i.id)).toEqual(['tenants', 'users', 'requests', 'demos', 'payments', 'staff', 'audit', 'settings']);
    currentUserSignal.value = support;
    expect(visiblePlatformNavItems().map((i) => i.id)).toEqual(['tenants', 'users', 'requests', 'demos', 'payments', 'audit']);
    currentUserSignal.value = user;
    expect(visiblePlatformNavItems()).toEqual([]);
  });

  it('el menú del comercio ya no tiene el ítem Plataforma', () => {
    expect(navItems.map((i) => i.id)).not.toContain('platform');
  });

  it('el ítem activo sale de la URL y el detalle de un comercio marca Comercios', () => {
    currentUserSignal.value = root;
    navigate('/plataforma/registro?comercio=kiosco');
    expect(platformSectionSignal.value).toBe('audit');
    navigate('/plataforma/comercios/kiosco');
    expect(platformSectionSignal.value).toBe('tenants');
  });

  it('soporte en una sección de root vuelve a Comercios; root se queda', () => {
    const dispose = registerPermissionEffects();
    currentUserSignal.value = support;
    navigate('/plataforma/soporte');
    expect(locationSignal.value.pathname).toBe('/plataforma');
    navigate('/plataforma/configuracion');
    expect(locationSignal.value.pathname).toBe('/plataforma');
    currentUserSignal.value = root;
    navigate('/plataforma/soporte');
    expect(locationSignal.value.pathname).toBe('/plataforma/soporte');
    dispose();
  });

  it('la cabecera de root y soporte no tiene el selector de comercios', () => {
    currentUserSignal.value = user;
    expect(textOf(Header())).toContain('Seleccionar Comercio');
    currentUserSignal.value = support;
    expect(textOf(Header())).not.toContain('Seleccionar Comercio');
    currentUserSignal.value = root;
    expect(textOf(Header())).not.toContain('Seleccionar Comercio');
  });

  it('la plataforma no tiene solapas', () => {
    const source = readFileSync('src/client/components/platform/PlatformView.tsx', 'utf8');
    expect(source).not.toContain('role="tab"');
    expect(source).not.toContain('tablist');
  });
});
