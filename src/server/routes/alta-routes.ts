import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.ts';
import type { AltaService } from '../alta/alta-service.ts';
import { passwordSchema } from '../../shared/password.ts';
import { BUSINESS_TYPES } from '../../shared/business-type.ts';
import { normalizeWhatsapp, WHATSAPP_MESSAGE } from '../../shared/whatsapp.ts';
import { sendError } from '../errors.ts';

const businessSchema = z.object({
  businessName: z.string().trim().min(2, 'Escribí el nombre de tu comercio'),
  businessType: z.enum(BUSINESS_TYPES, { errorMap: () => ({ message: 'Elegí el rubro de tu comercio' }) }),
});

const accountSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres'),
  email: z.string().trim().email('Email inválido'),
  password: passwordSchema,
  whatsapp: z.string({ required_error: WHATSAPP_MESSAGE, invalid_type_error: WHATSAPP_MESSAGE }).transform((value, ctx) => {
    const digits = normalizeWhatsapp(value);
    if (digits === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: WHATSAPP_MESSAGE });
      return z.NEVER;
    }
    return digits;
  }),
});

/** POST /api/alta (#19): con sesión crea solo el comercio; sin sesión, cuenta y comercio. */
export function createAltaRoutes(authService: AuthService, altaService: AltaService, limit: RequestHandler): Router {
  const router = Router();

  router.post('/', limit, (req, res) => {
    const header = req.headers.authorization;
    const sessionToken = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const user = sessionToken === undefined ? undefined : authService.validateSession(sessionToken);
    if (sessionToken !== undefined && user === undefined) {
      res.status(401).json({ error: 'Sesión expirada o token inválido' });
      return;
    }

    const business = businessSchema.safeParse(req.body);
    if (!business.success) {
      res.status(400).json({ error: business.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    let account: z.infer<typeof accountSchema> | undefined;
    if (user === undefined) {
      const parsed = accountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
        return;
      }
      account = parsed.data;
    }

    try {
      res.status(201).json(altaService.create({ user, account, ...business.data }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
