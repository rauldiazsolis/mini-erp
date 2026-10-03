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
