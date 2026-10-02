/**
 * Fechas, horas, cantidades e importes con la configuración del navegador (#51): su locale y su
 * preferencia de 12 o 24 horas. La moneda es siempre ARS. `locale` existe para los tests.
 */
export function formatMoney(amount: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'ARS' }).format(amount);
}

export function formatQty(qty: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(qty);
}

/** Un día `AAAA-MM-DD` (el día argentino de mini) se muestra tal cual, sin pasar por la zona horaria. */
export function formatDay(day: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00.000Z`));
}

export function formatDateTime(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

export function formatTime(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso));
}
