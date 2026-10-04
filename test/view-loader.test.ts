import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadOnTenantAndView } from '../src/client/state/view-loader.ts';
import { tokenSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';
import { atTenant } from './helpers/client-route.ts';

describe('carga de datos por pantalla (#22)', () => {
  beforeEach(() => {
    tokenSignal.value = 'tok';
    userTenantsSignal.value = [
      { tenantId: 'a', name: 'A', slug: 'a', role: 'owner', status: 'active' },
      { tenantId: 'b', name: 'B', slug: 'b', role: 'owner', status: 'active' },
    ];
    atTenant('a');
  });

  it('carga al arrancar, al cambiar de comercio y cada vez que se entra a la pantalla', () => {
    const load = vi.fn();
    const dispose = loadOnTenantAndView('catalog', load);
    expect(load).toHaveBeenCalledTimes(1); // el comercio activo

    atTenant('a', 'catalogo'); // entrar: datos frescos (por ejemplo, después de importar)
    expect(load).toHaveBeenCalledTimes(2);

    atTenant('a', 'stock'); // salir no recarga
    expect(load).toHaveBeenCalledTimes(2);

    atTenant('b', 'dashboard'); // otro comercio, desde cualquier pantalla
    expect(load).toHaveBeenCalledTimes(3);

    atTenant('b', 'catalogo');
    expect(load).toHaveBeenCalledTimes(4);
    dispose();
  });

  it('sin sesión o sin comercio no carga', () => {
    tokenSignal.value = null;
    const load = vi.fn();
    const dispose = loadOnTenantAndView('customers', load);
    atTenant('a', 'clientes');
    expect(load).not.toHaveBeenCalled();
    dispose();
  });
});
