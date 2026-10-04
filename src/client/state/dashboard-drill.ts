import { argentinaToday } from '../../shared/argentina-day.ts';
import type { DocStatus } from '../../shared/sales-types.ts';
import { customerDebtorsOnlySignal, customerSearchSignal } from './customer-state.ts';
import { selectedBranchSignal, selectedPeriodSignal, type DashboardPeriod } from './dashboard-state.ts';
import { goTo } from './route-state.ts';
import { openSalesWith, presetRange, type DayRange } from './sales-state.ts';
import { decodeFilters } from '../routing/admin-routes.ts';

/** Drill-down del dashboard (#20): cada KPI, gráfico y ranking lleva a la consulta que lo explica. */
export function periodRange(period: DashboardPeriod, today: string): DayRange {
  return presetRange(period, today);
}

export function drillToSales(
  options: { status?: DocStatus | undefined; productId?: string | undefined; day?: string | undefined },
  today: string = argentinaToday(new Date()),
): void {
  const branch = selectedBranchSignal.value;
  openSalesWith({
    range: options.day === undefined ? periodRange(selectedPeriodSignal.value, today) : { from: options.day, to: options.day },
    ...(branch === '' ? {} : { branch }),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.productId === undefined ? {} : { productId: options.productId }),
  });
}

export function drillToDebtors(): void {
  customerSearchSignal.value = '';
  customerDebtorsOnlySignal.value = true;
  goTo({ section: 'customers' });
}

export function drillToStockProduct(name: string): void {
  goTo({ section: 'stock', filters: { ...decodeFilters('stock', {}), q: name } });
}
