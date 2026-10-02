import type { MethodKey } from './payment-methods.ts';

/** Tipos de la API de Ventas & Caja (#20): los arma el servidor y los lee el cliente. */

export type SaleKind = 'sale' | 'return' | 'void';
export type DocStatus = 'all' | 'valid' | 'voided';
export type Numbered = { date: string; number: number };
export type CustomerRef = { id: string; name?: string };
export type PaymentLine = { method: string; amount: number; reference?: string };

export type SaleListItem = {
  id: string;
  day: string;
  createdAt: string;
  ticket?: Numbered;
  branch: string | null;
  pointOfSale: string | null;
  customer?: CustomerRef;
  methods: string[];
  total: number;
  kind: SaleKind;
  voided: boolean;
  voidedBy?: string;
  voidsSaleId?: string;
};

export type SaleDetailLine = {
  kind: 'product' | 'freeform';
  productId?: string;
  name: string;
  qty: number;
  unitPrice: number;
  discount?: { type: 'amount' | 'percentage'; value: number };
  total: number;
};

export type SaleDetail = SaleListItem & {
  lines: SaleDetailLine[];
  subtotal: number;
  globalAdjustment: number;
  payments: PaymentLine[];
  voidReason?: string;
};

export type CustomerPaymentItem = {
  id: string;
  day: string;
  createdAt: string;
  receipt?: Numbered;
  branch: string | null;
  pointOfSale: string | null;
  customer: CustomerRef;
  payments: PaymentLine[];
  total: number;
  voided: boolean;
  voidedBy?: string;
  voidsPaymentId?: string;
};

export type CashMovementItem = {
  id: string;
  day: string;
  createdAt: string;
  branch: string | null;
  pointOfSale: string | null;
  direction: 'in' | 'out' | null;
  amount: number;
  concept: string;
  description?: string;
  source: string | null;
  count?: { expected: number; counted: number };
};

export type ListResult<T> = { items: T[]; count: number; page: number; pageSize: number; netTotal: number };

export type RegisterItem = { branch: string | null; pointOfSale: string | null };

/** El resumen del día, con la forma de `DaySummary` del POS más `other` en los medios. */
export type DaySummary = {
  totalSold: number;
  ticketCount: number;
  voidedCount: number;
  adjustmentTotal: number;
  totalsByMethod: Record<MethodKey, number>;
  otherPayments: number;
  cash: { sales: number; income: number; expense: number; countAdjustments: number; collections: number };
  collections: { total: number; count: number; voidedCount: number };
  collectionsByMethod: Record<MethodKey, number>;
};

export type CashSummaryTotals = {
  totalSold: number;
  ticketCount: number;
  voidedCount: number;
  collectionsTotal: number;
  cashIncome: number;
  cashExpense: number;
  cashCountAdjustments: number;
  cashNet: number;
};

export type CashSummaryRow = CashSummaryTotals & { day: string; branch: string | null; pointOfSale: string | null };

export type CashSummaryResult = { rows: CashSummaryRow[]; totals: CashSummaryTotals };

export type DayEntry =
  | { kind: 'sale'; at: string; sale: SaleListItem }
  | { kind: 'movement'; at: string; movement: CashMovementItem }
  | { kind: 'collection'; at: string; payment: CustomerPaymentItem };

export type DaySummaryResult = { day: string; summary: DaySummary; entries: DayEntry[] };
