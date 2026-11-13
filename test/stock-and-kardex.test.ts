import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { StockService } from '../src/server/stock/stock-service.ts';
import { writeStock } from '../src/server/stock/write-stock.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

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
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-stock-test';
  let defaultBranchId: string;
  let secondBranchId: string;
  let testProductId: string;

  beforeEach(async () => {
    tenantManager = new TenantManager(db());
    const created = createApp({ database: db(), tenantManager });
    app = created.app;

    // 1. Registrar usuario administrador
    const registerRes = await created.authService.createUser({
      email: 'owner@stock.test',
      password: 'password123',
      name: 'Dueño Stock',
    });
    adminToken = registerRes.token;

    // 2. Crear tenant sin seed
    await tenantManager.createTenant({
      id: tenantId,
      slug: 'kiosco-stock-test',
      name: 'Kiosco Stock Test',
      ownerUserId: registerRes.user.id,
      seedDemoData: false,
    });
    // Con bono: las ventas con fechas fijas no dejan al comercio restringido cuando pase la gracia (#21)
    await created.billing.grantSignupBonus(tenantId, registerRes.user.id);

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

  describe('Stock sobre PostgreSQL (fase 4)', () => {
    const adjust = (body: Record<string, unknown>) =>
      request(app).post(`/api/tenants/${tenantId}/stock/adjust`).set('Authorization', `Bearer ${adminToken}`).send(body);

    it('varios ajustes relativos a la vez no se pisan: la suma se hace en la base', async () => {
      const service = new StockService(db().forTenant(tenantId));
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.adjustStock({ productId: testProductId, branchId: defaultBranchId, type: 'delta', quantity: 1, reason: 'purchase' }),
        ),
      );

      const matrix = await service.getStockMatrix();
      expect(matrix[0]?.branches[defaultBranchId]).toBe(5);
      // Cada ajuste vio el stock que dejó el anterior: el kardex cuadra con el stock
      expect(results.map((r) => r.newQuantity).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
      expect(results.every((r) => r.delta === 1 && r.newQuantity - r.previousQuantity === 1)).toBe(true);
    });

    it('un "set" a la vez que otros ajustes deja un kardex que suma el stock final', async () => {
      const service = new StockService(db().forTenant(tenantId));
      await Promise.all([
        service.adjustStock({ productId: testProductId, branchId: defaultBranchId, type: 'delta', quantity: 7, reason: 'purchase' }),
        service.adjustStock({ productId: testProductId, branchId: defaultBranchId, type: 'set', quantity: 20, reason: 'inventory_count' }),
        service.adjustStock({ productId: testProductId, branchId: defaultBranchId, type: 'delta', quantity: -2, reason: 'damage' }),
      ]);

      const matrix = await service.getStockMatrix();
      const kardex = await service.getKardex({ productId: testProductId });
      expect(kardex).toHaveLength(3);
      expect(kardex.reduce((sum, m) => sum + m.delta, 0)).toBe(matrix[0]?.totalStock);
    });

    it('las cantidades se guardan con 4 decimales, sin ruido de coma flotante', async () => {
      const first = await adjust({ productId: testProductId, branchId: defaultBranchId, type: 'set', quantity: 0.1, reason: 'purchase' });
      expect(first.status).toBe(200);
      const second = await adjust({ productId: testProductId, branchId: defaultBranchId, type: 'delta', quantity: 0.2, reason: 'purchase' });
      expect(second.body).toMatchObject({ previousQuantity: 0.1, delta: 0.2, newQuantity: 0.3 });

      // Más de 4 decimales: redondea la columna, y el kardex guarda lo que de verdad cambió
      const third = await adjust({ productId: testProductId, branchId: defaultBranchId, type: 'delta', quantity: 1.23456, reason: 'purchase' });
      expect(third.body).toMatchObject({ previousQuantity: 0.3, delta: 1.2346, newQuantity: 1.5346 });

      const tenantDb = db().forTenant(tenantId);
      const stock = await tenantDb
        .selectFrom('stock')
        .select('quantity')
        .where('product_id', '=', testProductId)
        .where('branch_id', '=', defaultBranchId)
        .executeTakeFirstOrThrow();
      expect(stock.quantity).toBe(1.5346);
    });

    it('una cantidad que no entra en la columna da 400 y no cambia nada', async () => {
      const res = await adjust({ productId: testProductId, branchId: defaultBranchId, type: 'set', quantity: 1e12, reason: 'purchase' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Cantidad inválida' });

      const service = new StockService(db().forTenant(tenantId));
      expect(await service.getKardex()).toEqual([]);
      expect((await service.getStockMatrix())[0]?.totalStock).toBe(0);
    });

    it('el ajuste dentro de una transacción ajena se deshace con ella', async () => {
      const tenantDb = db().forTenant(tenantId);
      const service = new StockService(tenantDb);

      await expect(
        tenantDb.transaction().execute(async (trx) => {
          await service.adjustStock({ productId: testProductId, branchId: defaultBranchId, type: 'set', quantity: 9, reason: 'purchase' }, trx);
          throw new Error('se deshace');
        }),
      ).rejects.toThrow('se deshace');

      expect(await service.getKardex()).toEqual([]);
      expect((await service.getStockMatrix())[0]?.totalStock).toBe(0);
    });

    it('el kardex desempata dos movimientos del mismo instante por orden de llegada, también por tramos', async () => {
      const tenantDb = db().forTenant(tenantId);
      const now = new Date().toISOString();
      for (const quantity of [1, 2, 3, 4]) {
        await writeStock(tenantDb, { productId: testProductId, branchId: defaultBranchId, type: 'delta', quantity, reason: 'purchase', now });
      }

      const service = new StockService(tenantDb);
      expect((await service.getKardex()).map((m) => m.delta)).toEqual([4, 3, 2, 1]);
      const firstPage = await service.getKardex({ limit: 2 });
      const secondPage = await service.getKardex({ limit: 2, offset: 2 });
      expect([...firstPage, ...secondPage].map((m) => m.delta)).toEqual([4, 3, 2, 1]);
    });

    it('guarda y lista el stock de un producto que el comercio no tiene (sin FK)', async () => {
      const tenantDb = db().forTenant(tenantId);
      const written = await writeStock(tenantDb, {
        productId: 'prod-de-otro-lado',
        branchId: defaultBranchId,
        type: 'delta',
        quantity: -2,
        reason: 'sale',
        now: new Date().toISOString(),
      });
      expect(written).toMatchObject({ previousQuantity: 0, delta: -2, newQuantity: -2 });

      const kardex = await new StockService(tenantDb).getKardex({ productId: 'prod-de-otro-lado' });
      expect(kardex).toHaveLength(1);
      expect(kardex[0]).toMatchObject({ productName: 'Producto Desconocido', sku: '', branchName: 'Sucursal Central', delta: -2 });
    });

    it('filtra el kardex por instante y rechaza una fecha ilegible con 400', async () => {
      await adjust({ productId: testProductId, branchId: defaultBranchId, type: 'set', quantity: 3, reason: 'purchase' });
      const kardexUrl = `/api/tenants/${tenantId}/stock/kardex`;

      const past = await request(app).get(`${kardexUrl}?to=2000-01-01T00:00:00Z`).set('Authorization', `Bearer ${adminToken}`);
      expect(past.body).toEqual([]);
      const since = await request(app).get(`${kardexUrl}?from=2000-01-01T00:00:00Z`).set('Authorization', `Bearer ${adminToken}`);
      expect(since.body).toHaveLength(1);

      const invalid = await request(app).get(`${kardexUrl}?from=ayer`).set('Authorization', `Bearer ${adminToken}`);
      expect(invalid.status).toBe(400);
    });

    it('la búsqueda de la matriz no distingue tildes y encuentra por código de barras', async () => {
      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'JUICE-01', name: 'Jugo de Naranja 1L', price: 1200, barcodes: ['7790001112223'] });

      const byAccent = await request(app).get(`/api/tenants/${tenantId}/stock?search=mani`).set('Authorization', `Bearer ${adminToken}`);
      expect((byAccent.body as StockMatrixItem[]).map((p) => p.sku)).toEqual(['CHOCO-01']);
      const byBarcode = await request(app).get(`/api/tenants/${tenantId}/stock?search=1112223`).set('Authorization', `Bearer ${adminToken}`);
      expect((byBarcode.body as StockMatrixItem[]).map((p) => p.sku)).toEqual(['JUICE-01']);
    });
  });

  describe('Integración Bidireccional con POS y Kardex', () => {
    it('ajuste en ERP se refleja en el pull del POS, y una venta del POS aparece en el Kardex del ERP', async () => {
      // 1. Crear API Key de POS
      const keyRes = await request(app)
        .post(`/api/tenants/${tenantId}/pos-registers`)
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
        .set('X-POS-Contract-Version', '4.2.0')
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
        .set('X-POS-Contract-Version', '4.2.0')
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
