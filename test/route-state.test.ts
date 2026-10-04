import { describe, it, expect, beforeEach } from 'vitest';
import {
  activeSectionSignal, canonicalUrl, goTo, locationSignal, navigate, routeFilters, routeSignal, setFilters,
  setHistoryForTests, switchTenantUrl,
} from '../src/client/state/route-state.ts';

const calls: Array<[string, string]> = [];

describe('La URL como signal (#59)', () => {
  beforeEach(() => {
    setHistoryForTests({
      pushState: (_d, _u, url) => { calls.push(['push', url]); },
      replaceState: (_d, _u, url) => { calls.push(['replace', url]); },
    });
    navigate('/admin/kiosco/dashboard', { replace: true });
    calls.length = 0;
  });

  it('cambiar de sección agrega una entrada al historial', () => {
    goTo({ section: 'customers' });
    expect(calls).toEqual([['push', '/admin/kiosco/clientes']]);
    expect(activeSectionSignal.value).toBe('customers');
  });

  it('cambiar un filtro reemplaza la entrada', () => {
    goTo({ section: 'catalog' });
    calls.length = 0;
    setFilters('catalog', { q: 'coca' });
    expect(calls).toEqual([['replace', '/admin/kiosco/catalogo?q=coca']]);
    expect(routeFilters('catalog')).toEqual({ q: 'coca', category: 'all', blocked: 'all' });
  });

  it('un filtro de otra sección no hace nada y fuera de su sección vale el de por omisión', () => {
    setFilters('catalog', { q: 'coca' });
    expect(calls).toEqual([]);
    expect(routeFilters('catalog').q).toBe('');
  });

  it('navegar a la URL actual no duplica la entrada', () => {
    navigate('/admin/kiosco/dashboard');
    expect(calls).toEqual([]);
  });

  it('goTo con filtros y solapa', () => {
    goTo({ section: 'sales', tab: 'payments', filters: { preset: 'week', page: 1, status: 'voided' } });
    expect(locationSignal.value).toEqual({ pathname: '/admin/kiosco/ventas/cobranzas', search: '?rango=semana&estado=anuladas' });
  });

  it('cambiar de comercio mantiene sección y solapa y suelta los filtros', () => {
    navigate('/admin/kiosco/ventas/cobranzas?rango=semana');
    expect(switchTenantUrl(routeSignal.value, 'almacen')).toBe('/admin/almacen/ventas/cobranzas');
    expect(switchTenantUrl({ kind: 'plataforma', tab: 'payments' }, 'almacen')).toBe('/admin/almacen/dashboard');
  });

  it('la URL canónica', () => {
    expect(canonicalUrl({ pathname: '/onboarding', search: '?template=kiosco' })).toBe('/alta?template=kiosco');
    expect(canonicalUrl({ pathname: '/alta', search: '?template=kiosco' })).toBeUndefined();
    expect(canonicalUrl({ pathname: '/admin/kiosco', search: '' })).toBe('/admin/kiosco/dashboard');
    expect(canonicalUrl({ pathname: '/admin/kiosco/catalogo', search: '?estado=raro&q=x' })).toBe('/admin/kiosco/catalogo?q=x');
    expect(canonicalUrl({ pathname: '/admin/kiosco/clientes', search: '' })).toBeUndefined();
    expect(canonicalUrl({ pathname: '/admin', search: '' })).toBeUndefined();
    expect(canonicalUrl({ pathname: '/invitacion', search: '' })).toBeUndefined();
  });
});
