import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadOnTenantAndView } from '../src/client/state/view-loader.ts';
import { activeViewSignal } from '../src/client/state/navigation-state.ts';
import { tokenSignal, activeTenantIdSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';

describe('carga de datos por pantalla (#22)', () => {
  beforeEach(() => {
    tokenSignal.value = 'tok';
    userTenantsSignal.value = [
      { tenantId: 'a', name: 'A', slug: 'a', role: 'owner', status: 'active' },
      { tenantId: 'b', name: 'B', slug: 'b', role: 'owner', status: 'active' },
    ];
    activeTenantIdSignal.value = 'a';
    activeViewSignal.value = 'dashboard';
  });

  it('carga al arrancar, al cambiar de comercio y cada vez que se entra a la pantalla', () => {
    const load = vi.fn();
    const dispose = loadOnTenantAndView('catalog', load);
    expect(load).toHaveBeenCalledTimes(1); // el comercio activo

    activeViewSignal.value = 'catalog'; // entrar: datos frescos (por ejemplo, después de importar)
    expect(load).toHaveBeenCalledTimes(2);

    activeViewSignal.value = 'stock'; // salir no recarga
    expect(load).toHaveBeenCalledTimes(2);

    activeTenantIdSignal.value = 'b'; // otro comercio, desde cualquier pantalla
    expect(load).toHaveBeenCalledTimes(3);

    activeViewSignal.value = 'catalog';
    expect(load).toHaveBeenCalledTimes(4);
    dispose();
  });

  it('sin sesión o sin comercio no carga', () => {
    tokenSignal.value = null;
    const load = vi.fn();
    const dispose = loadOnTenantAndView('customers', load);
    activeViewSignal.value = 'customers';
    expect(load).not.toHaveBeenCalled();
    dispose();
  });
});
