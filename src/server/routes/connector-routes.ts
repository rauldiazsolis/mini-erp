import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { AuthenticatedPosRequest } from '../middleware/auth-middleware.ts';
import { ConnectorService, type BatchEvent } from '../connector/connector-service.ts';
import { posLog } from '../middleware/logger.ts';

const CONTRACT_VERSION = '4.0.0';

function checkContractVersion(req: AuthenticatedPosRequest, res: Response, next: NextFunction): void {
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
  events: z.array(z.record(z.unknown())),
});

const pullBatchSchema = z.object({
  deviceId: z.string().optional(),
  cursors: z.object({
    products: z.string().optional(),
    customers: z.string().optional(),
  }),
  pendingLotIds: z.array(z.string()),
});

const accountHoldSchema = z.object({
  customerId: z.string().min(1, 'customerId requerido'),
  amount: z.number().positive('Monto debe ser positivo'),
});

export function createConnectorRoutes(
  requirePosAuth: (req: AuthenticatedPosRequest, res: Response, next: NextFunction) => void,
): Router {
  const router = Router();

  router.use(requirePosAuth);

  // GET /info (nunca responde 409, informa versión y estado)
  router.get('/info', (_req: AuthenticatedPosRequest, res: Response) => {
    res.status(200).json({
      contractVersion: CONTRACT_VERSION,
      status: 'ok',
      backend: {
        name: 'mini-erp',
        version: '0.1.0',
      },
    });
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

    const { tenantDb, branch, pointOfSale } = req.posContext!;
    const connector = new ConnectorService(tenantDb);

    const result = connector.processPushLot({
      lotId: idempotencyKey.trim(),
      deviceId: parseResult.data.deviceId,
      events: parseResult.data.events as BatchEvent[],
      defaultBranchId: branch,
    });

    // Logging detallado del lote recibido
    const eventsForLog = (parseResult.data.events as BatchEvent[]).map((e) => {
      let detail: string | undefined;
      if (e.type === 'sale') {
        const sale = e['sale'] as { total?: number } | undefined;
        detail = sale?.total !== undefined ? `$${sale.total}` : undefined;
      } else if (e.type === 'stock-movement') {
        const mov = e['movement'] as { productId?: string; delta?: number } | undefined;
        detail = mov ? `${mov.productId} (${mov.delta})` : undefined;
      } else if (e.type === 'customer') {
        const cust = e['customer'] as { name?: string } | undefined;
        detail = cust?.name;
      }
      return { type: e.type, id: e.id, detail };
    });

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

    const { tenantDb, branch, pointOfSale } = req.posContext!;
    const connector = new ConnectorService(tenantDb);

    const pullResult = connector.pullCatalog({
      cursors: parseResult.data.cursors,
      pendingLotIds: parseResult.data.pendingLotIds,
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

    const { tenantDb } = req.posContext!;
    const connector = new ConnectorService(tenantDb);

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
