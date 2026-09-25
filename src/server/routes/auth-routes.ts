import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
});

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Contraseña requerida'),
});

export function createAuthRoutes(
  authService: AuthService,
  requireAdmin: (req: AuthenticatedAdminRequest, res: Response, next: () => void) => void,
): Router {
  const router = Router();

  router.post('/register', (req, res) => {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }

    try {
      const result = authService.register(parseResult.data);
      res.status(201).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar';
      res.status(400).json({ error: msg });
    }
  });

  router.post('/login', (req, res) => {
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
