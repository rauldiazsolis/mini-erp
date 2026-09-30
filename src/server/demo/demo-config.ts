/** Config de las demos (#9), leída del entorno una vez al arrancar. */
export type DemoConfig = {
  enabled: boolean;
  ttlHours: number;
  maxActive: number;
  /** URL pública del mini-erp, sin barra final. Ausente = el origen del request. */
  publicUrl?: string;
};

export function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function readDemoConfig(env: NodeJS.ProcessEnv): DemoConfig {
  const publicUrl = env['PUBLIC_URL']?.trim().replace(/\/+$/, '') ?? '';
  return {
    enabled: env['DEMO_SESSIONS'] !== 'off',
    ttlHours: positiveInt(env['DEMO_TTL_HOURS'], 24),
    maxActive: positiveInt(env['DEMO_MAX_ACTIVE'], 200),
    ...(publicUrl === '' ? {} : { publicUrl }),
  };
}
