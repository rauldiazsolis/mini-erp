/** Config de las demos (#9), leída del entorno una vez al arrancar. */
export type DemoConfig = {
  enabled: boolean;
  ttlHours: number;
  maxActive: number;
  /** Hora argentina (0 a 23) del reinicio total automático de los comercios demo (#24). */
  resetHour: number;
  /** URL pública del mini-erp, sin barra final. Ausente = el origen del request. */
  publicUrl?: string;
};

export function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Una hora del día (0 a 23); cualquier otra cosa, `fallback`. */
function hourOfDay(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback;
}

export function readDemoConfig(env: NodeJS.ProcessEnv): DemoConfig {
  const publicUrl = env['PUBLIC_URL']?.trim().replace(/\/+$/, '') ?? '';
  return {
    enabled: env['DEMO_SESSIONS'] !== 'off',
    ttlHours: positiveInt(env['DEMO_TTL_HOURS'], 24),
    maxActive: positiveInt(env['DEMO_MAX_ACTIVE'], 200),
    resetHour: hourOfDay(env['DEMO_RESET_HOUR'], 4),
    ...(publicUrl === '' ? {} : { publicUrl }),
  };
}
