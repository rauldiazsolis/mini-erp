import { argentinaToday } from '../../shared/argentina-day.ts';
import type { DocStatus } from '../../shared/sales-types.ts';
import { customerDebtorsOnlySignal, customerSearchSignal } from './customer-state.ts';
import { selectedBranchSignal, selectedPeriodSignal, type DashboardPeriod } from './dashboard-state.ts';
import { navigateTo } from './navigation-state.ts';
import { openSalesWith, presetRange, type DayRange } from './sales-state.ts';
import { stockSearchSignal, stockStatusFilterSignal } from './stock-state.ts';

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
  navigateTo('customers');
}

export function drillToStockProduct(name: string): void {
  stockStatusFilterSignal.value = 'all';
  stockSearchSignal.value = name;
  navigateTo('stock');
}
