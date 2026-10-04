import type { Request, Response, NextFunction } from 'express';
import type { CorsOptions } from 'cors';

/**
 * `cors()` del app real y del de mantenimiento. Contrato 4.6.0 (#63): el POS corre en otro origen y,
 * sin exponer `Retry-After`, el navegador no le deja leerlo en un 429 o un 503.
 */
export const CORS_OPTIONS: CorsOptions = { exposedHeaders: ['Retry-After'] };

/**
 * Preflight de red privada de Chrome: una página pública (el POS en pages.dev) que llama a
 * `localhost` lo manda con `Access-Control-Request-Private-Network: true`. Va antes de `cors()`,
 * que es el que termina el preflight.
 */
export function allowPrivateNetwork(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS' && req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
}
