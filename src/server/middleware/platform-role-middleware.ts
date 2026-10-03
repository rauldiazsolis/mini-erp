import type { NextFunction, Response } from 'express';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';

export type PlatformRole = 'root' | 'support';

/** Rutas de plataforma (#21): solo los roles globales indicados. Va después de `requireAdmin`. */
export function requirePlatformRole(...roles: PlatformRole[]) {
  return (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.globalRole;
    if (role !== 'root' && role !== 'support') {
      res.status(403).json({ error: 'Solo para la plataforma' });
      return;
    }
    if (!roles.includes(role)) {
      res.status(403).json({ error: 'No tenés permiso para esto' });
      return;
    }
    next();
  };
}
