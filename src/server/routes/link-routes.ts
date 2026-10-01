import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { InvitationService } from '../users/invitation-service.ts';
import { passwordSchema } from '../../shared/password.ts';
import { sendError } from '../errors.ts';

const tokenSchema = z.object({ token: z.string().min(1, 'Falta el token') });
const acceptSchema = tokenSchema.extend({
  password: z.string().min(1, 'Contraseña requerida'),
  name: z.string().optional(),
});

/** Links públicos de invitación (#19): consultar y aceptar, con el límite de pedidos de auth. */
export function createInvitationLinkRoutes(invitations: InvitationService, limit: RequestHandler): Router {
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

  router.post('/accept', limit, (req, res) => {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      // Cuenta nueva: la contraseña cumple el mínimo; cuenta existente: se verifica tal cual
      if (!invitations.lookup(parsed.data.token).accountExists) {
        const pw = passwordSchema.safeParse(parsed.data.password);
        if (!pw.success) {
          res.status(400).json({ error: pw.error.errors[0]?.message ?? 'Contraseña inválida' });
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
