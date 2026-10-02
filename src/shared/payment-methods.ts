/** Medios de pago del contrato (`Payment.method`). Uno desconocido cuenta como "otro" (4.4.0). */
export const PAYMENT_METHODS = ['cash', 'debit', 'credit', 'transfer', 'qr', 'account'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type MethodKey = PaymentMethod | 'other';

export function isPaymentMethod(method: string): method is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(method);
}

export function methodKey(method: string): MethodKey {
  return isPaymentMethod(method) ? method : 'other';
}
