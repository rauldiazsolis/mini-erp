/**
 * El día de un comercio es el día argentino (#20): UTC−3 fijo (Argentina no tiene horario de
 * verano). Lo usan el push, las consultas de Ventas & Caja, el dashboard y el cliente. En SQL, el
 * equivalente es `date(x, '-3 hours')`; un test verifica que los dos dan lo mismo.
 */
const OFFSET_MS = 3 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function argentinaDay(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms - OFFSET_MS).toISOString().slice(0, 10);
}

export function argentinaHour(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms - OFFSET_MS).getUTCHours();
}

export function argentinaToday(now: Date): string {
  return new Date(now.getTime() - OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * ONE_DAY_MS).toISOString().slice(0, 10);
}

/** Días de `from` a `to` (0 si son el mismo). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / ONE_DAY_MS);
}

/**
 * El día de un documento, como lo agrupa el `/RESUMEN` del POS: su fecha numerada (`ticket.date`,
 * `receipt.date`) si es válida; si no, el día argentino del primer instante válido.
 */
export function pickDay(numbered: unknown, instants: ReadonlyArray<string | null | undefined>): string | null {
  if (typeof numbered === 'string' && DAY_PATTERN.test(numbered)) {
    return numbered;
  }
  for (const iso of instants) {
    const day = iso === undefined || iso === null ? null : argentinaDay(iso);
    if (day !== null) {
      return day;
    }
  }
  return null;
}
