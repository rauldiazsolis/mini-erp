import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

interface StockMatrixItem {
  productId: string;
  sku: string;
  totalStock: number;
  branches: Record<string, number>;
}

interface StockAdjustResponse {
  productId: string;
  branchId: string;
  previousQuantity: number;
  delta: number;
  newQuantity: number;
  movementId: string;
}

interface KardexMovementItem {
  productId: string;
  productName: string;
  branchId: string;
  branchName: string;
  delta: number;
  reason: string;
  notes?: string;
  saleId?: string;
}

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
    const branches = branchesRes.body as unknown as Array<{ id: string }>;
    defaultBranchId = branches[0]?.id ?? '';

    // 4. Crear una segunda sucursal
    const branch2Res = await request(app)
      .post(`/api/tenants/${tenantId}/branches`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Sucursal Depósito', code: 'DEPOSITO' });
    const branch2 = branch2Res.body as unknown as { id: string };
    secondBranchId = branch2.id;

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
    const prod = prodRes.body as unknown as { id: string };
    testProductId = prod.id;
  });

  describe('Matriz de Stock (/stock)', () => {
    it('devuelve la grilla matricial de stock por sucursal con el total consolidado', async () => {
      const res = await request(app)
        .get(`/api/tenants/${tenantId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body as unknown as StockMatrixItem[];
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBe(1);

      const item = items[0];
      expect(item?.productId).toBe(testProductId);
      expect(item?.sku).toBe('CHOCO-01');
      expect(item?.totalStock).toBe(0);
      expect(item?.branches).toHaveProperty(defaultBranchId, 0);
      expect(item?.branches).toHaveProperty(secondBranchId, 0);
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
      const catItems = catRes.body as unknown as StockMatrixItem[];
      expect(catItems.length).toBe(1);
      expect(catItems[0]?.sku).toBe('JUICE-01');

      // Filtrar por búsqueda
      const searchRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock?search=chocolate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(searchRes.status).toBe(200);
      const searchItems = searchRes.body as unknown as StockMatrixItem[];
      expect(searchItems.length).toBe(1);
      expect(searchItems[0]?.sku).toBe('CHOCO-01');
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
      const adjustBody = adjustRes.body as unknown as StockAdjustResponse;
      expect(adjustBody.productId).toBe(testProductId);
      expect(adjustBody.branchId).toBe(defaultBranchId);
      expect(adjustBody.previousQuantity).toBe(0);
      expect(adjustBody.delta).toBe(25);
      expect(adjustBody.newQuantity).toBe(25);
      expect(adjustBody.movementId).toBeDefined();

      // Verificar que la matriz refleja el nuevo stock en la sucursal central
      const matrixRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`);

      const matrixItems = matrixRes.body as unknown as StockMatrixItem[];
      const item = matrixItems.find((p) => p.productId === testProductId);
      expect(item?.branches[defaultBranchId]).toBe(25);
      expect(item?.branches[secondBranchId]).toBe(0);
      expect(item?.totalStock).toBe(25);
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
      const deltaBody = deltaRes.body as unknown as StockAdjustResponse;
      expect(deltaBody.previousQuantity).toBe(50);
      expect(deltaBody.delta).toBe(-5);
      expect(deltaBody.newQuantity).toBe(45);

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
      const restockBody = restockRes.body as unknown as StockAdjustResponse;
      expect(restockBody.previousQuantity).toBe(45);
      expect(restockBody.delta).toBe(10);
      expect(restockBody.newQuantity).toBe(55);
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
      const movements = kardexRes.body as unknown as KardexMovementItem[];
      expect(Array.isArray(movements)).toBe(true);
      expect(movements.length).toBe(2);

      // Orden descendente (el más reciente primero)
      expect(movements[0]?.delta).toBe(-2);
      expect(movements[0]?.reason).toBe('damage');
      expect(movements[0]?.notes).toBe('Vencido');
      expect(movements[0]?.productName).toBe('Chocolate con Maní 100g');
      expect(movements[0]?.branchName).toBe('Sucursal Central');

      expect(movements[1]?.delta).toBe(30);
      expect(movements[1]?.reason).toBe('inventory_count');

      // Filtrar por motivo (damage)
      const filterRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock/kardex?reason=damage`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(filterRes.status).toBe(200);
      const filterMovements = filterRes.body as unknown as KardexMovementItem[];
      expect(filterMovements.length).toBe(1);
      expect(filterMovements[0]?.delta).toBe(-2);
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
      const keyBody = keyRes.body as unknown as { rawKey: string };
      const posRawKey = keyBody.rawKey;

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
      const pullBody = pullRes.body as unknown as { stock: Array<{ productId: string; quantity: number }> };
      const stockItem = pullBody.stock.find(
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

      const matrixList = matrixAfterSale.body as unknown as StockMatrixItem[];
      const chocoStock = matrixList.find((p) => p.productId === testProductId);
      expect(chocoStock?.branches[defaultBranchId]).toBe(97);
      expect(chocoStock?.totalStock).toBe(97);

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
