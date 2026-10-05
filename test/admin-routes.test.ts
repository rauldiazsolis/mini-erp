import { describe, it, expect } from 'vitest';
import {
  TENANT_SECTIONS, SECTION_TABS, PLATFORM_SECTIONS, adminUrl, buildUrl, decodeFilters, encodeFilters, parseLocation, platformUrl,
  platformTenantUrl,
  enterUrl,
  helpRequestUrl,
  type Route,
} from '../src/client/routing/admin-routes.ts';

const roundTrip = (url: string): string => {
  const u = new URL(url, 'http://x');
  return buildUrl(parseLocation(u.pathname, u.search));
};

describe('Rutas del admin (#59)', () => {
  it('las URLs que ya existían se reconocen igual', () => {
    const cases: Array<[string, Route['kind']]> = [
      ['/', 'landing'], ['/cualquier-cosa', 'landing'], ['/alta', 'alta'], ['/onboarding', 'alta'], ['/ALTA/', 'alta'],
      ['/invitacion', 'invitacion'], ['/restablecer', 'restablecer'], ['/admin', 'admin'], ['/admin/', 'admin'],
      ['/admin/kiosco/clientes', 'admin'], ['/plataforma', 'plataforma'],
    ];
    for (const [path, kind] of cases) expect(parseLocation(path, '').kind, path).toBe(kind);
  });

  it('cada sección y cada solapa van y vuelven', () => {
    for (const section of TENANT_SECTIONS) {
      for (const tab of SECTION_TABS[section]) {
        const url = adminUrl('kiosco', section, { tab: tab.id });
        expect(roundTrip(url), url).toBe(url);
        const route = parseLocation(new URL(url, 'http://x').pathname, '');
        expect(route).toMatchObject({ kind: 'admin', tenantSlug: 'kiosco', section, tab: tab.id });
      }
    }
    for (const section of PLATFORM_SECTIONS) {
      const url = platformUrl(section.id);
      expect(parseLocation(url, '')).toMatchObject({ kind: 'plataforma', section: section.id, tenantSlug: null });
      expect(roundTrip(url)).toBe(url);
    }
  });

  it('los slugs de las secciones son los de la spec (#55: Uso y pagos)', () => {
    expect(adminUrl('k', 'dashboard')).toBe('/admin/k/dashboard');
    expect(adminUrl('k', 'sales', { tab: 'payments' })).toBe('/admin/k/ventas/cobranzas');
    expect(adminUrl('k', 'catalog')).toBe('/admin/k/catalogo');
    expect(adminUrl('k', 'customers')).toBe('/admin/k/clientes');
    expect(adminUrl('k', 'bulk', { tab: 'io' })).toBe('/admin/k/masivas/archivos');
    expect(adminUrl('k', 'settings', { tab: 'pos' })).toBe('/admin/k/configuracion');
    expect(adminUrl('k', 'settings', { tab: 'appearance' })).toBe('/admin/k/configuracion/apariencia');
    expect(adminUrl('k', 'credits', { tab: 'gifts' })).toBe('/admin/k/uso-y-pagos/bonos');
    expect(platformUrl('settings')).toBe('/plataforma/configuracion');
  });

  it('plataforma: Comercios por omisión, solapas, detalle de comercio y filtros (#23)', () => {
    expect(parseLocation('/plataforma', '')).toEqual({ kind: 'plataforma', section: 'tenants', tenantSlug: null, params: {} });
    expect(parseLocation('/plataforma/cobranzas', '')).toMatchObject({ section: 'payments', tenantSlug: null });
    expect(parseLocation('/plataforma/soporte', '')).toMatchObject({ section: 'staff' });
    expect(parseLocation('/plataforma/comercios/Kiosco-X', '?q=1')).toEqual({ kind: 'plataforma', section: 'tenants', tenantSlug: 'kiosco-x', params: {} });
    expect(parseLocation('/plataforma', '?q=%20kio%20')).toMatchObject({ section: 'tenants', params: { q: 'kio' } });
    expect(parseLocation('/plataforma/usuarios', '?q=ana&x=1')).toMatchObject({ section: 'users', params: { q: 'ana' } });
    expect(parseLocation('/plataforma/registro', '?comercio=kiosco&q=x')).toMatchObject({ section: 'audit', params: { comercio: 'kiosco' } });
    expect(parseLocation('/plataforma/cobranzas', '?q=x')).toMatchObject({ params: {} });
    expect(buildUrl({ kind: 'plataforma', section: 'tenants', tenantSlug: 'kiosco-x', params: {} })).toBe('/plataforma/comercios/kiosco-x');
    expect(platformTenantUrl('kiosco x')).toBe('/plataforma/comercios/kiosco%20x');
    expect(platformUrl('users', { q: 'ana' })).toBe('/plataforma/usuarios?q=ana');
    expect(platformUrl('tenants', { q: '' })).toBe('/plataforma');
    expect(roundTrip('/plataforma/comercios/kiosco')).toBe('/plataforma/comercios/kiosco');
    expect(roundTrip('/plataforma/comercios')).toBe('/plataforma');
    expect(parseLocation('/plataforma/nada', '')).toMatchObject({ section: 'tenants' });
  });

  it('normaliza: comercio sin sección, mayúsculas, solapa y sección desconocidas', () => {
    expect(roundTrip('/admin/kiosco')).toBe('/admin/kiosco/dashboard');
    expect(roundTrip('/Admin/Kiosco/Clientes/')).toBe('/admin/kiosco/clientes');
    expect(roundTrip('/admin/kiosco/ventas/inexistente')).toBe('/admin/kiosco/ventas');
    expect(roundTrip('/admin/kiosco/inexistente')).toBe('/admin/kiosco/dashboard');
    expect(roundTrip('/admin')).toBe('/admin');
    expect(roundTrip('/plataforma/otra')).toBe('/plataforma');
  });

  it('descarta filtros inválidos y no escribe los de por omisión', () => {
    expect(roundTrip('/admin/k/catalogo?q=coca&estado=raro&otro=1')).toBe('/admin/k/catalogo?q=coca');
    expect(roundTrip('/admin/k/ventas?pagina=abc&rango=hoy')).toBe('/admin/k/ventas');
    expect(roundTrip('/admin/k/ventas?desde=2026-02-30&hasta=2026-03-01')).toBe('/admin/k/ventas');
    expect(roundTrip('/admin/k/dashboard?periodo=semana')).toBe('/admin/k/dashboard');
    expect(roundTrip('/admin/k/usuarios?q=x')).toBe('/admin/k/usuarios');
  });

  it('filtros de ventas: rango, caja vacía ("sin punto de venta"), estado y página', () => {
    const url = '/admin/k/ventas?desde=2026-10-01&hasta=2026-10-03&sucursal=CENTRAL&caja=&pagina=2&estado=anuladas&producto=p1';
    expect(roundTrip(url)).toBe(url);
    expect(decodeFilters('sales', { desde: '2026-10-01', hasta: '2026-10-03', caja: '' })).toEqual({
      preset: 'custom', from: '2026-10-01', to: '2026-10-03', pointOfSale: '', page: 1, status: 'all',
    });
    expect(decodeFilters('sales', { rango: 'semana' })).toEqual({ preset: 'week', page: 1, status: 'all' });
    expect(encodeFilters('sales', { preset: 'today', page: 1, status: 'all' })).toEqual({});
  });

  it('filtros de catálogo, stock, clientes, dashboard y uso y pagos', () => {
    expect(decodeFilters('catalog', { q: 'coca', categoria: 'Bebidas', estado: 'bloqueados' })).toEqual({ q: 'coca', category: 'Bebidas', blocked: 'blocked' });
    expect(decodeFilters('stock', { nivel: 'sin-stock', sucursal: 'b1' })).toEqual({ q: '', category: 'all', level: 'out', branch: 'b1' });
    expect(decodeFilters('customers', { deudores: '1', estado: 'activos' })).toEqual({ q: '', debtorsOnly: true, blocked: 'active' });
    expect(decodeFilters('dashboard', { periodo: 'mes', sucursal: 'b1' })).toEqual({ period: 'month', branch: 'b1' });
    expect(decodeFilters('credits', { desde: '2026-09-01', hasta: '2026-09-30', pagina: '3' })).toEqual({ from: '2026-09-01', to: '2026-09-30', page: 3 });
    expect(encodeFilters('customers', { q: '', debtorsOnly: true, blocked: 'all' })).toEqual({ deudores: '1' });
  });

  it('las rutas de la impersonación: entrar y tomar un pedido (#23)', () => {
    expect(parseLocation('/plataforma/entrar', '?usuario=u-1&comercio=kiosco')).toEqual({ kind: 'entrar', userId: 'u-1', tenantSlug: 'kiosco' });
    expect(parseLocation('/plataforma/entrar', '')).toEqual({ kind: 'entrar', userId: null, tenantSlug: null });
    expect(parseLocation('/ayuda/help_abc', '')).toEqual({ kind: 'ayuda', requestId: 'help_abc' });
    expect(enterUrl('u-1', 'kiosco')).toBe('/plataforma/entrar?usuario=u-1&comercio=kiosco');
    expect(enterUrl('u-1')).toBe('/plataforma/entrar?usuario=u-1');
    expect(helpRequestUrl('help_abc')).toBe('/ayuda/help_abc');
  });
});
