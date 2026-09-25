import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

describe('Connector API v4.0.0 (Etapa 1.4)', () => {
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
    const token = regRes.body.token;

    await request(app)
      .post('/api/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ id: tenantId, slug: tenantId, name: 'Kiosco Demo', seedDemoData: true });

    // Crear API Key para la terminal POS
    const keyRes = await request(app)
      .post(`/api/tenants/${tenantId}/api-keys`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'POS-01' });

    rawApiKey = keyRes.body.rawKey;
  });

  describe('GET /connector/info', () => {
    it('requiere autenticación Bearer con API key', async () => {
      const res = await request(app).get('/connector/info');
      expect(res.status).toBe(401);
    });

    it('responde 200 con la versión 4.0.0 del contrato y estado ok', async () => {
      const res = await request(app)
        .get('/connector/info')
        .set('Authorization', `Bearer ${rawApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.contractVersion).toBe('4.0.0');
      expect(res.body.status).toBe('ok');
      expect(res.body.backend.name).toBe('mini-erp');
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
        contractVersion: '4.0.0',
      });
    });

    it('acepta peticiones con versión 4.x.x', async () => {
      const res = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .set('X-POS-Contract-Version', '4.0.0')
        .send({ cursors: {}, pendingLotIds: [] });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /connector/sync/pull', () => {
    it('devuelve foto completa inicial de catálogo, clientes y stock', async () => {
      const res = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .send({ cursors: {}, pendingLotIds: [] });

      expect(res.status).toBe(200);
      expect(res.body.products.items.length).toBeGreaterThan(0);
      expect(res.body.customers.items.length).toBeGreaterThan(0);
      expect(res.body.stock.length).toBeGreaterThan(0);

      const prod = res.body.products.items[0];
      expect(prod.sku).toBeDefined();
      expect(Array.isArray(prod.barcodes)).toBe(true);
      expect(prod.tracksStock).toBe(true);
    });
  });

  describe('POST /connector/sync/push', () => {
    it('procesa lote de eventos (venta + movimiento de stock) y descuenta stock atómicamente', async () => {
      // 1. Consultar stock inicial de Coca Cola 500ml
      const initialPull = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${rawApiKey}`)
        .send({ cursors: {}, pendingLotIds: [] });

      const initialCoca = initialPull.body.stock.find((s: { productId: string }) => s.productId === 'prod-coca-500');
      const initialQty = initialCoca.quantity;

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

      expect(verifyPull.body.lots[lotId]?.status).toBe('ok');

      const updatedCoca = verifyPull.body.stock.find((s: { productId: string }) => s.productId === 'prod-coca-500');
      expect(updatedCoca.quantity).toBe(initialQty - 2);

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

      const cocaAfterReplay = afterReplayPull.body.stock.find((s: { productId: string }) => s.productId === 'prod-coca-500');
      expect(cocaAfterReplay.quantity).toBe(initialQty - 2);
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
      expect(holdRes.body.approved).toBe(true);
      expect(typeof holdRes.body.holdId).toBe('string');

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
      expect(excessiveRes.body.approved).toBe(false);
      expect(excessiveRes.body.reasonCode).toBe('insufficient-credit');
    });
  });
});
