import { signal, computed, effect } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { activeSectionSignal, goTo, routeTab } from './route-state.ts';
import type { TabId } from '../routing/admin-routes.ts';
import { customersSignal, fetchCustomers } from './customer-state.ts';
import type { RegisterChoice } from './sales-labels.ts';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import type {
  CashMovementItem, CashSummaryResult, CustomerPaymentItem, DaySummaryResult, DocStatus, ListResult, RegisterItem,
  SaleDetail, SaleKind, SaleListItem,
} from '../../shared/sales-types.ts';

export type SalesTab = TabId<'sales'>;
const SALES_TABS: readonly SalesTab[] = ['sales', 'payments', 'movements', 'summary'];
export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
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

// Filtros: rango y caja son compartidos por las cuatro solapas (#20)
export const salesTabSignal = computed<SalesTab>(() => routeTab('sales', SALES_TABS, 'sales'));
export const rangePresetSignal = signal<RangePreset>('today');
export const rangeSignal = signal<DayRange>(presetRange('today', argentinaToday(new Date())));
export const registerSignal = signal<RegisterChoice>({});
export const salesFiltersSignal = signal<SalesFilters>({ status: 'all' });
export const paymentsFiltersSignal = signal<PaymentsFilters>({ status: 'all' });
export const movementsFiltersSignal = signal<MovementsFilters>({});
export const pageSignal = signal<number>(1);

// Datos
export const registersSignal = signal<RegisterItem[]>([]);
export const salesListSignal = signal<ListResult<SaleListItem> | null>(null);
export const paymentsListSignal = signal<ListResult<CustomerPaymentItem> | null>(null);
export const movementsListSignal = signal<ListResult<CashMovementItem> | null>(null);
export const cashSummarySignal = signal<CashSummaryResult | null>(null);
export const salesLoadingSignal = signal<boolean>(false);
export const salesErrorSignal = signal<string | null>(null);

// Drawers: abiertos cuando no son null
export const ticketSignal = signal<SaleDetail | null>(null);
export const paymentDetailSignal = signal<CustomerPaymentItem | null>(null);
export const daySummarySignal = signal<DaySummaryResult | null>(null);

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

function session(): { tenantId: string; token: string } | null {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  return tenantId && token ? { tenantId, token } : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'No se pudieron cargar los datos';
}

export async function loadTab(input: SalesQueryInput): Promise<void> {
  const s = session();
  if (s === null) return;
  const path = `tenants/${s.tenantId}/${endpointFor(input)}`;
  salesLoadingSignal.value = true;
  salesErrorSignal.value = null;
  try {
    switch (input.tab) {
      case 'sales':
        salesListSignal.value = await apiFetch<ListResult<SaleListItem>>(path, { token: s.token });
        break;
      case 'payments':
        paymentsListSignal.value = await apiFetch<ListResult<CustomerPaymentItem>>(path, { token: s.token });
        break;
      case 'movements':
        movementsListSignal.value = await apiFetch<ListResult<CashMovementItem>>(path, { token: s.token });
        break;
      case 'summary':
        cashSummarySignal.value = await apiFetch<CashSummaryResult>(path, { token: s.token });
        break;
    }
  } catch (err: unknown) {
    salesErrorSignal.value = errorMessage(err);
  } finally {
    salesLoadingSignal.value = false;
  }
}

export async function fetchRegisters(): Promise<void> {
  const s = session();
  if (s === null) return;
  try {
    registersSignal.value = await apiFetch<RegisterItem[]>(`tenants/${s.tenantId}/registers`, { token: s.token });
  } catch (err: unknown) {
    salesErrorSignal.value = errorMessage(err);
  }
}

export async function openTicket(saleId: string): Promise<void> {
  const s = session();
  if (s === null) return;
  try {
    ticketSignal.value = await apiFetch<SaleDetail>(`tenants/${s.tenantId}/sales/${encodeURIComponent(saleId)}`, { token: s.token });
  } catch (err: unknown) {
    salesErrorSignal.value = errorMessage(err);
  }
}

export function closeTicket(): void {
  ticketSignal.value = null;
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
export async function openDaySummary(row: { day: string; branch: string | null; pointOfSale: string | null }): Promise<void> {
  const s = session();
  if (s === null) return;
  const query = buildQuery({ day: row.day, branch: row.branch ?? '', pointOfSale: row.pointOfSale ?? '' });
  try {
    daySummarySignal.value = await apiFetch<DaySummaryResult>(`tenants/${s.tenantId}/cash-summary/day?${query}`, { token: s.token });
  } catch (err: unknown) {
    salesErrorSignal.value = errorMessage(err);
  }
}

export function closeDaySummary(): void {
  daySummarySignal.value = null;
}

// Cambiar un filtro vuelve a la primera página
export function setTab(tab: SalesTab): void {
  goTo({ section: 'sales', tab });
  pageSignal.value = 1;
}

export function applyPreset(preset: Exclude<RangePreset, 'custom'>): void {
  rangePresetSignal.value = preset;
  rangeSignal.value = presetRange(preset, argentinaToday(new Date()));
  pageSignal.value = 1;
}

export function setCustomRange(range: DayRange): void {
  rangePresetSignal.value = 'custom';
  rangeSignal.value = range;
  pageSignal.value = 1;
}

export function setRegister(choice: RegisterChoice): void {
  registerSignal.value = choice;
  pageSignal.value = 1;
}

export function setSalesFilters(patch: Partial<SalesFilters>): void {
  salesFiltersSignal.value = { ...salesFiltersSignal.value, ...patch };
  pageSignal.value = 1;
}

export function setPaymentsFilters(patch: Partial<PaymentsFilters>): void {
  paymentsFiltersSignal.value = { ...paymentsFiltersSignal.value, ...patch };
  pageSignal.value = 1;
}

export function setMovementsFilters(patch: Partial<MovementsFilters>): void {
  movementsFiltersSignal.value = { ...movementsFiltersSignal.value, ...patch };
  pageSignal.value = 1;
}

export function setPage(page: number): void {
  pageSignal.value = page;
}

/** Drill-down del dashboard (#20): la lista de ventas con esos filtros, y nada más. */
export type SalesDrill = {
  range: DayRange;
  branch?: string | undefined;
  status?: DocStatus | undefined;
  productId?: string | undefined;
};

export function openSalesWith(drill: SalesDrill): void {
  rangePresetSignal.value = 'custom';
  rangeSignal.value = drill.range;
  registerSignal.value = drill.branch === undefined ? {} : { branch: drill.branch };
  salesFiltersSignal.value = {
    status: drill.status ?? 'all',
    ...(drill.productId === undefined ? {} : { productId: drill.productId }),
  };
  pageSignal.value = 1;
  goTo({ section: 'sales' });
}

/**
 * Reactividad sin hooks, como el dashboard: las cajas y los clientes se piden al entrar a la sección;
 * la solapa activa, cada vez que cambia ella o un filtro.
 */
export function registerSalesEffects(): () => void {
  const disposeRegisters = effect(() => {
    if (activeSectionSignal.value === 'sales' && session() !== null) {
      void fetchRegisters();
      if (customersSignal.peek().length === 0) void fetchCustomers();
    }
  });
  const disposeTab = effect(() => {
    const input: SalesQueryInput = {
      tab: salesTabSignal.value,
      range: rangeSignal.value,
      register: registerSignal.value,
      sales: salesFiltersSignal.value,
      payments: paymentsFiltersSignal.value,
      movements: movementsFiltersSignal.value,
      page: pageSignal.value,
    };
    if (activeSectionSignal.value === 'sales' && session() !== null) {
      void loadTab(input);
    }
  });
  return () => {
    disposeRegisters();
    disposeTab();
  };
}

if (typeof window !== 'undefined') {
  registerSalesEffects();
}
