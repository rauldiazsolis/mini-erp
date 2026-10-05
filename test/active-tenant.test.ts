import { describe, it, expect, beforeEach } from 'vitest';
import { locationSignal, navigate, setHistoryForTests } from '../src/client/state/route-state.ts';
import {
  effectiveTenantIdSignal, lastTenantIdSignal, logout,
  profileLoadedSignal, registerTenantRouteEffects, selectTenant, signOut, tenantAccessSignal, tokenSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';

const kiosco = { tenantId: 't-kiosco', slug: 'kiosco', name: 'Kiosco', role: 'owner' as const, status: 'active' as const };
const almacen = { tenantId: 't-almacen', slug: 'almacen', name: 'Almacén', role: 'owner' as const, status: 'active' as const };
const path = (): string => `${locationSignal.value.pathname}${locationSignal.value.search}`;

describe('El comercio activo sale de la URL (#59)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    logout();
    tokenSignal.value = 'tok';
    navigate('/');
  });

  it('busca el slug en "tus comercios"', () => {
    userTenantsSignal.value = [kiosco, almacen];
    profileLoadedSignal.value = true;
    navigate('/admin/almacen/clientes');
    expect(effectiveTenantIdSignal.value).toBe('t-almacen');
    expect(tenantAccessSignal.value).toBe('ok');
  });

  it('con el perfil cargando espera, y con un slug ajeno avisa', () => {
    navigate('/admin/almacen/clientes');
    expect(tenantAccessSignal.value).toBe('loading');
    expect(effectiveTenantIdSignal.value).toBeNull();
    userTenantsSignal.value = [kiosco];
    profileLoadedSignal.value = true;
    expect(tenantAccessSignal.value).toBe('denied');
    navigate('/admin');
    expect(tenantAccessSignal.value).toBe('none');
  });

  it('/admin va al último comercio usado y, si no hay, al primero', () => {
    const dispose = registerTenantRouteEffects();
    userTenantsSignal.value = [kiosco, almacen];
    profileLoadedSignal.value = true;
    navigate('/admin');
    expect(path()).toBe('/admin/kiosco/dashboard');
    navigate('/admin/almacen/stock');
    expect(lastTenantIdSignal.value).toBe('t-almacen');
    navigate('/admin');
    expect(path()).toBe('/admin/almacen/dashboard');
    dispose();
  });

  it('el selector mantiene la pantalla y devuelve el nombre del elegido', () => {
    userTenantsSignal.value = [kiosco, almacen];
    profileLoadedSignal.value = true;
    navigate('/admin/kiosco/ventas/cobranzas?rango=semana');
    expect(selectTenant('t-almacen')).toBe('Almacén');
    expect(path()).toBe('/admin/almacen/ventas/cobranzas');
  });

  it('"Cerrar sesión" suelta el comercio de la URL: el próximo login va al suyo; una sesión vencida no', () => {
    userTenantsSignal.value = [kiosco, almacen];
    profileLoadedSignal.value = true;
    navigate('/admin/almacen/dashboard');
    logout();
    expect(path()).toBe('/admin/almacen/dashboard');
    navigate('/admin/almacen/dashboard');
    signOut();
    expect(path()).toBe('/admin');
    expect(tokenSignal.value).toBeNull();
  });

  it('cerrar la sesión olvida el último comercio y el perfil', () => {
    lastTenantIdSignal.value = 't-kiosco';
    profileLoadedSignal.value = true;
    logout();
    expect(lastTenantIdSignal.value).toBeNull();
    expect(profileLoadedSignal.value).toBe(false);
  });
});
