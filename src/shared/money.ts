import { z } from './zod.ts';

/** El mayor importe que entra en `numeric(14,2)`. */
export const MAX_MONEY_AMOUNT = 999_999_999_999.99;

/**
 * Si el número se escribe con a lo sumo 2 decimales. Se mira su representación más corta (la de
 * `String`), no `n * 100`, que en coma flotante no da exacto (`10.15 * 100` es `1014.999…`).
 */
export function hasAtMostTwoDecimals(n: number): boolean {
  return /^\d+(\.\d{1,2})?$/.test(String(n));
}

/**
 * Un importe de dinero de sistema que entra de afuera (pago, bono, devolución, planilla de
 * cobranzas): positivo y con a lo sumo 2 decimales. Nunca se redondea en silencio: lo que se guarda
 * en `numeric(14,2)` es lo que se validó (spec de PostgreSQL, punto 2).
 */
export const moneyAmount = z
  .number({ error: (iss) => (iss.input === undefined ? undefined : 'Importe inválido') })
  .positive('El importe tiene que ser mayor que 0')
  .max(MAX_MONEY_AMOUNT, 'Importe inválido')
  .refine(hasAtMostTwoDecimals, 'Importe inválido');

/**
 * Si un importe de comercio que carga el admin (precio, límite de crédito, margen, cobranza, ajuste)
 * entra tal cual en `numeric(14,2)`: a lo sumo 2 decimales y dentro del tope, con cualquier signo.
 * Cada esquema decide aparte si admite cero o negativos.
 */
export function fitsMoneyColumn(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) <= MAX_MONEY_AMOUNT && hasAtMostTwoDecimals(Math.abs(n));
}
