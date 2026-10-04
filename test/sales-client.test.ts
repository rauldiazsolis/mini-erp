import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatDay, formatMoney, formatQty } from '../src/client/format.ts';
import { countLabel, customerLabel, methodLabel, parseRegisterKey, registerKey, registerLabel } from '../src/client/state/sales-labels.ts';
import {
  buildQuery, endpointFor, openSalesWith, openTicket, presetRange, rangeSignal, rangePresetSignal, registerSignal,
  salesFiltersSignal, salesListSignal, salesTabSignal, ticketSignal, pageSignal, paymentsFiltersSignal, setSalesFilters,
  setTab, closeTicket, type SalesQueryInput,
  openPayment, closePayment, paymentsListSignal, paymentDetailSignal,
  openDaySummary, daySummarySignal,
} from '../src/client/state/sales-state.ts';
import { activeSectionSignal, locationSignal, setHistoryForTests } from '../src/client/state/route-state.ts';
import { userTenantsSignal } from '../src/client/state/auth-state.ts';
import { drillToDebtors, drillToSales, drillToStockProduct, periodRange } from '../src/client/state/dashboard-drill.ts';
import { customerDebtorsOnlySignal } from '../src/client/state/customer-state.ts';
import { stockSearchSignal } from '../src/client/state/stock-state.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

const originalFetch = globalThis.fetch;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const input = (patch: Partial<SalesQueryInput> = {}): SalesQueryInput => ({
  tab: 'sales',
  range: { from: '2026-10-01', to: '2026-10-02' },
  register: {},
  sales: { status: 'all' },
  payments: { status: 'all' },
  movements: {},
  page: 1,
  ...patch,
});

/** Las URLs pedidas al `fetch` falso. */
let requested: string[] = [];

/** Un `fetch` falso que anota cada URL y responde según la primera regla que la contiene. */
function fakeFetch(routes: Array<[string, unknown]> = []): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    requested.push(url);
    const match = routes.find(([fragment]) => url.includes(fragment));
    return Promise.resolve(json(200, match === undefined ? [] : match[1]));
  });
}

const path = (): string => `${locationSignal.value.pathname}${locationSignal.value.search}`;

beforeEach(() => {
  requested = [];
  fakeFetch();
  setHistoryForTests(null);
  freshSession('tok');
  userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'T', status: 'active', role: 'member' }];
  atTenant('t1', 'usuarios');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('formato según el navegador (#20, #51)', () => {
  it('importes, cantidades y días sin correrse por la zona horaria', () => {
    expect(formatMoney(1234.5, 'es-AR')).toContain('1.234,50');
    expect(formatQty(0.333, 'es-AR')).toBe('0,333');
    expect(formatDay('2026-10-01', 'en-US')).toBe('Oct 1, 2026');
  });
});

describe('etiquetas (#20)', () => {
  it('medios, cajas y clientes', () => {
    expect(methodLabel('cash')).toBe('Efectivo');
    expect(methodLabel('debit')).toBe('Tarjeta de Débito');
    expect(methodLabel('qr')).toBe('Código QR');
    expect(methodLabel('crypto')).toBe('Otro');
    expect(registerLabel('CENTRAL', 'Caja 1')).toBe('CENTRAL · Caja 1');
    expect(registerLabel('CENTRAL', null)).toBe('CENTRAL · Sin punto de venta');
    expect(registerLabel('ADMIN', 'Oficina')).toBe('Admin');
    expect(customerLabel(undefined)).toBe('Consumidor final');
    expect(customerLabel({ id: 'c9' })).toBe('Cliente desconocido (c9)');
    expect(customerLabel({ id: 'c1', name: 'Ana' })).toBe('Ana');
    expect(countLabel(1, 'ticket', 'tickets')).toBe('1 ticket');
    expect(countLabel(0, 'ticket', 'tickets')).toBe('0 tickets');
  });

  it('la clave de una caja ida y vuelta, con el vacío como "sin dato"', () => {
    expect(registerKey({})).toBe('');
    expect(parseRegisterKey('')).toEqual({});
    expect(parseRegisterKey(registerKey({ branch: 'CENTRAL', pointOfSale: '' }))).toEqual({ branch: 'CENTRAL', pointOfSale: '' });
    expect(parseRegisterKey(registerKey({ branch: 'CENTRAL' }))).toEqual({ branch: 'CENTRAL' });
  });
});

describe('estado de Ventas & Caja (#20)', () => {
  it('rangos de los atajos', () => {
    expect(presetRange('today', '2026-10-02')).toEqual({ from: '2026-10-02', to: '2026-10-02' });
    expect(presetRange('yesterday', '2026-10-02')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(presetRange('week', '2026-10-02')).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(presetRange('month', '2026-10-02')).toEqual({ from: '2026-09-03', to: '2026-10-02' });
  });

  it('la query deja afuera lo indefinido y conserva el vacío (sin punto de venta)', () => {
    expect(buildQuery({ a: 'x', b: undefined, c: '', d: 2 })).toBe('a=x&c=&d=2');
  });

  it('el endpoint de cada solapa con sus filtros', () => {
    expect(endpointFor(input())).toBe('sales?from=2026-10-01&to=2026-10-02&page=1&pageSize=50');
    expect(endpointFor(input({ register: { branch: 'CENTRAL', pointOfSale: 'Caja 1' }, sales: { status: 'voided', method: 'cash' }, page: 2 })))
      .toBe('sales?from=2026-10-01&to=2026-10-02&branch=CENTRAL&pointOfSale=Caja+1&method=cash&status=voided&page=2&pageSize=50');
    expect(endpointFor(input({ tab: 'payments', payments: { status: 'all', customerId: 'c1' } })))
      .toBe('customer-payments?from=2026-10-01&to=2026-10-02&customerId=c1&page=1&pageSize=50');
    expect(endpointFor(input({ tab: 'movements', movements: { direction: 'out' } })))
      .toBe('cash-movements?from=2026-10-01&to=2026-10-02&direction=out&page=1&pageSize=50');
    expect(endpointFor(input({ tab: 'summary' }))).toBe('cash-summary?from=2026-10-01&to=2026-10-02');
  });

  it('carga la solapa y abre el ticket', async () => {
    const list = { items: [], count: 0, page: 1, pageSize: 50, netTotal: 0 };
    fakeFetch([['/sales/s1', { id: 's1' }], ['/sales?', list]]);
    atTenant('t1', 'ventas?desde=2026-10-01&hasta=2026-10-02');
    await vi.waitFor(() => { expect(salesListSignal.value).toEqual(list); });
    expect(requested).toContain('/api/tenants/t1/sales?from=2026-10-01&to=2026-10-02&page=1&pageSize=50');
    openTicket('s1');
    await vi.waitFor(() => { expect(ticketSignal.value).toEqual({ id: 's1' }); });
    expect(requested).toContain('/api/tenants/t1/sales/s1');
    closeTicket();
    expect(ticketSignal.value).toBeNull();
  });

  it('el drill-down pone los filtros y navega a la sección', () => {
    atTenant('t1', 'ventas?pagina=3');
    openSalesWith({ range: { from: '2026-09-26', to: '2026-10-02' }, branch: 'CENTRAL', status: 'valid', productId: 'p1' });
    expect(activeSectionSignal.value).toBe('sales');
    expect(salesTabSignal.value).toBe('sales');
    expect(rangeSignal.value).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(registerSignal.value).toEqual({ branch: 'CENTRAL' });
    expect(salesFiltersSignal.value).toEqual({ status: 'valid', productId: 'p1' });
    expect(pageSignal.value).toBe(1);
  });
});

describe('cobranzas en el cliente (#20)', () => {
  it('abre una cobranza de la página y navega a su anulación', async () => {
    const base = { day: '2026-10-01', createdAt: '2026-10-01T15:00:00.000Z', branch: 'CENTRAL', pointOfSale: 'Caja 1', customer: { id: 'c1', name: 'Ana' } };
    fakeFetch([['/customer-payments?', {
      items: [
        { ...base, id: 'cp2', payments: [{ method: 'cash', amount: -700 }], total: -700, voided: false, voidsPaymentId: 'cp1' },
        { ...base, id: 'cp1', payments: [{ method: 'cash', amount: 700 }], total: 700, voided: true, voidedBy: 'cp2' },
      ],
      count: 2, page: 1, pageSize: 50, netTotal: 0,
    }]]);
    atTenant('t1', 'ventas/cobranzas');
    await vi.waitFor(() => { expect(paymentsListSignal.value?.items).toHaveLength(2); });
    openPayment('cp1');
    expect(paymentDetailSignal.value?.id).toBe('cp1');
    openPayment(paymentDetailSignal.value?.voidedBy ?? '');
    expect(paymentDetailSignal.value?.id).toBe('cp2');
    openPayment('no-está');
    expect(paymentDetailSignal.value?.id).toBe('cp2');
    closePayment();
    expect(paymentDetailSignal.value).toBeNull();
  });
});

describe('resumen del día en el cliente (#20)', () => {
  it('pide el día de esa caja; sin punto de venta va vacío', async () => {
    fakeFetch([['/cash-summary/day?', { day: '2026-10-01', summary: {}, entries: [] }]]);
    openDaySummary({ day: '2026-10-01', branch: 'CENTRAL', pointOfSale: null });
    await vi.waitFor(() => { expect(daySummarySignal.value?.day).toBe('2026-10-01'); });
    expect(requested).toEqual(['/api/tenants/t1/cash-summary/day?day=2026-10-01&branch=CENTRAL&pointOfSale=']);
  });
});

describe('drill-down del dashboard (#20)', () => {
  it('el período del dashboard es un rango de días argentinos', () => {
    expect(periodRange('today', '2026-10-02')).toEqual({ from: '2026-10-02', to: '2026-10-02' });
    expect(periodRange('week', '2026-10-02')).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(periodRange('month', '2026-10-02')).toEqual({ from: '2026-09-03', to: '2026-10-02' });
  });

  it('un KPI lleva a Ventas con el período, la sucursal y el estado', () => {
    atTenant('t1', 'dashboard?sucursal=CENTRAL');
    drillToSales({ status: 'valid' }, '2026-10-02');
    expect(activeSectionSignal.value).toBe('sales');
    expect(rangeSignal.value).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(registerSignal.value).toEqual({ branch: 'CENTRAL' });
    expect(salesFiltersSignal.value).toEqual({ status: 'valid' });
  });

  it('un punto del gráfico lleva a su día; un producto del ranking, a sus tickets', () => {
    atTenant('t1', 'dashboard');
    drillToSales({ day: '2026-09-28' }, '2026-10-02');
    expect(rangeSignal.value).toEqual({ from: '2026-09-28', to: '2026-09-28' });
    expect(registerSignal.value).toEqual({});
    drillToSales({ productId: 'p1' }, '2026-10-02');
    expect(salesFiltersSignal.value).toEqual({ status: 'all', productId: 'p1' });
  });

  it('deuda lleva a Clientes deudores; una alerta, a Stock con el producto', () => {
    drillToDebtors();
    expect(activeSectionSignal.value).toBe('customers');
    expect(customerDebtorsOnlySignal.value).toBe(true);
    drillToStockProduct('Alfajor');
    expect(activeSectionSignal.value).toBe('stock');
    expect(stockSearchSignal.value).toBe('Alfajor');
  });
});

describe('Ventas con URL y caché (#59)', () => {
  it('rango, caja, filtros y página salen de la URL', () => {
    atTenant('t1', 'ventas/cobranzas?desde=2026-10-01&hasta=2026-10-03&caja=&pagina=2&estado=anuladas');
    expect(salesTabSignal.value).toBe('payments');
    expect(rangePresetSignal.value).toBe('custom');
    expect(rangeSignal.value).toEqual({ from: '2026-10-01', to: '2026-10-03' });
    expect(registerSignal.value).toEqual({ pointOfSale: '' });
    expect(paymentsFiltersSignal.value).toEqual({ status: 'voided' });
    expect(pageSignal.value).toBe(2);
  });

  it('un filtro vuelve a la primera página y reemplaza la entrada', () => {
    atTenant('t1', 'ventas?pagina=3');
    setSalesFilters({ status: 'valid' });
    expect(locationSignal.value.search).toBe('?estado=vigentes');
  });

  it('cambiar de solapa conserva rango y caja y suelta los filtros de la solapa', () => {
    atTenant('t1', 'ventas?rango=semana&sucursal=CENTRAL&estado=anuladas&pagina=2');
    setTab('movements');
    expect(path()).toBe('/admin/t1/ventas/movimientos?rango=semana&sucursal=CENTRAL');
  });

  it('el drill del dashboard abre ventas con sus filtros en la URL', () => {
    atTenant('t1', 'dashboard');
    openSalesWith({ range: { from: '2026-10-01', to: '2026-10-01' }, status: 'voided', productId: 'p1' });
    expect(path()).toBe('/admin/t1/ventas?desde=2026-10-01&hasta=2026-10-01&estado=anuladas&producto=p1');
  });

  it('solo pide la solapa activa', async () => {
    atTenant('t1', 'ventas/resumen');
    await vi.waitFor(() => { expect(requested.some((u) => u.includes('/cash-summary?'))).toBe(true); });
    expect(requested.some((u) => u.includes('/sales?'))).toBe(false);
  });
});
