import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

describe('Connector API v4.2.0 (Etapa 1.4)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let tenantManager: TenantManager;
  let rawApiKey: string;
  const tenantId = 'kiosco-demo';

  beforeEach(async () => {
    const systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);
    tenantManager = new TenantManager(systemDb, { inMemory: true });

    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;

    // Registrar root y tenant
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'owner@kiosco.com', password: 'password123', name: 'Owner' });
    const regBody = regRes.body as unknown as { token: string };
    const token = regBody.token;

    await request(app)
      .post('/api/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ id: tenantId, slug: tenantId, name: 'Kiosco Demo', seedDemoData: true });

    // Crear API Key para la terminal POS
    const keyRes = await request(app)
      .post(`/api/tenants/${tenantId}/api-keys`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'POS-01' });

    const keyBody = keyRes.body as unknown as { rawKey: string };
    rawApiKey = keyBody.rawKey;
  });

  async function pushAndPull(lotId: string, events: unknown[]) {
    const pushRes = await request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('X-POS-Contract-Version', '4.2.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId: 'device-pos-01', events });
    expect(pushRes.status).toBe(200);
    const pullRes = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .send({ cursors: {}, pendingLotIds: [lotId] });
    return (pullRes.body as unknown as {
      lots?: Record<string, { status: string; issues?: { message: string; eventId?: string }[] }>;
    }).lots?.[lotId];
  }

  function storedSale(id: string): Record<string, unknown> | undefined {
    const row = tenantManager
      .getTenantDb(tenantId)
      .prepare('SELECT payload FROM sales WHERE id = ?')
      .get(id) as { payload: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.payload) as Record<string, unknown>);
  }

  describe('GET /connector/info', () => {
    it('requiere autenticación Bearer con API key', async () => {
      const res = await request(app).get('/connector/info');
      expect(res.status).toBe(401);
    });

    it('responde 200 con la versión 4.2.0 del contrato y estado ok', async () => {
      const res = await request(app)
        .get('/connector/info')
        .set('Authorization', `Bearer ${rawApiKey}`);

      expect(res.status).toBe(200);
      const body = res.body as unknown as { contractVersion: string; status: string; backend: { name: string } };
      expect(body.contractVersion).toBe('4.2.0');
      expect(body.status).toBe('ok');
      expect(body.backend.name).toBe('mini-erp');
    });
  });

  describe('Validación de versión de contrato (X-POS-Contract-Version)', () => {
    it('responde 409 incompatible-contract si el major es distinto de 4', async () => {
      const res = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .set('X-POS-Contract-Version', '3.0.0')
        .send({ cursors: {}, pendingLotIds: [] });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        code: 'incompatible-contract',
        contractVersion: '4.2.0',
      });
    });

    it('acepta peticiones con versión 4.x.x', async () => {
      const res = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .set('X-POS-Contract-Version', '4.2.0')
        .send({ cursors: {}, pendingLotIds: [] });

      expect(res.status).toBe(200);
    });
  });

  interface PullResponse {
    products: { items: Array<{ sku?: string; barcodes?: string[]; tracksStock?: boolean }> };
    customers: { items: Array<unknown> };
    stock: Array<{ productId: string; quantity: number }>;
    lots?: Record<string, { status: string }>;
  }

  describe('POST /connector/sync/pull', () => {
    it('devuelve foto completa inicial de catálogo, clientes y stock', async () => {
      const res = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .send({ cursors: {}, pendingLotIds: [] });

      expect(res.status).toBe(200);
      const body = res.body as unknown as PullResponse;
      expect(body.products.items.length).toBeGreaterThan(0);
      expect(body.customers.items.length).toBeGreaterThan(0);
      expect(body.stock.length).toBeGreaterThan(0);

      const prod = body.products.items[0];
      expect(prod?.sku).toBeDefined();
      expect(Array.isArray(prod?.barcodes)).toBe(true);
      expect(prod?.tracksStock).toBe(true);
    });
  });

  describe('POST /connector/sync/push', () => {
    it('procesa lote de eventos (venta + movimiento de stock) y descuenta stock atómicamente', async () => {
      // 1. Consultar stock inicial de Coca Cola 500ml
      const initialPull = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .send({ cursors: {}, pendingLotIds: [] });

      const initialBody = initialPull.body as unknown as PullResponse;
      const initialCoca = initialBody.stock.find((s) => s.productId === 'prod-coca-500');
      const initialQty = initialCoca?.quantity ?? 0;

      // 2. Enviar lote de push con venta y descuento de 2 unidades
      const lotId = 'lot_01J8YXYZ';
      const pushRes = await request(app)
        .post('/connector/sync/push')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .set('Idempotency-Key', lotId)
        .send({
          deviceId: 'device-pos-01',
          events: [
            {
              id: 'evt-sale-1',
              type: 'sale',
              createdAt: new Date().toISOString(),
              origin: { branch: 'CENTRAL', pointOfSale: 'POS-01' },
              sale: {
                id: 'sale-001',
                total: 3000,
                status: 'closed',
                lines: [{ kind: 'product', productId: 'prod-coca-500', qty: 2, unitPrice: 1500 }],
                payments: [{ method: 'cash', amount: 3000 }],
              },
            },
            {
              id: 'evt-stock-1',
              type: 'stock-movement',
              createdAt: new Date().toISOString(),
              origin: { branch: 'CENTRAL', pointOfSale: 'POS-01' },
              movement: {
                id: 'mov-001',
                productId: 'prod-coca-500',
                delta: -2,
                reason: 'sale',
                saleId: 'sale-001',
              },
            },
          ],
        });

      expect(pushRes.status).toBe(200);

      // 3. Verificar estado del lote y stock actualizado mediante pull
      const verifyPull = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .send({ cursors: {}, pendingLotIds: [lotId] });

      const verifyBody = verifyPull.body as unknown as PullResponse;
      expect(verifyBody.lots?.[lotId]?.status).toBe('ok');

      const updatedCoca = verifyBody.stock.find((s) => s.productId === 'prod-coca-500');
      expect(updatedCoca?.quantity).toBe(initialQty - 2);

      // 4. Idempotencia: reenviar el mismo lote con mismo Idempotency-Key no debe descontar de nuevo
      const replayRes = await request(app)
        .post('/connector/sync/push')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .set('Idempotency-Key', lotId)
        .send({
          deviceId: 'device-pos-01',
          events: [],
        });

      expect(replayRes.status).toBe(200);

      const afterReplayPull = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .send({ cursors: {}, pendingLotIds: [lotId] });

      const afterReplayBody = afterReplayPull.body as unknown as PullResponse;
      const cocaAfterReplay = afterReplayBody.stock.find((s) => s.productId === 'prod-coca-500');
      expect(cocaAfterReplay?.quantity).toBe(initialQty - 2);
    });
  });

  describe('venta con número de ticket (4.1.0, #120)', () => {
    function saleEvent(id: string, sale: Record<string, unknown>) {
      return {
        id,
        type: 'sale',
        createdAt: new Date().toISOString(),
        origin: { branch: 'CENTRAL', pointOfSale: 'POS-01' },
        sale: {
          id,
          total: 100,
          status: 'closed',
          lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 100 }],
          payments: [{ method: 'cash', amount: 100 }],
          ...sale,
        },
      };
    }

    it('guarda la venta completa con su ticket', async () => {
      const lot = await pushAndPull('lot-ticket-1', [
        saleEvent('sale-t1', { ticket: { date: '2026-09-24', number: 12 } }),
      ]);

      expect(lot?.status).toBe('ok');
      expect(storedSale('sale-t1')).toMatchObject({
        ticket: { date: '2026-09-24', number: 12 },
        lines: [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 100 }],
      });
    });

    it('una venta sin ticket (POS anterior) se sigue aceptando', async () => {
      const lot = await pushAndPull('lot-ticket-2', [saleEvent('sale-t2', {})]);

      expect(lot?.status).toBe('ok');
      expect(storedSale('sale-t2')).toBeDefined();
    });

    it('un ticket inválido es un aviso del lote para ese evento; el resto se aplica', async () => {
      const lot = await pushAndPull('lot-ticket-3', [
        saleEvent('sale-bad', { ticket: { date: 'hoy', number: 0 } }),
        saleEvent('sale-good', { ticket: { date: '2026-09-24', number: 13 } }),
      ]);

      expect(lot?.status).toBe('issues');
      expect(lot?.issues?.map((issue) => issue.eventId)).toEqual(['sale-bad']);
      expect(storedSale('sale-bad')).toBeUndefined();
      expect(storedSale('sale-good')).toBeDefined();
    });
  });

  describe('validación de los eventos del push (#1)', () => {
    const now = new Date().toISOString();
    const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };
    const validSale = {
      id: 'e-sale-ok',
      type: 'sale',
      createdAt: now,
      origin,
      sale: { id: 'sale-ok', total: 100, status: 'closed', lines: [], payments: [{ method: 'cash', amount: 100 }] },
    };

    it('un elemento que no es un evento no rechaza el lote: es un aviso y el resto se aplica', async () => {
      const lot = await pushAndPull('lot-no-evento', [42, validSale]);

      expect(lot?.status).toBe('issues');
      expect(lot?.issues).toHaveLength(1);
      expect(lot?.issues?.[0]?.eventId).toBeUndefined();
      expect(storedSale('sale-ok')).toBeDefined();
    });

    it('una liberación de bloqueo sin holdId es un aviso del lote', async () => {
      const lot = await pushAndPull('lot-release-sin-hold', [
        { id: 'e-release', type: 'account-hold-release', createdAt: now, origin },
      ]);

      expect(lot?.status).toBe('issues');
      expect(lot?.issues?.map((issue) => issue.eventId)).toEqual(['e-release']);
    });

    it('un movimiento de stock sin delta es un aviso y no toca el stock', async () => {
      const stockOf = () =>
        (tenantManager
          .getTenantDb(tenantId)
          .prepare("SELECT SUM(quantity) AS total FROM stock WHERE product_id = 'prod-coca-500'")
          .get() as { total: number | null }).total;
      const before = stockOf();

      const lot = await pushAndPull('lot-mov-sin-delta', [
        {
          id: 'e-mov',
          type: 'stock-movement',
          createdAt: now,
          origin,
          movement: { id: 'mov-sin-delta', productId: 'prod-coca-500', reason: 'sale' },
        },
      ]);

      expect(lot?.issues?.map((issue) => issue.eventId)).toEqual(['e-mov']);
      expect(stockOf()).toBe(before);
    });
  });

  describe('POST /connector/account-holds', () => {
    it('aprueba hold cuando el cliente tiene crédito disponible y rechaza cuando excede el margen', async () => {
      // Cliente Juan Pérez tiene creditLimit: 50000, margin: 10000, balance: 12500 -> disponible = 47500
      const holdRes = await request(app)
        .post('/connector/account-holds')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .set('Idempotency-Key', 'hold-req-1')
        .send({
          customerId: 'cust-juan',
          amount: 5000,
        });

      expect(holdRes.status).toBe(200);
      const holdBody = holdRes.body as unknown as { approved: boolean; holdId?: string; reasonCode?: string };
      expect(holdBody.approved).toBe(true);
      expect(typeof holdBody.holdId).toBe('string');

      // Intentar pedir un monto desmedido
      const excessiveRes = await request(app)
        .post('/connector/account-holds')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .set('Idempotency-Key', 'hold-req-2')
        .send({
          customerId: 'cust-juan',
          amount: 999999,
        });

      expect(excessiveRes.status).toBe(200);
      const excessiveBody = excessiveRes.body as unknown as { approved: boolean; holdId?: string; reasonCode?: string };
      expect(excessiveBody.approved).toBe(false);
      expect(excessiveBody.reasonCode).toBe('insufficient-credit');
    });
  });

  describe('cobranza con recibo y saldo sin crédito (4.2.0, #101)', () => {
    it('guarda el recibo y el pull trae al cliente con su saldo, sin crédito', async () => {
      const now = new Date().toISOString();
      const pushRes = await request(app)
        .post('/connector/sync/push')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .set('X-POS-Contract-Version', '4.2.0')
        .set('Idempotency-Key', 'lot-cobranza-1')
        .send({
          deviceId: 'device-pos-01',
          events: [
            {
              id: 'cust-sin-credito',
              type: 'customer',
              createdAt: now,
              origin: { branch: 'CENTRAL', pointOfSale: 'POS-01' },
              customer: { id: 'cust-sin-credito', name: 'Sin Crédito', createdAt: now },
            },
            {
              id: 'cp-1',
              type: 'customer-payment',
              createdAt: now,
              origin: { branch: 'CENTRAL', pointOfSale: 'POS-01' },
              payment: {
                id: 'cp-1',
                customerId: 'cust-sin-credito',
                payments: [{ method: 'cash', amount: 300 }],
                total: 300,
                createdAt: now,
                receipt: { date: '2026-09-27', number: 3 },
              },
            },
          ],
        });
      expect(pushRes.status).toBe(200);

      const row = tenantManager
        .getTenantDb(tenantId)
        .prepare('SELECT payload FROM customer_payments WHERE id = ?')
        .get('cp-1') as { payload: string } | undefined;
      expect(JSON.parse(row?.payload ?? '{}')).toMatchObject({
        receipt: { date: '2026-09-27', number: 3 },
      });

      const pullRes = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .set('X-POS-Contract-Version', '4.2.0')
        .send({ cursors: {}, pendingLotIds: [] });
      const customers = (pullRes.body as unknown as {
        customers: { items: Array<{ id: string; balance?: number; creditLimit?: number }> };
      }).customers.items;
      const customer = customers.find((item) => item.id === 'cust-sin-credito');
      expect(customer?.balance).toBe(-300);
      expect(customer?.creditLimit).toBeUndefined();
    });
  });
});
