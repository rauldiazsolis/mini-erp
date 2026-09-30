import type { Request, Response, NextFunction } from 'express';

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
