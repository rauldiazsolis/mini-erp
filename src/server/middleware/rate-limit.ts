import type { RequestHandler } from 'express';
import { positiveInt } from '../demo/demo-config.ts';

/** Límites por IP (#3), leídos del entorno una vez al arrancar; los del embudo (#25), contactos y beacons. */
export type RateLimitConfig = { demoPerHour: number; authPer15Min: number; contactPerHour: number; beaconPerHour: number };

export function readRateLimitConfig(env: NodeJS.ProcessEnv): RateLimitConfig {
  return {
    demoPerHour: positiveInt(env['DEMO_RATE_LIMIT'], 10),
    authPer15Min: positiveInt(env['AUTH_RATE_LIMIT'], 20),
    contactPerHour: positiveInt(env['CONTACT_RATE_LIMIT'], 5),
    beaconPerHour: positiveInt(env['BEACON_RATE_LIMIT'], 60),
  };
}

type Window = { count: number; resetAt: number };

const RATE_LIMITED_MESSAGE = 'Demasiados pedidos; probá más tarde';

/**
 * Ventana fija por IP, en memoria: un reinicio la pone en cero. Pasado el límite responde 429 con
 * `Retry-After`. Las entradas vencidas se descartan al pasar, sin timers. El texto va donde lo lee
 * cada cliente: `message` en el Connector API (`ErrorBody` del contrato 4.6.0, #63) y `error` en
 * `/api`, como el resto de sus errores.
 */
export function createRateLimit(options: {
  limit: number;
  windowMs: number;
  now: () => Date;
  body: 'connector' | 'api';
  /** Pasado el límite, 204 sin seguir: los beacons nunca molestan al landing (#25). */
  silent?: boolean | undefined;
}): RequestHandler {
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
      if (options.silent === true) {
        res.status(204).end();
        return;
      }
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      res
        .status(429)
        .json(
          options.body === 'connector'
            ? { code: 'rate-limited', message: RATE_LIMITED_MESSAGE }
            : { code: 'rate-limited', error: RATE_LIMITED_MESSAGE },
        );
      return;
    }
    next();
  };
}
