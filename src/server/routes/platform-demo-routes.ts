import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePlatformRole } from '../middleware/platform-role-middleware.ts';
import type { DemoResetService } from '../demo/demo-reset-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { auditActor } from '../audit/audit-actor.ts';
import { DEMO_COMMERCES, DEMO_TEMPLATES } from '../seeds/index.ts';
import type { DemoResetResponse } from '../../shared/demo-types.ts';

const resetSchema = z.object({
  template: z.enum(DEMO_TEMPLATES, { error: 'Rubro desconocido' }).optional(),
  kind: z.enum(['full', 'partial'], { error: 'Tipo de reinicio desconocido' }),
});

/** Demos de la plataforma (#24): el estado de los comercios demo y los reinicios, para root y soporte. */
export function createPlatformDemoRoutes(deps: { resets: DemoResetService; audit: AuditLog }): Router {
  const router = Router();
  const staff = requirePlatformRole('root', 'support');

  router.get('/demos', staff, (_req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(deps.resets.status());
  });

  router.post('/demos/reset', staff, (req: AuthenticatedAdminRequest, res: Response) => {
    const body: unknown = req.body;
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Payload inválido' });
      return;
    }
    const { template, kind } = parsed.data;
    const templates = template === undefined ? [...DEMO_TEMPLATES] : [template];
    let revoked = 0;
    for (const t of templates) {
      if (kind === 'full') revoked += deps.resets.resetFull(t).revoked;
      else deps.resets.resetPartial(t);
      deps.audit.record({ ...auditActor(req), tenantId: DEMO_COMMERCES[t].tenantId, action: 'demo.reset', details: { template: t, kind } });
    }
    const response: DemoResetResponse = { reset: templates, revoked };
    res.status(200).json(response);
  });

  return router;
}
