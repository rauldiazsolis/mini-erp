import { describe, it, expect, beforeEach, vi } from 'vitest';
import { queryClient } from '../src/client/api/query-client.ts';
import { createTenantQuery, removeOtherTenants, tenantKey } from '../src/client/state/query-keys.ts';
import { logout, tokenSignal } from '../src/client/state/auth-state.ts';
import { setHistoryForTests } from '../src/client/state/route-state.ts';
import { atTenant } from './helpers/client-route.ts';

describe('Consultas del comercio activo (#59)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    logout();
    tokenSignal.value = 'tok';
  });

  it('la clave lleva el comercio y el pedido recibe comercio y token', async () => {
    const fn = vi.fn(({ tenantId }: { tenantId: string; token: string }) => Promise.resolve(`datos de ${tenantId}`));
    atTenant('kiosco');
    const q = createTenantQuery({ domain: 'products', fn });
    await vi.waitFor(() => { expect(q.data.value).toBe('datos de kiosco'); });
    expect(fn).toHaveBeenCalledWith({ tenantId: 'kiosco', token: 'tok' });
    expect(queryClient.getQueryData(tenantKey('kiosco', 'products'))).toBe('datos de kiosco');
    atTenant('almacen');
    expect(q.data.value).toBeUndefined();
    q.dispose();
  });

  it('sin sesión no hay consulta, y cerrar la sesión borra la caché', () => {
    atTenant('kiosco');
    queryClient.setQueryData(tenantKey('kiosco', 'products'), [1]);
    logout();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('removeOtherTenants deja solo el comercio activo', () => {
    queryClient.setQueryData(tenantKey('kiosco', 'products'), [1]);
    queryClient.setQueryData(tenantKey('almacen', 'products'), [2]);
    queryClient.setQueryData(['platform', 'payments'], [3]);
    removeOtherTenants('kiosco');
    expect(queryClient.getQueryData(tenantKey('almacen', 'products'))).toBeUndefined();
    expect(queryClient.getQueryData(tenantKey('kiosco', 'products'))).toEqual([1]);
    expect(queryClient.getQueryData(['platform', 'payments'])).toEqual([3]);
  });
});
