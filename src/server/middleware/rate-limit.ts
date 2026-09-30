import type { RequestHandler } from 'express';
import { positiveInt } from '../demo/demo-config.ts';

/** Límites por IP (#3), leídos del entorno una vez al arrancar. */
export type RateLimitConfig = { demoPerHour: number; authPer15Min: number };

export function readRateLimitConfig(env: NodeJS.ProcessEnv): RateLimitConfig {
  return {
    demoPerHour: positiveInt(env['DEMO_RATE_LIMIT'], 10),
    authPer15Min: positiveInt(env['AUTH_RATE_LIMIT'], 20),
  };
}

type Window = { count: number; resetAt: number };

/**
 * Ventana fija por IP, en memoria: un reinicio la pone en cero. Pasado el límite responde 429 con
 * `Retry-After`. Las entradas vencidas se descartan al pasar, sin timers.
 */
export function createRateLimit(options: { limit: number; windowMs: number; now: () => Date }): RequestHandler {
  const windows = new Map<string, Window>();
  return (req, res, next) => {
    const now = options.now().getTime();
    for (const [key, window] of windows) {
      if (window.resetAt <= now) {
        windows.delete(key);
      }
    }
    const key = req.ip ?? 'desconocida';
    const current = windows.get(key) ?? { count: 0, resetAt: now + options.windowMs };
    current.count += 1;
    windows.set(key, current);
    if (current.count > options.limit) {
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      res.status(429).json({ code: 'rate-limited', error: 'Demasiados pedidos; probá más tarde' });
      return;
    }
    next();
  };
}
