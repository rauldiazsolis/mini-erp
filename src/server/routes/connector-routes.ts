import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedPosRequest } from '../middleware/auth-middleware.ts';
import { ConnectorService } from '../connector/connector-service.ts';
import { summarizeForLog } from '../connector/push-events.ts';
import { connectorServiceDef } from '../di/container.ts';
import { posLog } from '../middleware/logger.ts';
import type { DemoSessionService } from '../demo/demo-session-service.ts';
import type { PortalService } from '../portal/portal-service.ts';
import { DEFAULT_DEMO_TEMPLATE, DEMO_TEMPLATES, isDemoTemplate } from '../seeds/index.ts';
import { backendInfo } from '../connector/backend-info.ts';
import { CONTRACT_MAJOR, CONTRACT_VERSION, majorOf } from '../../shared/contract-version.ts';
import type { RegisterService } from '../registers/register-service.ts';
import type { BillingService } from '../billing/billing-service.ts';
import type { TenantManager } from '../db/tenant-manager.ts';

/** Servicios de sistema que usa el Connector API (#21, #58). */
export type ConnectorDeps = {
  registers: RegisterService;
  billing: BillingService;
  tenants: Pick<TenantManager, 'getTenantName'>;
  portal: PortalService;
};

function getConnectorService(req: AuthenticatedPosRequest): ConnectorService {
  if (req.tenantScope !== undefined) {
    return req.tenantScope.use(connectorServiceDef);
  }
  if (req.posContext?.tenantDb !== undefined) {
    return new ConnectorService(req.posContext.tenantDb);
  }
  throw new Error('Tenant DB o Scope no inicializado para POS');
}

function checkContractVersion(req: Request, res: Response, next: NextFunction): void {
  const version = req.headers['x-pos-contract-version'];
  if (typeof version === 'string' && majorOf(version) !== CONTRACT_MAJOR) {
    res.status(409).json({ code: 'incompatible-contract', contractVersion: CONTRACT_VERSION });
    return;
  }
  next();
}

const pushBatchSchema = z.object({
  deviceId: z.string().min(1, 'deviceId requerido'),
  events: z.array(z.unknown()),
});

const pullBatchSchema = z.object({
  deviceId: z.string().optional(),
  cursors: z.object({
    products: z.string().optional(),
    customers: z.string().optional(),
  }),
  pendingLotIds: z.array(z.string()),
});

const demoSessionRequestSchema = z.looseObject({ template: z.string().optional() });

const accountHoldSchema = z.object({
  customerId: z.string().min(1, 'customerId requerido'),
  amount: z.number().positive('Monto debe ser positivo'),
});

export function createConnectorRoutes(
  requirePosAuth: (req: AuthenticatedPosRequest, res: Response, next: NextFunction) => void,
  demoSessions: DemoSessionService,
  demoLimit: RequestHandler,
  deps: ConnectorDeps,
): Router {
  const router = Router();

  // POST /demo-sessions (4.4.0, #9): el único endpoint sin key; sí valida la versión del contrato
  router.post('/demo-sessions', checkContractVersion, demoLimit, (req: Request, res: Response) => {
    if (!demoSessions.enabled()) {
      res.status(404).json({ error: 'Este backend no ofrece demos' });
      return;
    }
    const body: unknown = req.body ?? {};
    const parsed = demoSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Payload inválido' });
      return;
    }
    const template = parsed.data.template ?? DEFAULT_DEMO_TEMPLATE;
    if (!isDemoTemplate(template)) {
      res.status(422).json({ code: 'unknown-template', templates: [...DEMO_TEMPLATES] });
      return;
    }
    if (demoSessions.isFull()) {
      res.status(503).json({ code: 'demo-capacity', message: 'No hay lugar para más demos; probá más tarde' });
      return;
    }
    const session = demoSessions.create(template);
    const origin = demoSessions.publicUrl() ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    res.status(201).json({
      apiKey: session.apiKey,
      branch: session.branch,
      pointOfSale: session.pointOfSale,
      template: session.template,
      onboarding: {
        url: `${origin}/alta?template=${encodeURIComponent(session.template)}`,
        label: 'Crear mi comercio',
      },
    });
  });

  router.use(requirePosAuth);

  // GET /info (nunca responde 409, informa versión y estado; 4.5.0: el comercio de la key)
  router.get('/info', (req: AuthenticatedPosRequest, res: Response) => {
    const tenantId = req.posContext?.tenantId;
    const companyName = tenantId === undefined ? undefined : (deps.tenants.getTenantName(tenantId) ?? undefined);
    res.status(200).json(backendInfo({ status: 'ok', demos: demoSessions.enabled(), portal: true, companyName }));
  });

  // El resto de los endpoints validan la versión del contrato
  router.use(checkContractVersion);

  // POST /portal-links (4.6.0, capacidad portal; adelantado de M10 en #24): la URL para abrir mini
  router.post('/portal-links', (req: AuthenticatedPosRequest, res: Response) => {
    const ctx = req.posContext;
    if (ctx === undefined) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }
    const origin = demoSessions.publicUrl() ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    res.status(201).json(deps.portal.createLink({ tenantId: ctx.tenantId, registerId: ctx.registerId, origin }));
  });

  // POST /sync/push (con Idempotency-Key)
  router.post('/sync/push', (req: AuthenticatedPosRequest, res: Response) => {
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      res.status(400).json({ error: 'Falta cabecera Idempotency-Key' });
      return;
    }

    const parseResult = pushBatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Payload inválido' });
      return;
    }

    if (!req.posContext) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }
    const { branch, pointOfSale, registerId } = req.posContext;
    const connector = getConnectorService(req);
    // La caja se liga al primer equipo; otro equipo con la misma key cobra aparte (#21)
    const binding = deps.registers.seen(registerId, parseResult.data.deviceId);
    const chargeDevice = binding === 'foreign' ? parseResult.data.deviceId : '';

    const result = connector.processPushLot({
      lotId: idempotencyKey.trim(),
      deviceId: parseResult.data.deviceId,
      events: parseResult.data.events,
      defaultBranchId: branch,
      registerId,
      chargeDevice,
    });

    // El cargo por caja y día, después del commit del lote: nunca tumba el push; el barrido lo recupera (#21)
    if (result.saleDays.length > 0) {
      try {
        deps.billing.charge({ tenantId: req.posContext.tenantId, registerId, chargeDevice, days: result.saleDays });
      } catch (err: unknown) {
        console.error('[cobro] no se pudo generar el cargo:', err);
      }
    }

    // Logging detallado del lote recibido
    const eventsForLog = parseResult.data.events.map(summarizeForLog);

    posLog.push({
      lotId: idempotencyKey.trim(),
      deviceId: parseResult.data.deviceId,
      branch,
      pos: pointOfSale,
      events: eventsForLog,
      status: result.status,
    });

    // Respuesta inmediata 200 (el backend nunca rechaza de forma síncrona)
    res.status(200).json({});
  });

  // POST /sync/pull
  router.post('/sync/pull', (req: AuthenticatedPosRequest, res: Response) => {
    const parseResult = pullBatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Payload inválido' });
      return;
    }

    if (!req.posContext) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }
    const { branch, pointOfSale, registerId } = req.posContext;
    const connector = getConnectorService(req);
    if (parseResult.data.deviceId !== undefined) {
      deps.registers.seen(registerId, parseResult.data.deviceId);
    }

    const pullResult = connector.pullCatalog({
      cursors: parseResult.data.cursors,
      pendingLotIds: parseResult.data.pendingLotIds,
      branchId: branch,
      deviceId: parseResult.data.deviceId,
      notices: {
        billing: deps.billing.summary(req.posContext.tenantId),
        register: parseResult.data.deviceId === undefined ? undefined : deps.registers.noticeState(registerId, parseResult.data.deviceId),
      },
    });

    // Logging detallado del pull
    posLog.pull({
      branch,
      pos: pointOfSale,
      cursors: parseResult.data.cursors,
      productsCount: pullResult.products.items.length,
      customersCount: pullResult.customers.items.length,
      stockCount: pullResult.stock.length,
      pendingLotsQueried: parseResult.data.pendingLotIds.length,
    });

    res.status(200).json(pullResult);
  });

  // POST /account-holds
  router.post('/account-holds', (req: AuthenticatedPosRequest, res: Response) => {
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      res.status(400).json({ error: 'Falta cabecera Idempotency-Key' });
      return;
    }

    const parseResult = accountHoldSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Payload inválido' });
      return;
    }

    const connector = getConnectorService(req);

    const holdResult = connector.requestAccountHold({
      customerId: parseResult.data.customerId,
      amount: parseResult.data.amount,
    });

    // Logging detallado del hold
    posLog.hold({
      customerId: parseResult.data.customerId,
      amount: parseResult.data.amount,
      approved: holdResult.approved,
      reasonCode: 'reasonCode' in holdResult ? holdResult.reasonCode : undefined,
      holdId: 'holdId' in holdResult ? holdResult.holdId : undefined,
    });

    res.status(200).json(holdResult);
  });

  return router;
}
