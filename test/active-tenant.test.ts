import { describe, it, expect, beforeEach } from 'vitest';
import { locationSignal, navigate, setHistoryForTests } from '../src/client/state/route-state.ts';
import {
  currentUserSignal, effectiveTenantIdSignal, impersonateTenant, isImpersonatingSignal, lastTenantIdSignal, logout,
  profileLoadedSignal, registerTenantRouteEffects, selectTenant, stopImpersonation, tenantAccessSignal, tokenSignal,
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

  it('impersonar muestra la franja en ese comercio y "Salir" vuelve al de antes', () => {
    currentUserSignal.value = { id: 'r', email: 'root@local.test', name: 'Root', globalRole: 'root' };
    userTenantsSignal.value = [kiosco, almacen];
    profileLoadedSignal.value = true;
    navigate('/admin/kiosco/clientes');
    impersonateTenant('t-almacen');
    expect(path()).toBe('/admin/almacen/clientes');
    expect(isImpersonatingSignal.value).toBe(true);
    stopImpersonation();
    expect(path()).toBe('/admin/kiosco/dashboard');
    expect(isImpersonatingSignal.value).toBe(false);
  });

  it('solo root o soporte impersonan', () => {
    currentUserSignal.value = { id: 'u', email: 'u@local.test', name: 'U', globalRole: 'user' };
    userTenantsSignal.value = [kiosco, almacen];
    expect(() => { impersonateTenant('t-almacen'); }).toThrow();
  });

  it('cerrar la sesión olvida el último comercio y el perfil', () => {
    lastTenantIdSignal.value = 't-kiosco';
    profileLoadedSignal.value = true;
    logout();
    expect(lastTenantIdSignal.value).toBeNull();
    expect(profileLoadedSignal.value).toBe(false);
  });
});
