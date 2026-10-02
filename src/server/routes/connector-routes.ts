import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { AuthenticatedPosRequest } from '../middleware/auth-middleware.ts';
import { ConnectorService } from '../connector/connector-service.ts';
import { summarizeForLog } from '../connector/push-events.ts';
import { connectorServiceDef } from '../di/container.ts';
import { posLog } from '../middleware/logger.ts';
import type { DemoSessionService } from '../demo/demo-session-service.ts';
import { DEFAULT_DEMO_TEMPLATE, DEMO_TEMPLATES, isDemoTemplate } from '../seeds/index.ts';
import { backendInfo, CONTRACT_VERSION } from '../connector/backend-info.ts';

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
  if (typeof version === 'string') {
    const major = version.split('.')[0];
    if (major !== '4') {
      res.status(409).json({ code: 'incompatible-contract', contractVersion: CONTRACT_VERSION });
      return;
    }
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

const demoSessionRequestSchema = z.object({ template: z.string().optional() }).passthrough();

const accountHoldSchema = z.object({
  customerId: z.string().min(1, 'customerId requerido'),
  amount: z.number().positive('Monto debe ser positivo'),
});

export function createConnectorRoutes(
  requirePosAuth: (req: AuthenticatedPosRequest, res: Response, next: NextFunction) => void,
  demoSessions: DemoSessionService,
  demoLimit: RequestHandler,
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
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Payload inválido' });
      return;
    }
    const template = parsed.data.template ?? DEFAULT_DEMO_TEMPLATE;
    if (!isDemoTemplate(template)) {
      res.status(422).json({ code: 'unknown-template', templates: [...DEMO_TEMPLATES] });
      return;
    }
    demoSessions.sweepExpired();
    if (demoSessions.isFull()) {
      res.status(503).json({ code: 'demo-capacity', error: 'No hay lugar para más demos; probá más tarde' });
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

  // GET /info (nunca responde 409, informa versión y estado)
  router.get('/info', (_req: AuthenticatedPosRequest, res: Response) => {
    res.status(200).json(backendInfo({ status: 'ok', demos: demoSessions.enabled() }));
  });

  // El resto de los endpoints validan la versión del contrato
  router.use(checkContractVersion);

  // POST /sync/push (con Idempotency-Key)
  router.post('/sync/push', (req: AuthenticatedPosRequest, res: Response) => {
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      res.status(400).json({ error: 'Falta cabecera Idempotency-Key' });
      return;
    }

    const parseResult = pushBatchSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Payload inválido' });
      return;
    }

    if (!req.posContext) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }
    const { branch, pointOfSale } = req.posContext;
    const connector = getConnectorService(req);

    const result = connector.processPushLot({
      lotId: idempotencyKey.trim(),
      deviceId: parseResult.data.deviceId,
      events: parseResult.data.events,
      defaultBranchId: branch,
    });

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
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Payload inválido' });
      return;
    }

    if (!req.posContext) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }
    const { branch, pointOfSale } = req.posContext;
    const connector = getConnectorService(req);

    const pullResult = connector.pullCatalog({
      cursors: parseResult.data.cursors,
      pendingLotIds: parseResult.data.pendingLotIds,
      branchId: branch,
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
      res.status(400).json({ error: parseResult.error.errors[0]?.message ?? 'Payload inválido' });
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
