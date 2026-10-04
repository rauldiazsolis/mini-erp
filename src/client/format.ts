/**
 * Fechas, horas, cantidades e importes con la configuración del navegador (#51): su locale y su
 * preferencia de 12 o 24 horas. La moneda es siempre ARS. `locale` existe para los tests.
 */
export function formatMoney(amount: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'ARS' }).format(amount);
}

/** Los agregados del dashboard (KPIs, gráfico, top de productos), en pesos enteros. */
export function formatMoneyRounded(amount: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(amount);
}

export function formatQty(qty: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(qty);
}

/** Un día `AAAA-MM-DD` (el día argentino de mini) se muestra tal cual, sin pasar por la zona horaria. */
export function formatDay(day: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00.000Z`));
}

/** Solo la fecha de un instante (ISO), en la zona del navegador. */
export function formatDate(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function formatTime(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso));
}
