import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('Stock Multi-Sucursal y Kardex Auditado (Etapa 2.2)', () => {
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-stock-test';
  let defaultBranchId: string;
  let secondBranchId: string;
  let testProductId: string;

  beforeEach(async () => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const created = createApp({ systemDb, tenantManager });
    app = created.app;

    // 1. Registrar usuario administrador
    const registerRes = created.authService.register({
      email: 'owner@stock.test',
      password: 'password123',
      name: 'Dueño Stock',
    });
    adminToken = registerRes.token;

    // 2. Crear tenant sin seed
    tenantManager.createTenant({
      id: tenantId,
      slug: 'kiosco-stock-test',
      name: 'Kiosco Stock Test',
      ownerUserId: registerRes.user.id,
      seedDemoData: false,
    });

    // 3. Obtener sucursal central por defecto
    const branchesRes = await request(app)
      .get(`/api/tenants/${tenantId}/branches`)
      .set('Authorization', `Bearer ${adminToken}`);
    defaultBranchId = branchesRes.body[0]?.id as string;

    // 4. Crear una segunda sucursal
    const branch2Res = await request(app)
      .post(`/api/tenants/${tenantId}/branches`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Sucursal Depósito', code: 'DEPOSITO' });
    secondBranchId = branch2Res.body.id as string;

    // 5. Crear un producto de prueba
    const prodRes = await request(app)
      .post(`/api/tenants/${tenantId}/products`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        sku: 'CHOCO-01',
        name: 'Chocolate con Maní 100g',
        price: 1500,
        category: 'Golosinas',
        tracksStock: true,
      });
    testProductId = prodRes.body.id as string;
  });

  describe('Matriz de Stock (/stock)', () => {
    it('devuelve la grilla matricial de stock por sucursal con el total consolidado', async () => {
      const res = await request(app)
        .get(`/api/tenants/${tenantId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);

      const item = res.body[0];
      expect(item.productId).toBe(testProductId);
      expect(item.sku).toBe('CHOCO-01');
      expect(item.totalStock).toBe(0);
      expect(item.branches).toHaveProperty(defaultBranchId, 0);
      expect(item.branches).toHaveProperty(secondBranchId, 0);
    });

    it('permite filtrar la matriz de stock por término de búsqueda y categoría', async () => {
      // Crear un segundo producto de otra categoría
      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'JUICE-01',
          name: 'Jugo de Naranja 1L',
          price: 1200,
          category: 'Bebidas',
          tracksStock: true,
        });

      // Filtrar por categoría
      const catRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock?category=Bebidas`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(catRes.status).toBe(200);
      expect(catRes.body.length).toBe(1);
      expect(catRes.body[0].sku).toBe('JUICE-01');

      // Filtrar por búsqueda
      const searchRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock?search=chocolate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.length).toBe(1);
      expect(searchRes.body[0].sku).toBe('CHOCO-01');
    });
  });

  describe('Ajustes de Stock Auditados (/stock/adjust)', () => {
    it('ajusta el stock fijando un valor absoluto (set) y audita el movimiento', async () => {
      const adjustRes = await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: testProductId,
          branchId: defaultBranchId,
          type: 'set',
          quantity: 25,
          reason: 'inventory_count',
          notes: 'Conteo físico inicial',
        });

      expect(adjustRes.status).toBe(200);
      expect(adjustRes.body.productId).toBe(testProductId);
      expect(adjustRes.body.branchId).toBe(defaultBranchId);
      expect(adjustRes.body.previousQuantity).toBe(0);
      expect(adjustRes.body.delta).toBe(25);
      expect(adjustRes.body.newQuantity).toBe(25);
      expect(adjustRes.body.movementId).toBeDefined();

      // Verificar que la matriz refleja el nuevo stock en la sucursal central
      const matrixRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`);

      const item = matrixRes.body.find((p: { productId: string }) => p.productId === testProductId);
      expect(item.branches[defaultBranchId]).toBe(25);
      expect(item.branches[secondBranchId]).toBe(0);
      expect(item.totalStock).toBe(25);
    });

    it('ajusta el stock aplicando un delta relativo (+ o -)', async () => {
      // 1. Establecer stock inicial de 50 en depósito
      await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: testProductId,
          branchId: secondBranchId,
          type: 'set',
          quantity: 50,
          reason: 'purchase',
        });

      // 2. Aplicar un ajuste delta de -5 (por ejemplo, rotura/daño)
      const deltaRes = await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: testProductId,
          branchId: secondBranchId,
          type: 'delta',
          quantity: -5,
          reason: 'damage',
          notes: 'Caja abollada',
        });

      expect(deltaRes.status).toBe(200);
      expect(deltaRes.body.previousQuantity).toBe(50);
      expect(deltaRes.body.delta).toBe(-5);
      expect(deltaRes.body.newQuantity).toBe(45);

      // 3. Aplicar un ajuste delta positivo de +10
      const restockRes = await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: testProductId,
          branchId: secondBranchId,
          type: 'delta',
          quantity: 10,
          reason: 'purchase',
        });

      expect(restockRes.status).toBe(200);
      expect(restockRes.body.previousQuantity).toBe(45);
      expect(restockRes.body.delta).toBe(10);
      expect(restockRes.body.newQuantity).toBe(55);
    });

    it('rechaza ajustes con datos inválidos o sucursal/producto inexistente', async () => {
      // Producto inexistente
      const invalidProdRes = await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: 'prod-fantasma',
          branchId: defaultBranchId,
          type: 'set',
          quantity: 10,
          reason: 'adjustment',
        });

      expect(invalidProdRes.status).toBe(404);

      // Sucursal inexistente
      const invalidBranchRes = await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: testProductId,
          branchId: 'branch-fantasma',
          type: 'set',
          quantity: 10,
          reason: 'adjustment',
        });

      expect(invalidBranchRes.status).toBe(404);

      // Sin motivo (reason requerido para trazabilidad)
      const missingReasonRes = await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: testProductId,
          branchId: defaultBranchId,
          type: 'set',
          quantity: 10,
        });

      expect(missingReasonRes.status).toBe(400);
    });
  });

  describe('Historial de Movimientos Kardex (/stock/kardex)', () => {
    it('registra y lista cronológicamente todos los movimientos con filtros', async () => {
      // Realizar 2 ajustes
      await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: testProductId,
          branchId: defaultBranchId,
          type: 'set',
          quantity: 30,
          reason: 'inventory_count',
          notes: 'Apertura',
        });

      await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: testProductId,
          branchId: defaultBranchId,
          type: 'delta',
          quantity: -2,
          reason: 'damage',
          notes: 'Vencido',
        });

      // Listar kardex
      const kardexRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock/kardex?productId=${testProductId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(kardexRes.status).toBe(200);
      expect(Array.isArray(kardexRes.body)).toBe(true);
      expect(kardexRes.body.length).toBe(2);

      // Orden descendente (el más reciente primero)
      expect(kardexRes.body[0]?.delta).toBe(-2);
      expect(kardexRes.body[0]?.reason).toBe('damage');
      expect(kardexRes.body[0]?.notes).toBe('Vencido');
      expect(kardexRes.body[0]?.productName).toBe('Chocolate con Maní 100g');
      expect(kardexRes.body[0]?.branchName).toBe('Sucursal Central');

      expect(kardexRes.body[1]?.delta).toBe(30);
      expect(kardexRes.body[1]?.reason).toBe('inventory_count');

      // Filtrar por motivo (damage)
      const filterRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock/kardex?reason=damage`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(filterRes.status).toBe(200);
      expect(filterRes.body.length).toBe(1);
      expect(filterRes.body[0]?.delta).toBe(-2);
    });
  });

  describe('Integración Bidireccional con POS y Kardex', () => {
    it('ajuste en ERP se refleja en el pull del POS, y una venta del POS aparece en el Kardex del ERP', async () => {
      // 1. Crear API Key de POS
      const keyRes = await request(app)
        .post(`/api/tenants/${tenantId}/api-keys`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Terminal 1',
          branch: 'CENTRAL',
          pointOfSale: 'Caja 1',
        });
      const posRawKey = keyRes.body.rawKey as string;

      // 2. Admin ajusta stock a 100 unidades en sucursal CENTRAL
      await request(app)
        .post(`/api/tenants/${tenantId}/stock/adjust`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          productId: testProductId,
          branchId: defaultBranchId,
          type: 'set',
          quantity: 100,
          reason: 'purchase',
        });

      // 3. POS hace pull y comprueba stock consolidado = 100
      const pullRes = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${posRawKey}`)
        .set('X-POS-Contract-Version', '4.0.0')
        .send({
          cursors: {},
          pendingLotIds: [],
        });

      expect(pullRes.status).toBe(200);
      const stockItem = (pullRes.body.stock as Array<{ productId: string; quantity: number }>).find(
        (s) => s.productId === testProductId,
      );
      expect(stockItem).toBeDefined();
      expect(stockItem?.quantity).toBe(100);

      // 4. POS realiza venta offline de 3 chocolates y envía lote push
      const pushRes = await request(app)
        .post('/connector/sync/push')
        .set('Authorization', `Bearer ${posRawKey}`)
        .set('X-POS-Contract-Version', '4.0.0')
        .set('Idempotency-Key', 'lot_pos_sale_choco_1')
        .send({
          deviceId: 'pos_dev_01',
          events: [
            {
              id: 'evt_sale_001',
              type: 'sale',
              origin: { branch: 'CENTRAL', pointOfSale: 'Caja 1' },
              sale: {
                id: 'sale_001',
                total: 4500,
                status: 'closed',
              },
            },
            {
              id: 'stk_mov_pos_1',
              type: 'stock-movement',
              origin: { branch: 'CENTRAL', pointOfSale: 'Caja 1' },
              movement: {
                id: 'mov_pos_1',
                productId: testProductId,
                delta: -3,
                reason: 'sale',
                saleId: 'sale_001',
              },
            },
          ],
        });

      expect(pushRes.status).toBe(200);

      // 5. Admin consulta matriz de stock: debe haber 97 en CENTRAL y 97 total
      const matrixAfterSale = await request(app)
        .get(`/api/tenants/${tenantId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`);

      const chocoStock = matrixAfterSale.body.find((p: { productId: string }) => p.productId === testProductId);
      expect(chocoStock.branches[defaultBranchId]).toBe(97);
      expect(chocoStock.totalStock).toBe(97);

      // 6. Admin consulta Kardex: debe registrarse la venta con delta -3 y saleId sale_001
      const kardexRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock/kardex?productId=${testProductId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(kardexRes.status).toBe(200);
      const saleMovement = (kardexRes.body as Array<{ reason: string; delta: number; saleId?: string }>).find(
        (m) => m.reason === 'sale',
      );
      expect(saleMovement).toBeDefined();
      expect(saleMovement?.delta).toBe(-3);
      expect(saleMovement?.saleId).toBe('sale_001');
    });
  });
});
