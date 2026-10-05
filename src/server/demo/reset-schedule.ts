const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Argentina, UTC−3 fijo (como `src/shared/argentina-day.ts`). */
const AR_OFFSET_MS = -3 * HOUR_MS;

/** Las `hour`:00 argentinas más recientes que no son posteriores a `now` (#24). */
export function lastResetBoundary(now: Date, hour: number): Date {
  const local = new Date(now.getTime() + AR_OFFSET_MS);
  const candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - AR_OFFSET_MS;
  return new Date(candidate <= now.getTime() ? candidate : candidate - DAY_MS);
}
