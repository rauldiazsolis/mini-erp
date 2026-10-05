import type { Request } from 'express';

/**
 * Lo que sigue abierto con el comercio bloqueado, por deuda (#21) o suspendido (#23): Uso y pagos, el
 * estado de cobro y exportar.
 */
export const OPEN_WHEN_BLOCKED = /^\/(credits(\/.*)?|billing-status|export\/[^/]+)\/?$/;

/** El camino dentro del comercio: `/products` en `/api/tenants/kiosco/products`. */
export function tenantPath(req: Request): string {
  return req.originalUrl.split('?')[0]?.replace(/^\/api\/tenants\/[^/]+/, '') ?? '';
}
