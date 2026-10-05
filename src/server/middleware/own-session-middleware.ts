import type { NextFunction, Response } from 'express';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';

export const IMPERSONATING_MESSAGE = 'No disponible mientras ves como otro usuario';

/** El 403 de lo que no puede quien impersona (#23). */
export function sendImpersonating(res: Response): void {
  res.status(403).json({ code: 'impersonating', error: IMPERSONATING_MESSAGE });
}

/** Lo que solo hace el usuario con su sesión (#23): contraseña, owners, links, comercios y plataforma. */
export function requireOwnSession(req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void {
  if (req.impersonator !== undefined) {
    sendImpersonating(res);
    return;
  }
  next();
}
