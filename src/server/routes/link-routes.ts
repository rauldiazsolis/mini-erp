import { Router, type RequestHandler } from 'express';
import type { AuthService } from '../auth/auth-service.ts';
import { bearerToken } from '../middleware/auth-middleware.ts';
import { sendImpersonating } from '../middleware/own-session-middleware.ts';
import { z } from '../../shared/zod.ts';
import type { InvitationService } from '../users/invitation-service.ts';
import type { PasswordResetService } from '../users/password-reset-service.ts';
import type { StaffInvitationService } from '../platform/staff-invitation-service.ts';
import { passwordSchema } from '../../shared/password.ts';
import { sendError } from '../errors.ts';

const tokenSchema = z.object({ token: z.string().min(1, 'Falta el token') });
const acceptSchema = tokenSchema.extend({
  password: z.string().min(1, 'Contraseña requerida'),
  name: z.string().optional(),
});

/** Aceptar una invitación no se hace desde una impersonación (#23); sin token, como siempre. */
function rejectImpersonation(auth: AuthService): RequestHandler {
  return (req, res, next) => {
    const token = bearerToken(req);
    const session = token === undefined ? undefined : auth.resolveSession(token);
    if (session !== undefined && session.impersonator !== null) {
      sendImpersonating(res);
      return;
    }
    next();
  };
}

/** Links públicos de invitación (#19): consultar y aceptar, con el límite de pedidos de auth. */
export function createInvitationLinkRoutes(invitations: InvitationService, limit: RequestHandler, auth: AuthService): Router {
  const router = Router();

  router.post('/lookup', limit, (req, res) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Falta el token' });
      return;
    }
    try {
      res.status(200).json(invitations.lookup(parsed.data.token));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/accept', limit, rejectImpersonation(auth), (req, res) => {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      // Cuenta nueva: la contraseña cumple el mínimo; cuenta existente: se verifica tal cual
      if (!invitations.lookup(parsed.data.token).accountExists) {
        const pw = passwordSchema.safeParse(parsed.data.password);
        if (!pw.success) {
          res.status(400).json({ error: pw.error.issues[0]?.message ?? 'Contraseña inválida' });
          return;
        }
      }
      res.status(200).json(invitations.accept(parsed.data));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}

const completeSchema = tokenSchema.extend({ password: passwordSchema });

/** Links públicos de restablecimiento (#19): consultar y fijar la contraseña nueva. */
export function createPasswordResetLinkRoutes(resets: PasswordResetService, limit: RequestHandler): Router {
  const router = Router();

  router.post('/lookup', limit, (req, res) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Falta el token' });
      return;
    }
    try {
      res.status(200).json(resets.lookup(parsed.data.token));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/complete', limit, (req, res) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      res.status(200).json(resets.complete(parsed.data));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}

/** Links públicos de invitación al equipo de soporte (#23): consultar y aceptar. */
export function createStaffInvitationLinkRoutes(invitations: StaffInvitationService, limit: RequestHandler, auth: AuthService): Router {
  const router = Router();

  router.post('/lookup', limit, (req, res) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Falta el token' });
      return;
    }
    try {
      res.status(200).json(invitations.lookup(parsed.data.token));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/accept', limit, rejectImpersonation(auth), (req, res) => {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      // Cuenta nueva: la contraseña cumple el mínimo; cuenta existente: se verifica tal cual
      if (!invitations.lookup(parsed.data.token).accountExists) {
        const pw = passwordSchema.safeParse(parsed.data.password);
        if (!pw.success) {
          res.status(400).json({ error: pw.error.issues[0]?.message ?? 'Contraseña inválida' });
          return;
        }
      }
      res.status(200).json(invitations.accept(parsed.data));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
