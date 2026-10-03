/** Tipos de Créditos y de la plataforma de cobro (#21), compartidos por servidor y cliente. */

export type BillingState = 'ok' | 'low' | 'debt' | 'restricted';

export type BillingSummary = {
  /** Sin titular (una demo) no se cobra nada. */
  billable: boolean;
  state: BillingState;
  holder: { userId: string; name: string; email: string } | null;
  paidBalance: number;
  giftBalance: number;
  nextGiftExpiry: string | null;
  debt: number;
  /** Último día (AAAA-MM-DD, argentino) para pagar sin que mini se restrinja; solo con deuda. */
  deadline: string | null;
  daysCovered: number | null;
  dailyBurn: number;
};

/** Un cargo de una caja (o de un equipo ajeno, con su `deviceId`) en un día. */
export type ChargeItem = {
  id: string;
  day: string;
  registerId: string;
  registerName: string;
  deviceId: string | null;
  amount: number;
  paidAmount: number;
  giftAmount: number;
  debtAmount: number;
  createdAt: string;
};

export type ChargesPage = { items: ChargeItem[]; count: number; page: number; pageSize: number; total: number };

/** Un movimiento de la cuenta del comercio: pagos, devoluciones, deuda cancelada y créditos regalados. */
export type CreditMovementItem = {
  id: string;
  kind: 'payment' | 'refund' | 'debt-settlement' | 'gift-granted' | 'gift-voided';
  day: string;
  amount: number;
  info: string | null;
  byName: string | null;
  createdAt: string;
};

export type GiftItem = {
  id: string;
  origin: 'signup' | 'grant';
  amount: number;
  remaining: number;
  expiresAt: string;
  status: 'active' | 'expired' | 'voided' | 'used';
  grantedByName: string | null;
  reason: string | null;
  createdAt: string;
};

/** "Cómo pagar": lo configura root. */
export type PaymentInfo = { alias: string; cbu: string; holder: string; supportWhatsapp: string };

export type CreditsResponse = BillingSummary & { paymentInfo: PaymentInfo };

/** Lo mínimo para la franja y la restricción; lo ven los tres roles. */
export type BillingStatus = { state: BillingState; debt: number; deadline: string | null };

/** Un pago registrado por la plataforma, a mano o con la planilla. */
export type PlatformPaymentItem = {
  id: string;
  day: string;
  amount: number;
  info: string | null;
  tenantId: string | null;
  tenantName: string | null;
  holderName: string;
  createdByName: string | null;
  createdAt: string;
  fromSheet: boolean;
};

/** El resultado de una fila de la planilla de cobranzas. */
export type SheetResultRow = {
  line: number;
  status: 'ok' | 'duplicate' | 'error';
  message?: string;
  tenantId?: string;
  tenantName?: string;
  day?: string;
  amount?: number;
  info?: string;
};

/** Configuración de cobro, solo para root. */
export type BillingSettings = {
  pricePerRegisterDay: number;
  signupBonus: number;
  signupBonusDays: number;
  /** Proporción del cargo que sale del saldo pagado (0 a 1) mientras hay saldo pagado. */
  paidShare: number;
  graceDays: number;
  lowBalanceDays: number;
  paymentAlias: string;
  paymentCbu: string;
  paymentHolder: string;
  supportWhatsapp: string;
};
