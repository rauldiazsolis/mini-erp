import { Router, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { passwordSchema } from '../../shared/password.ts';
import { sendError } from '../errors.ts';

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Contraseña requerida'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contraseña actual requerida'),
  newPassword: passwordSchema,
});

export function createAuthRoutes(
  authService: AuthService,
  requireAdmin: (req: AuthenticatedAdminRequest, res: Response, next: () => void) => void,
  limit: RequestHandler,
  audit: AuditLog,
): Router {
  const router = Router();

  router.post('/login', limit, (req, res) => {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const result = authService.login(parseResult.data);
      res.status(200).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar sesión';
      res.status(401).json({ error: msg });
    }
  });

  // Cambiar la propia contraseña (#19): cierra las sesiones de los otros equipos
  router.post('/password', requireAdmin, (req: AuthenticatedAdminRequest, res: Response) => {
    if (req.user === undefined) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      const currentToken = (req.headers.authorization ?? '').slice(7).trim();
      authService.changePassword({ userId: req.user.id, currentToken, ...parsed.data });
      audit.record({ actorUserId: req.user.id, tenantId: null, action: 'password.changed', targetUserId: req.user.id });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.get('/me', requireAdmin, (req: AuthenticatedAdminRequest, res: Response) => {
    if (req.user === undefined) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    const tenants = authService.listUserTenants(req.user.id, req.user.globalRole);
    res.status(200).json({
      user: req.user,
      tenants,
    });
  });

  return router;
}
