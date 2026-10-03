import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePlatformRole } from '../middleware/platform-role-middleware.ts';
import type { BillingService } from '../billing/billing-service.ts';
import { billingSettingsPatchSchema } from '../billing/settings.ts';
import type { AuditAction, AuditLog } from '../audit/audit-log.ts';
import { DomainError, sendError } from '../errors.ts';
import { parsePaymentSheet } from '../billing/payment-sheet.ts';
import type { SheetResultRow } from '../../shared/credits-types.ts';
import { DAY_PATTERN } from '../../shared/argentina-day.ts';

const day = z.string().regex(DAY_PATTERN, 'Fecha inválida');
const amount = z.number({ invalid_type_error: 'Importe inválido' }).positive('El importe tiene que ser mayor que 0');
const note = z.string().trim().max(200).optional();

const paymentSchema = z.object({ day, amount, info: note });
const grantSchema = z.object({ amount, expiresOn: day, reason: note });
const voidSchema = z.object({ reason: z.string().trim().min(1, 'Falta el motivo').max(200) });
const graceSchema = z.object({ until: day });
const refundSchema = z.object({ amount, info: note });
const holderSchema = z.object({ userId: z.string().min(1, 'Falta el usuario') });
const sheetSchema = z.object({ csv: z.string().min(1, 'La planilla está vacía').max(1_000_000, 'La planilla es demasiado grande') });

type Deps = { billing: BillingService; audit: AuditLog };

/**
 * Plataforma de cobro (#21), para root y soporte: pagos, créditos regalados, gracia, titular,
 * devoluciones y configuración (estas dos, solo root). Todo queda en la auditoría. Va con `requireAdmin`.
 */
export function createPlatformRoutes(deps: Deps): Router {
  const router = Router();
  const staff = requirePlatformRole('root', 'support');
  const rootOnly = requirePlatformRole('root');

  /** Valida el body, corre la operación y la audita; los errores de negocio salen con su estado. */
  function handle<T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    action: AuditAction,
    status: number,
    run: (body: T, req: AuthenticatedAdminRequest) => { result: Record<string, unknown>; details: Record<string, unknown>; targetUserId?: string },
  ) {
    return (req: AuthenticatedAdminRequest, res: Response): void => {
      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
        return;
      }
      try {
        const { result, details, targetUserId } = run(parsed.data, req);
        deps.audit.record({
          actorUserId: req.user?.id ?? '',
          tenantId: req.params['tenantId'] ?? null,
          action,
          ...(targetUserId === undefined ? {} : { targetUserId }),
          details,
        });
        res.status(status).json(result);
      } catch (err: unknown) {
        sendError(res, err, 500);
      }
    };
  }

  const tenantOf = (req: Request): string => req.params['tenantId'] ?? '';
  const actorOf = (req: AuthenticatedAdminRequest): string => req.user?.id ?? '';

  router.post(
    '/tenants/:tenantId/payments',
    staff,
    handle(paymentSchema, 'billing.payment_registered', 201, (body, req) => {
      const res = deps.billing.registerPayment({ tenantId: tenantOf(req), day: body.day, amount: body.amount, info: body.info, actorUserId: actorOf(req) });
      return { result: res, details: { amount: body.amount, day: body.day, ...(body.info === undefined ? {} : { info: body.info }), settled: res.settled } };
    }),
  );

  router.post(
    '/tenants/:tenantId/gift-credits',
    staff,
    handle(grantSchema, 'billing.credits_granted', 201, (body, req) => {
      const id = deps.billing.grantCredits({ tenantId: tenantOf(req), amount: body.amount, expiresOn: body.expiresOn, reason: body.reason, actorUserId: actorOf(req) });
      return { result: { id }, details: { creditId: id, amount: body.amount, expiresOn: body.expiresOn, ...(body.reason === undefined ? {} : { reason: body.reason }) } };
    }),
  );

  router.delete(
    '/tenants/:tenantId/gift-credits/:creditId',
    staff,
    handle(voidSchema, 'billing.credit_voided', 200, (body, req) => {
      const creditId = req.params['creditId'] ?? '';
      deps.billing.voidCredit({ tenantId: tenantOf(req), creditId, reason: body.reason, actorUserId: actorOf(req) });
      return { result: { success: true }, details: { creditId, reason: body.reason } };
    }),
  );

  router.post(
    '/tenants/:tenantId/grace',
    staff,
    handle(graceSchema, 'billing.grace_extended', 200, (body, req) => {
      deps.billing.setGrace({ tenantId: tenantOf(req), until: body.until });
      return { result: { success: true }, details: { until: body.until } };
    }),
  );

  router.post(
    '/tenants/:tenantId/refunds',
    rootOnly,
    handle(refundSchema, 'billing.refund', 201, (body, req) => {
      const id = deps.billing.refund({ tenantId: tenantOf(req), amount: body.amount, info: body.info, actorUserId: actorOf(req) });
      return { result: { id }, details: { amount: body.amount, ...(body.info === undefined ? {} : { info: body.info }) } };
    }),
  );

  router.put(
    '/tenants/:tenantId/holder',
    staff,
    handle(holderSchema, 'billing.holder_changed', 200, (body, req) => {
      deps.billing.setHolder({ tenantId: tenantOf(req), userId: body.userId });
      return { result: { success: true }, details: {}, targetUserId: body.userId };
    }),
  );

  // La planilla de cobranzas: `?dryRun=1` muestra qué pasaría con cada fila sin registrar nada
  router.post('/payments/import', staff, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = sheetSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    const dryRun = req.query['dryRun'] === '1';
    const seen = new Set<string>();
    const rows = parsePaymentSheet(parsed.data.csv).map((row): SheetResultRow => {
      const base = { line: row.line, ...(row.info === '' ? {} : { info: row.info }) };
      if (row.error !== undefined || row.slug === undefined || row.day === undefined || row.amount === undefined || row.ref === undefined) {
        return { ...base, status: 'error', message: row.error ?? 'Fila inválida' };
      }
      const tenant = deps.billing.findTenantBySlug(row.slug);
      if (tenant === undefined) return { ...base, status: 'error', message: 'Comercio no encontrado' };
      if (tenant.demo) return { ...base, status: 'error', message: 'Las demos no se cobran' };
      const found = { ...base, tenantId: tenant.id, tenantName: tenant.name, day: row.day, amount: row.amount };
      if (seen.has(row.ref)) return { ...found, status: 'duplicate', message: 'Repetido en la planilla' };
      seen.add(row.ref);
      if (deps.billing.paymentRefExists(row.ref)) return { ...found, status: 'duplicate', message: 'Ya registrado' };
      if (dryRun) return { ...found, status: 'ok' };
      try {
        const done = deps.billing.registerPayment({
          tenantId: tenant.id,
          day: row.day,
          amount: row.amount,
          info: row.info === '' ? undefined : row.info,
          actorUserId: actorOf(req),
          paymentRef: row.ref,
        });
        deps.audit.record({
          actorUserId: actorOf(req),
          tenantId: tenant.id,
          action: 'billing.payment_registered',
          details: { amount: row.amount, day: row.day, ...(row.info === '' ? {} : { info: row.info }), settled: done.settled, fromSheet: true, line: row.line },
        });
        return { ...found, status: 'ok' };
      } catch (err: unknown) {
        if (err instanceof DomainError) return { ...found, status: 'error', message: err.message };
        throw err;
      }
    });
    res.status(200).json({ rows, applied: !dryRun });
  });

  router.get('/payments', staff, (_req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(deps.billing.listPayments());
  });

  router.get('/settings', staff, (_req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(deps.billing.settings());
  });

  router.put(
    '/settings',
    rootOnly,
    handle(billingSettingsPatchSchema, 'billing.settings_updated', 200, (body, req) => {
      const settings = deps.billing.updateSettings(body, actorOf(req));
      return { result: settings, details: { keys: Object.keys(body) } };
    }),
  );

  return router;
}
