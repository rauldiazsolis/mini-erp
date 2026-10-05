import { describe, it, expect, beforeEach, vi } from 'vitest';
import { suspendedNoticeSignal } from '../src/client/state/suspension-state.ts';
import { currentUserSignal, logout, userTenantsSignal } from '../src/client/state/auth-state.ts';
import { navigate, setHistoryForTests } from '../src/client/state/route-state.ts';
import { createTenantQuery } from '../src/client/state/query-keys.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

describe('comercio suspendido en el admin (#23)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    logout();
    userTenantsSignal.value = [{ tenantId: 'k', slug: 'kiosco', name: 'Kiosco', role: 'owner', status: 'suspended' }];
    currentUserSignal.value = { id: 'u', email: 'u@x.com', name: 'U', globalRole: 'user' };
  });

  it('sus usuarios ven el aviso en vez de la sección, salvo en Uso y pagos', () => {
    atTenant('kiosco', 'catalogo');
    expect(suspendedNoticeSignal.value).toBe(true);
    navigate('/admin/kiosco/uso-y-pagos');
    expect(suspendedNoticeSignal.value).toBe(false);
  });

  it('un comercio activo no lo muestra', () => {
    userTenantsSignal.value = [{ tenantId: 'k', slug: 'kiosco', name: 'Kiosco', role: 'owner', status: 'active' }];
    atTenant('kiosco', 'catalogo');
    expect(suspendedNoticeSignal.value).toBe(false);
  });

  it('root y soporte siguen viendo el comercio (hasta M7b)', () => {
    currentUserSignal.value = { id: 's', email: 's@x.com', name: 'S', globalRole: 'support' };
    atTenant('kiosco', 'catalogo');
    expect(suspendedNoticeSignal.value).toBe(false);
  });

  it('fuera de un comercio no aplica', () => {
    navigate('/plataforma');
    expect(suspendedNoticeSignal.value).toBe(false);
  });
});

describe('consultas con el comercio suspendido (#23)', () => {
  it('detrás del aviso no se pide nada del comercio, salvo el estado de cobro', async () => {
    setHistoryForTests(null);
    freshSession('tok');
    userTenantsSignal.value = [{ tenantId: 'k', slug: 'kiosco', name: 'Kiosco', role: 'owner', status: 'suspended' }];
    currentUserSignal.value = { id: 'u', email: 'u@x.com', name: 'U', globalRole: 'user' };
    atTenant('kiosco', 'catalogo');
    const products = vi.fn(() => Promise.resolve([]));
    const billing = vi.fn(() => Promise.resolve({ state: 'ok' }));
    const q1 = createTenantQuery({ domain: 'products', fn: products });
    const q2 = createTenantQuery({ domain: 'billing-status', fn: billing });
    await vi.waitFor(() => { expect(billing).toHaveBeenCalled(); });
    expect(products).not.toHaveBeenCalled();
    q1.dispose();
    q2.dispose();
  });
});
