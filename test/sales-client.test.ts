import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDay, formatMoney, formatQty } from '../src/client/format.ts';
import { countLabel, customerLabel, methodLabel, parseRegisterKey, registerKey, registerLabel } from '../src/client/state/sales-labels.ts';
import {
  buildQuery, endpointFor, loadTab, openSalesWith, openTicket, presetRange, rangeSignal, registerSignal,
  salesFiltersSignal, salesListSignal, salesTabSignal, ticketSignal, pageSignal, type SalesQueryInput,
  openPayment, closePayment, paymentsListSignal, paymentDetailSignal,
  openDaySummary, daySummarySignal,
} from '../src/client/state/sales-state.ts';
import { activeSectionSignal } from '../src/client/state/route-state.ts';
import { tokenSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';
import { drillToDebtors, drillToSales, drillToStockProduct, periodRange } from '../src/client/state/dashboard-drill.ts';
import { selectedBranchSignal, selectedPeriodSignal } from '../src/client/state/dashboard-state.ts';
import { customerDebtorsOnlySignal } from '../src/client/state/customer-state.ts';
import { stockSearchSignal } from '../src/client/state/stock-state.ts';
import { atTenant } from './helpers/client-route.ts';

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

beforeEach(() => {
  globalThis.fetch = originalFetch;
  tokenSignal.value = 'tok';
  userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'T', status: 'active', role: 'member' }];
  atTenant('t1');
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
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, list)).mockResolvedValueOnce(json(200, { id: 's1' }));
    globalThis.fetch = fetchMock;
    await loadTab(input());
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/tenants/t1/sales?from=2026-10-01&to=2026-10-02&page=1&pageSize=50');
    expect(salesListSignal.value).toEqual(list);
    await openTicket('s1');
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('/api/tenants/t1/sales/s1');
    expect(ticketSignal.value).toEqual({ id: 's1' });
  });

  it('el drill-down pone los filtros y navega a la sección', () => {
    pageSignal.value = 3;
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
  it('abre una cobranza de la página y navega a su anulación', () => {
    const base = { day: '2026-10-01', createdAt: '2026-10-01T15:00:00.000Z', branch: 'CENTRAL', pointOfSale: 'Caja 1', customer: { id: 'c1', name: 'Ana' } };
    paymentsListSignal.value = {
      items: [
        { ...base, id: 'cp2', payments: [{ method: 'cash', amount: -700 }], total: -700, voided: false, voidsPaymentId: 'cp1' },
        { ...base, id: 'cp1', payments: [{ method: 'cash', amount: 700 }], total: 700, voided: true, voidedBy: 'cp2' },
      ],
      count: 2, page: 1, pageSize: 50, netTotal: 0,
    };
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
    const fetchMock = vi.fn().mockResolvedValue(json(200, { day: '2026-10-01', summary: {}, entries: [] }));
    globalThis.fetch = fetchMock;
    await openDaySummary({ day: '2026-10-01', branch: 'CENTRAL', pointOfSale: null });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/tenants/t1/cash-summary/day?day=2026-10-01&branch=CENTRAL&pointOfSale=');
    expect(daySummarySignal.value?.day).toBe('2026-10-01');
  });
});

describe('drill-down del dashboard (#20)', () => {
  it('el período del dashboard es un rango de días argentinos', () => {
    expect(periodRange('today', '2026-10-02')).toEqual({ from: '2026-10-02', to: '2026-10-02' });
    expect(periodRange('week', '2026-10-02')).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(periodRange('month', '2026-10-02')).toEqual({ from: '2026-09-03', to: '2026-10-02' });
  });

  it('un KPI lleva a Ventas con el período, la sucursal y el estado', () => {
    selectedPeriodSignal.value = 'week';
    selectedBranchSignal.value = 'CENTRAL';
    drillToSales({ status: 'valid' }, '2026-10-02');
    expect(activeSectionSignal.value).toBe('sales');
    expect(rangeSignal.value).toEqual({ from: '2026-09-26', to: '2026-10-02' });
    expect(registerSignal.value).toEqual({ branch: 'CENTRAL' });
    expect(salesFiltersSignal.value).toEqual({ status: 'valid' });
  });

  it('un punto del gráfico lleva a su día; un producto del ranking, a sus tickets', () => {
    selectedBranchSignal.value = '';
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
