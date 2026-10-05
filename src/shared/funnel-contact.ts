import { z } from './zod.ts';
import { normalizeWhatsapp, WHATSAPP_MESSAGE } from './whatsapp.ts';
import { FUNNEL_CONTACT_SOURCES } from './funnel-types.ts';

export const CONTACT_NAME_MESSAGE = 'Escribí tu nombre (2 a 80 letras)';

/** "¿Querés que te ayudemos a empezar?" (#25): lo valida el servidor y el modal, con los mismos textos. */
export const funnelContactSchema = z.object({
  name: z.string({ error: CONTACT_NAME_MESSAGE }).trim().min(2, CONTACT_NAME_MESSAGE).max(80, CONTACT_NAME_MESSAGE),
  whatsapp: z.string({ error: WHATSAPP_MESSAGE }).transform((value, ctx) => {
    const digits = normalizeWhatsapp(value);
    if (digits === undefined) {
      ctx.addIssue({ code: 'custom', message: WHATSAPP_MESSAGE });
      return z.NEVER;
    }
    return digits;
  }),
  source: z.enum(FUNNEL_CONTACT_SOURCES, { error: 'Origen del contacto desconocido' }),
  demoSessionId: z.string().max(64).optional(),
});

export type FunnelContactInput = z.input<typeof funnelContactSchema>;
