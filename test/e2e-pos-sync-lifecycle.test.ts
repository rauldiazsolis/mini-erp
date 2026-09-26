import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

describe('FASE 6: E2E POS Sync Lifecycle & Live Verification', () => {
  let app: ReturnType<typeof createApp>['app'];
  let tenantManager: TenantManager;
  let rawApiKey: string;
  let adminToken: string;
  const tenantId = 'kiosco-e2e';
  const branchName = 'CENTRAL';
  const posName = 'Caja Principal';

  beforeEach(async () => {
    const systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);
    tenantManager = new TenantManager(systemDb, { inMemory: true });

    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;

    // 1. Registrar usuario admin/root
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'owner@e2e.test', password: 'password123', name: 'Owner E2E' });
    adminToken = regRes.body.token as string;

    // 2. Crear tenant con datos iniciales (preset kiosco)
    await request(app)
      .post('/api/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ id: tenantId, slug: tenantId, name: 'Kiosco E2E', seedDemoData: true });

    // 3. Generar API Key para la terminal POS
    const keyRes = await request(app)
      .post(`/api/tenants/${tenantId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: posName, branch: branchName, pointOfSale: posName });

    rawApiKey = keyRes.body.rawKey as string;
  });

  it('ejecuta el ciclo de vida completo: handshake, pull inicial, holds, push multievento, auditoría y dashboard', async () => {
    // =========================================================================
    // PASO 1: Handshake de Conexión (/connector/info) y Verificación de Contrato
    // =========================================================================
    const infoRes = await request(app)
      .get('/connector/info')
      .set('Authorization', `Bearer ${rawApiKey}`);

    expect(infoRes.status).toBe(200);
    expect(infoRes.body.contractVersion).toBe('4.0.0');
    expect(infoRes.body.status).toBe('ok');
    expect(infoRes.body.backend.name).toBe('mini-erp');

    // Validación de incompatibilidad de contrato (409 ante major distinto)
    const incompatibleRes = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('X-POS-Contract-Version', '3.0.0')
      .send({ cursors: {}, pendingLotIds: [] });

    expect(incompatibleRes.status).toBe(409);
    expect(incompatibleRes.body.code).toBe('incompatible-contract');
    expect(incompatibleRes.body.contractVersion).toBe('4.0.0');

    // =========================================================================
    // PASO 2: Pull Inicial de Catálogo, Clientes y Stock de la Sucursal
    // =========================================================================
    const initialPullRes = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('X-POS-Contract-Version', '4.0.0')
      .send({ cursors: {}, pendingLotIds: [] });

    expect(initialPullRes.status).toBe(200);
    const { products, customers, stock, lots } = initialPullRes.body;

    expect(products.items.length).toBeGreaterThan(0);
    expect(customers.items.length).toBeGreaterThan(0);
    expect(stock.length).toBeGreaterThan(0);
    expect(Object.keys(lots)).toHaveLength(0);

    // Verificar productos esperados
    const coca = products.items.find((p: { id: string }) => p.id === 'prod-coca-500');
    expect(coca).toBeDefined();
    expect(coca.sku).toBe('BEB-001');
    expect(coca.price).toBe(1500);
    expect(coca.tracksStock).toBe(true);

    const yerba = products.items.find((p: { id: string }) => p.id === 'prod-yerba-1k');
    expect(yerba).toBeDefined();
    expect(yerba.price).toBe(3200);

    // Verificar stock inicial en CENTRAL
    const cocaStock = stock.find((s: { productId: string }) => s.productId === 'prod-coca-500');
    expect(cocaStock).toBeDefined();
    expect(cocaStock.quantity).toBeGreaterThan(0);
    const initialCocaQty = cocaStock.quantity as number;

    const yerbaStock = stock.find((s: { productId: string }) => s.productId === 'prod-yerba-1k');
    expect(yerbaStock).toBeDefined();
    expect(yerbaStock.quantity).toBeGreaterThan(0);
    const initialYerbaQty = yerbaStock.quantity as number;

    // Verificar cliente Juan Pérez (límite: 50000, margen: 10000)
    const juan = customers.items.find((c: { id: string }) => c.id === 'cust-juan');
    expect(juan).toBeDefined();
    expect(juan.creditLimit).toBe(50000);
    expect(juan.margin).toBe(10000);
    expect(typeof juan.balance).toBe('number');
    const initialJuanBalance = juan.balance as number;

    // =========================================================================
    // PASO 3: Reservas Síncronas de Crédito (/connector/account-holds)
    // =========================================================================
    // 3.1 Juan solicita un hold de $5,000 (dentro de disponible) -> Aprobado
    const holdRes1 = await request(app)
      .post('/connector/account-holds')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('Idempotency-Key', 'hold-req-e2e-01')
      .send({ customerId: 'cust-juan', amount: 5000 });

    expect(holdRes1.status).toBe(200);
    expect(holdRes1.body.approved).toBe(true);
    expect(typeof holdRes1.body.holdId).toBe('string');
    const approvedHoldId = holdRes1.body.holdId as string;

    // 3.2 Juan solicita un monto excesivo ($999,999) -> Denegado por crédito insuficiente
    const holdRes2 = await request(app)
      .post('/connector/account-holds')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('Idempotency-Key', 'hold-req-e2e-02')
      .send({ customerId: 'cust-juan', amount: 999999 });

    expect(holdRes2.status).toBe(200);
    expect(holdRes2.body.approved).toBe(false);
    expect(holdRes2.body.reasonCode).toBe('insufficient-credit');

    // 3.3 Cliente inexistente o sin cuenta -> Denegado con 'no-account'
    const holdRes3 = await request(app)
      .post('/connector/account-holds')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('Idempotency-Key', 'hold-req-e2e-03')
      .send({ customerId: 'cust-inexistente', amount: 1000 });

    expect(holdRes3.status).toBe(200);
    expect(holdRes3.body.approved).toBe(false);
    expect(holdRes3.body.reasonCode).toBe('no-account');

    // =========================================================================
    // PASO 4: Push de Lote Multievento desde el POS (/connector/sync/push)
    // =========================================================================
    const nowIso = new Date().toISOString();
    const lotId = 'lot_e2e_full_lifecycle_001';

    const pushPayload = {
      deviceId: 'device-pos-central-01',
      events: [
        // Evento 1: Apertura de turno de caja ($500)
        {
          id: 'evt-cash-open-01',
          type: 'cash-movement',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          movement: {
            id: 'cm-open-01',
            type: 'session-open',
            amount: 500,
            notes: 'Apertura de turno mañana',
          },
        },
        // Evento 2: Venta en efectivo de 2 Coca Colas ($3000)
        {
          id: 'evt-sale-cash-01',
          type: 'sale',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          sale: {
            id: 'sale-001',
            total: 3000,
            status: 'closed',
            lines: [{ kind: 'product', productId: 'prod-coca-500', qty: 2, unitPrice: 1500 }],
            payments: [{ method: 'cash', amount: 3000 }],
          },
        },
        // Evento 3: Movimiento de stock de la venta 1 (-2 Coca Colas)
        {
          id: 'evt-stock-mov-01',
          type: 'stock-movement',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          movement: {
            id: 'sm-001',
            productId: 'prod-coca-500',
            delta: -2,
            reason: 'sale',
            saleId: 'sale-001',
          },
        },
        // Evento 4: Venta a cuenta corriente para Juan Pérez con Hold previo ($5000: 1 Yerba + 1 Coca + $300 ajuste)
        {
          id: 'evt-sale-acc-01',
          type: 'sale',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          sale: {
            id: 'sale-002',
            total: 5000,
            status: 'closed',
            customerId: 'cust-juan',
            lines: [
              { kind: 'product', productId: 'prod-yerba-1k', qty: 1, unitPrice: 3200 },
              { kind: 'product', productId: 'prod-coca-500', qty: 1, unitPrice: 1500 },
              { kind: 'freeform', description: 'Bolsa y recargo', qty: 1, unitPrice: 300 },
            ],
            payments: [{ method: 'account', amount: 5000, reference: approvedHoldId }],
          },
        },
        // Evento 5: Confirmación de Hold de cuenta corriente
        {
          id: 'evt-hold-confirm-01',
          type: 'account-hold-confirm',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          holdId: approvedHoldId,
          saleId: 'sale-002',
        },
        // Eventos 6 y 7: Movimientos de stock de la venta 2 (-1 Yerba, -1 Coca)
        {
          id: 'evt-stock-mov-02',
          type: 'stock-movement',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          movement: {
            id: 'sm-002',
            productId: 'prod-yerba-1k',
            delta: -1,
            reason: 'sale',
            saleId: 'sale-002',
          },
        },
        {
          id: 'evt-stock-mov-03',
          type: 'stock-movement',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          movement: {
            id: 'sm-003',
            productId: 'prod-coca-500',
            delta: -1,
            reason: 'sale',
            saleId: 'sale-002',
          },
        },
        // Evento 8: Venta offline a cuenta corriente (fiado directo sin hold previo, $1000)
        {
          id: 'evt-sale-fiado-01',
          type: 'sale',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          sale: {
            id: 'sale-003',
            total: 1000,
            status: 'closed',
            customerId: 'cust-juan',
            lines: [{ kind: 'product', productId: 'prod-coca-500', qty: 1, unitPrice: 1000 }],
            payments: [{ method: 'account', amount: 1000 }], // sin reference
          },
        },
        // Evento 9: Cobranza recibida de cliente Juan Pérez ($2000 que disminuyen su deuda)
        {
          id: 'evt-cust-payment-01',
          type: 'customer-payment',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          payment: {
            id: 'pay-001',
            customerId: 'cust-juan',
            total: 2000,
            method: 'cash',
          },
        },
        // Evento 10: Anulación parcial / devolución (devuelve 1 Coca Cola con saldo negativo -$1500)
        {
          id: 'evt-sale-void-01',
          type: 'sale',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          sale: {
            id: 'sale-004-void',
            total: -1500,
            status: 'closed',
            voidsSaleId: 'sale-001',
            lines: [{ kind: 'product', productId: 'prod-coca-500', qty: -1, unitPrice: 1500 }],
            payments: [{ method: 'cash', amount: -1500 }],
          },
        },
        // Evento 11: Reposición de stock por la anulación (+1 Coca Cola)
        {
          id: 'evt-stock-mov-04',
          type: 'stock-movement',
          createdAt: nowIso,
          origin: { branch: branchName, pointOfSale: posName },
          movement: {
            id: 'sm-004',
            productId: 'prod-coca-500',
            delta: 1,
            reason: 'sale-void',
            saleId: 'sale-004-void',
          },
        },
      ],
    };

    // Envío del lote al conector con Idempotency-Key
    const pushRes = await request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('Idempotency-Key', lotId)
      .set('X-POS-Contract-Version', '4.0.0')
      .send(pushPayload);

    expect(pushRes.status).toBe(200);
    expect(pushRes.body).toEqual({});

    // =========================================================================
    // PASO 5: Pull de Confirmación y Verificación de Estado de Lote
    // =========================================================================
    const confirmPullRes = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('X-POS-Contract-Version', '4.0.0')
      .send({ cursors: {}, pendingLotIds: [lotId] });

    expect(confirmPullRes.status).toBe(200);
    expect(confirmPullRes.body.lots[lotId]?.status).toBe('ok');

    // Validar nuevo stock en la respuesta del pull:
    // Coca inicial: -2 (venta 1) -1 (venta 2) +1 (anulación) = -2
    const updatedCoca = confirmPullRes.body.stock.find((s: { productId: string }) => s.productId === 'prod-coca-500');
    expect(updatedCoca.quantity).toBe(initialCocaQty - 2);

    // Yerba inicial: -1 (venta 2) = -1
    const updatedYerba = confirmPullRes.body.stock.find((s: { productId: string }) => s.productId === 'prod-yerba-1k');
    expect(updatedYerba.quantity).toBe(initialYerbaQty - 1);

    // Validar nuevo saldo de cliente Juan Pérez en la respuesta del pull:
    // Saldo inicial + 5000 (hold confirmado) + 1000 (fiado offline) - 2000 (cobranza) = +4000
    const updatedJuan = confirmPullRes.body.customers.items.find((c: { id: string }) => c.id === 'cust-juan');
    expect(updatedJuan.balance).toBe(initialJuanBalance + 4000);

    // =========================================================================
    // PASO 6: Idempotencia - Reenviar el mismo lote no debe duplicar efectos
    // =========================================================================
    const replayPushRes = await request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('Idempotency-Key', lotId)
      .set('X-POS-Contract-Version', '4.0.0')
      .send(pushPayload);

    expect(replayPushRes.status).toBe(200);

    const replayPullRes = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${rawApiKey}`)
      .set('X-POS-Contract-Version', '4.0.0')
      .send({ cursors: {}, pendingLotIds: [lotId] });

    const cocaAfterReplay = replayPullRes.body.stock.find((s: { productId: string }) => s.productId === 'prod-coca-500');
    expect(cocaAfterReplay.quantity).toBe(initialCocaQty - 2);

    const juanAfterReplay = replayPullRes.body.customers.items.find((c: { id: string }) => c.id === 'cust-juan');
    expect(juanAfterReplay.balance).toBe(initialJuanBalance + 4000);

    // =========================================================================
    // PASO 7: Impacto y Auditoría en APIs del Mini-ERP (Stock, Kardex, Cuentas y Dashboard)
    // =========================================================================
    // 7.1 Stock Matricial del Admin
    const adminStockRes = await request(app)
      .get(`/api/tenants/${tenantId}/stock`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminStockRes.status).toBe(200);
    const adminCoca = adminStockRes.body.find((p: { productId: string }) => p.productId === 'prod-coca-500');
    expect(adminCoca).toBeDefined();
    expect(adminCoca.totalStock).toBe(initialCocaQty - 2);

    const adminYerba = adminStockRes.body.find((p: { productId: string }) => p.productId === 'prod-yerba-1k');
    expect(adminYerba).toBeDefined();
    expect(adminYerba.totalStock).toBe(initialYerbaQty - 1);

    // 7.2 Kardex de Auditoría
    const kardexRes = await request(app)
      .get(`/api/tenants/${tenantId}/stock/kardex?productId=prod-coca-500`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(kardexRes.status).toBe(200);
    const kardexItems = kardexRes.body as { delta: number; reason: string; saleId?: string }[];
    // Deben estar los movimientos -2 (sale), -1 (sale), +1 (sale-void)
    expect(kardexItems.some((k) => k.delta === -2 && k.reason === 'sale' && k.saleId === 'sale-001')).toBe(true);
    expect(kardexItems.some((k) => k.delta === -1 && k.reason === 'sale' && k.saleId === 'sale-002')).toBe(true);
    expect(kardexItems.some((k) => k.delta === 1 && k.reason === 'sale-void' && k.saleId === 'sale-004-void')).toBe(true);

    // 7.3 Extracto de Cuenta Corriente del Cliente Juan Pérez
    const movementsRes = await request(app)
      .get(`/api/tenants/${tenantId}/customers/cust-juan/movements`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(movementsRes.status).toBe(200);
    const movements = movementsRes.body as { type: string; amount: number; balanceAfter: number; description?: string }[];

    // Validar que existan los asientos correspondientes
    const saleMovements = movements.filter((m) => m.type === 'sale');
    expect(saleMovements.some((m) => m.amount === 5000)).toBe(true);
    expect(saleMovements.some((m) => m.amount === 1000)).toBe(true);

    const paymentMovements = movements.filter((m) => m.type === 'payment');
    expect(paymentMovements.some((m) => m.amount === -2000)).toBe(true);

    // El asiento de cobranza aplicado al final debe reflejar el saldo resultante
    const payMovement = movements.find((m) => m.description?.includes('Cobranza pay-001'));
    expect(payMovement).toBeDefined();
    expect(payMovement?.balanceAfter).toBe(initialJuanBalance + 4000);

    // Verificar también el registro de cliente Juan Pérez en la API Admin
    const adminJuanRes = await request(app)
      .get(`/api/tenants/${tenantId}/customers/cust-juan`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminJuanRes.status).toBe(200);
    expect(adminJuanRes.body.balance).toBe(initialJuanBalance + 4000);

    // 7.4 Dashboard Summary y Métricas en Tiempo Real
    const dashRes = await request(app)
      .get(`/api/tenants/${tenantId}/dashboard/summary?period=today`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.summary).toBeDefined();
    expect(dashRes.body.summary.salesCount).toBeGreaterThan(0);
    expect(dashRes.body.summary.totalSales).toBeGreaterThan(0);
    expect(dashRes.body.summary.totalReceivables).toBeGreaterThan(0);
    expect(dashRes.body.topProducts.length).toBeGreaterThan(0);
  });
});
