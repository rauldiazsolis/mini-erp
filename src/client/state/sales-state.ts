import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { goTo, inSection, routeFilters, routeTab, setFilters } from './route-state.ts';
import { createTenantParamQuery, createTenantQuery } from './query-keys.ts';
import { decodeFilters, type RangePreset, type SalesRouteFilters, type TabId } from '../routing/admin-routes.ts';
import type { RegisterChoice } from './sales-labels.ts';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import type {
  CashMovementItem, CashSummaryResult, CustomerPaymentItem, DaySummaryResult, DocStatus, ListResult, RegisterItem,
  SaleDetail, SaleKind, SaleListItem,
} from '../../shared/sales-types.ts';

export type SalesTab = TabId<'sales'>;
const SALES_TABS: readonly SalesTab[] = ['sales', 'payments', 'movements', 'summary'];
export type { RangePreset } from '../routing/admin-routes.ts';
export type DayRange = { from: string; to: string };
export type SalesFilters = {
  method?: string | undefined;
  customerId?: string | undefined;
  productId?: string | undefined;
  kind?: SaleKind | undefined;
  status: DocStatus;
};
export type PaymentsFilters = { method?: string | undefined; customerId?: string | undefined; status: DocStatus };
export type MovementsFilters = { direction?: 'in' | 'out' | undefined; source?: 'manual' | 'count-adjustment' | undefined };

export const PAGE_SIZE = 50;

export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): DayRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yesterday = shiftDay(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'week':
      return { from: shiftDay(today, -6), to: today };
    case 'month':
      return { from: shiftDay(today, -29), to: today };
  }
}

// Filtros: en la URL (#59). Rango y caja son compartidos por las cuatro solapas (#20)
export const salesTabSignal = computed<SalesTab>(() => routeTab('sales', SALES_TABS, 'sales'));
const salesRouteFiltersSignal = computed<SalesRouteFilters>(() => routeFilters('sales'));

export const rangePresetSignal = computed<RangePreset>(() => salesRouteFiltersSignal.value.preset);
export const rangeSignal = computed<DayRange>(() => {
  const f = salesRouteFiltersSignal.value;
  if (f.preset === 'custom' && f.from !== undefined && f.to !== undefined) return { from: f.from, to: f.to };
  return presetRange(f.preset === 'custom' ? 'today' : f.preset, argentinaToday(new Date()));
});
export const registerSignal = computed<RegisterChoice>(() => {
  const { branch, pointOfSale } = salesRouteFiltersSignal.value;
  return { ...(branch === undefined ? {} : { branch }), ...(pointOfSale === undefined ? {} : { pointOfSale }) };
});
export const salesFiltersSignal = computed<SalesFilters>(() => {
  const { status, method, customerId, productId, kind } = salesRouteFiltersSignal.value;
  return {
    status,
    ...(method === undefined ? {} : { method }),
    ...(customerId === undefined ? {} : { customerId }),
    ...(productId === undefined ? {} : { productId }),
    ...(kind === undefined ? {} : { kind }),
  };
});
export const paymentsFiltersSignal = computed<PaymentsFilters>(() => {
  const { status, method, customerId } = salesRouteFiltersSignal.value;
  return { status, ...(method === undefined ? {} : { method }), ...(customerId === undefined ? {} : { customerId }) };
});
export const movementsFiltersSignal = computed<MovementsFilters>(() => {
  const { direction, source } = salesRouteFiltersSignal.value;
  return { ...(direction === undefined ? {} : { direction }), ...(source === undefined ? {} : { source }) };
});
export const pageSignal = computed<number>(() => salesRouteFiltersSignal.value.page);

/** Query string sin los `undefined`; el vacío se conserva (filtra "sin punto de venta"). */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return search.toString();
}

export type SalesQueryInput = {
  tab: SalesTab;
  range: DayRange;
  register: RegisterChoice;
  sales: SalesFilters;
  payments: PaymentsFilters;
  movements: MovementsFilters;
  page: number;
};

const statusParam = (status: DocStatus): DocStatus | undefined => (status === 'all' ? undefined : status);

export function endpointFor(input: SalesQueryInput): string {
  const base = { from: input.range.from, to: input.range.to, branch: input.register.branch, pointOfSale: input.register.pointOfSale };
  const paging = { page: input.page, pageSize: PAGE_SIZE };
  switch (input.tab) {
    case 'sales': {
      const { method, customerId, productId, kind, status } = input.sales;
      return `sales?${buildQuery({ ...base, method, customerId, productId, kind, status: statusParam(status), ...paging })}`;
    }
    case 'payments': {
      const { method, customerId, status } = input.payments;
      return `customer-payments?${buildQuery({ ...base, method, customerId, status: statusParam(status), ...paging })}`;
    }
    case 'movements':
      return `cash-movements?${buildQuery({ ...base, ...input.movements, ...paging })}`;
    case 'summary':
      return `cash-summary?${buildQuery(base)}`;
  }
}

const salesInputSignal = computed<SalesQueryInput>(() => ({
  tab: salesTabSignal.value,
  range: rangeSignal.value,
  register: registerSignal.value,
  sales: salesFiltersSignal.value,
  payments: paymentsFiltersSignal.value,
  movements: movementsFiltersSignal.value,
  page: pageSignal.value,
}));

/** Una consulta por solapa: solo se pide la activa, y la clave es su endpoint (con sus filtros). */
function tabQuery<T>(tab: SalesTab) {
  return createTenantParamQuery<T, readonly [SalesTab, string]>({
    domain: 'sales',
    params: () => [tab, endpointFor({ ...salesInputSignal.value, tab })],
    enabled: () => inSection('sales') && salesTabSignal.value === tab,
    fn: ({ tenantId, token, params: [, endpoint] }) => apiFetch<T>(`tenants/${tenantId}/${endpoint}`, { token }),
  });
}

const salesListQuery = tabQuery<ListResult<SaleListItem>>('sales');
const paymentsListQuery = tabQuery<ListResult<CustomerPaymentItem>>('payments');
const movementsListQuery = tabQuery<ListResult<CashMovementItem>>('movements');
const cashSummaryQuery = tabQuery<CashSummaryResult>('summary');

/** Las cajas del filtro (las que vendieron), no las de Configuración: son otro endpoint. */
const registersQuery = createTenantQuery<RegisterItem[]>({
  domain: 'registers',
  enabled: () => inSection('sales'),
  fn: ({ tenantId, token }) => apiFetch<RegisterItem[]>(`tenants/${tenantId}/registers`, { token }),
});

// Drawers: el ticket y el resumen del día se piden mientras están abiertos
const ticketIdSignal = signal<string | null>(null);
const ticketQuery = createTenantParamQuery<SaleDetail, readonly ['ticket', string]>({
  domain: 'sales',
  params: () => (ticketIdSignal.value === null ? null : ['ticket', ticketIdSignal.value]),
  fn: ({ tenantId, token, params: [, saleId] }) => apiFetch<SaleDetail>(`tenants/${tenantId}/sales/${encodeURIComponent(saleId)}`, { token }),
});

type DayRow = { day: string; branch: string | null; pointOfSale: string | null };
const dayRowSignal = signal<DayRow | null>(null);
const daySummaryQuery = createTenantParamQuery<DaySummaryResult, readonly ['day-summary', string, string, string]>({
  domain: 'sales',
  params: () => {
    const row = dayRowSignal.value;
    return row === null ? null : ['day-summary', row.day, row.branch ?? '', row.pointOfSale ?? ''];
  },
  fn: ({ tenantId, token, params: [, day, branch, pointOfSale] }) =>
    apiFetch<DaySummaryResult>(`tenants/${tenantId}/cash-summary/day?${buildQuery({ day, branch, pointOfSale })}`, { token }),
});

const TAB_QUERIES = [salesListQuery, paymentsListQuery, movementsListQuery, cashSummaryQuery];
const ALL_QUERIES = [...TAB_QUERIES, registersQuery, ticketQuery, daySummaryQuery];

// Datos
export const registersSignal = computed<RegisterItem[]>(() => registersQuery.data.value ?? []);
export const salesListSignal = computed<ListResult<SaleListItem> | null>(() => salesListQuery.data.value ?? null);
export const paymentsListSignal = computed<ListResult<CustomerPaymentItem> | null>(() => paymentsListQuery.data.value ?? null);
export const movementsListSignal = computed<ListResult<CashMovementItem> | null>(() => movementsListQuery.data.value ?? null);
export const cashSummarySignal = computed<CashSummaryResult | null>(() => cashSummaryQuery.data.value ?? null);
export const salesLoadingSignal = computed<boolean>(() => TAB_QUERIES.some((q) => q.isLoading.value));
export const salesErrorSignal = computed<string | null>(() => ALL_QUERIES.map((q) => q.error.value?.message).find((m) => m !== undefined) ?? null);

// Drawers: abiertos cuando no son null
export const ticketSignal = computed<SaleDetail | null>(() => ticketQuery.data.value ?? null);
export const paymentDetailSignal = signal<CustomerPaymentItem | null>(null);
export const daySummarySignal = computed<DaySummaryResult | null>(() => daySummaryQuery.data.value ?? null);

export function openTicket(saleId: string): void {
  ticketIdSignal.value = saleId;
}

export function closeTicket(): void {
  ticketIdSignal.value = null;
}

/** El recibo se abre con los datos de la lista; una cobranza fuera de la página no se abre. */
export function openPayment(id: string): void {
  const found = paymentsListSignal.value?.items.find((p) => p.id === id);
  if (found !== undefined) paymentDetailSignal.value = found;
}

export function closePayment(): void {
  paymentDetailSignal.value = null;
}

/** El resumen de una caja y un día; un campo sin dato va vacío (filtra "sin sucursal" o "sin punto de venta"). */
export function openDaySummary(row: DayRow): void {
  dayRowSignal.value = row;
}

export function closeDaySummary(): void {
  dayRowSignal.value = null;
}

/** Rango y caja valen para las cuatro solapas (#20); el resto de los filtros es de cada una. */
export function sharedSalesFilters(f: SalesRouteFilters): SalesRouteFilters {
  return {
    ...decodeFilters('sales', {}),
    preset: f.preset,
    ...(f.from === undefined ? {} : { from: f.from }),
    ...(f.to === undefined ? {} : { to: f.to }),
    ...(f.branch === undefined ? {} : { branch: f.branch }),
    ...(f.pointOfSale === undefined ? {} : { pointOfSale: f.pointOfSale }),
  };
}

export function setTab(tab: SalesTab): void {
  goTo({ section: 'sales', tab, filters: sharedSalesFilters(salesRouteFiltersSignal.peek()) });
}

// Cambiar un filtro vuelve a la primera página
function patchSales(patch: Partial<SalesRouteFilters>): void {
  setFilters('sales', { ...patch, page: 1 });
}

export function applyPreset(preset: Exclude<RangePreset, 'custom'>): void {
  patchSales({ preset, from: undefined, to: undefined });
}

export function setCustomRange(range: DayRange): void {
  patchSales({ preset: 'custom', from: range.from, to: range.to });
}

export function setRegister(choice: RegisterChoice): void {
  patchSales({ branch: choice.branch, pointOfSale: choice.pointOfSale });
}

export function setSalesFilters(patch: Partial<SalesFilters>): void {
  patchSales(patch);
}

export function setPaymentsFilters(patch: Partial<PaymentsFilters>): void {
  patchSales(patch);
}

export function setMovementsFilters(patch: Partial<MovementsFilters>): void {
  patchSales(patch);
}

export function setPage(page: number): void {
  setFilters('sales', { page });
}

/** Drill-down del dashboard (#20): la lista de ventas con esos filtros en la URL, y nada más. */
export type SalesDrill = {
  range: DayRange;
  branch?: string | undefined;
  status?: DocStatus | undefined;
  productId?: string | undefined;
};

export function openSalesWith(drill: SalesDrill): void {
  goTo({
    section: 'sales',
    tab: 'sales',
    filters: {
      ...decodeFilters('sales', {}),
      preset: 'custom',
      from: drill.range.from,
      to: drill.range.to,
      ...(drill.branch === undefined ? {} : { branch: drill.branch }),
      status: drill.status ?? 'all',
      ...(drill.productId === undefined ? {} : { productId: drill.productId }),
    },
  });
}
