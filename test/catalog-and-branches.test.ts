import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

interface BranchItem {
  id: string;
  name: string;
  code: string;
}

interface ProductItem {
  id: string;
  sku: string;
  name: string;
  price: number;
  category?: string;
  barcodes?: string[];
  tracksStock?: boolean;
  blockedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ConnectorPullProductsResponse {
  products: {
    items: Array<{ id: string; sku: string; price: number; name: string }>;
    nextCursor?: string;
  };
}

describe('Catálogo, Precios y Sucursales (Etapa 2.1)', () => {
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-central';

  beforeEach(async () => {
    tenantManager = new TenantManager(db());
    const created = createApp({ database: db(), tenantManager });
    app = created.app;

    // 1. Registrar usuario administrador (primer usuario es root)
    const registerRes = await created.authService.createUser({
      email: 'admin@tienda.com',
      password: 'password123',
      name: 'Dueño Tienda',
    });
    adminToken = registerRes.token;

    // 2. Crear tenant sin seed para pruebas limpias
    await tenantManager.createTenant({
      id: tenantId,
      slug: 'kiosco-central',
      name: 'Kiosco Central',
      ownerUserId: registerRes.user.id,
      seedDemoData: false,
    });
  });

  describe('Sucursales (/branches)', () => {
    it('permite listar la sucursal por defecto y crear nuevas sucursales', async () => {
      // 1. Listar sucursales existentes (por defecto viene branch-central)
      const listRes = await request(app)
        .get(`/api/tenants/${tenantId}/branches`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listRes.status).toBe(200);
      const branches = listRes.body as unknown as BranchItem[];
      expect(Array.isArray(branches)).toBe(true);
      expect(branches.length).toBe(1);
      expect(branches[0]?.code).toBe('CENTRAL');

      // 2. Crear nueva sucursal
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/branches`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Sucursal Norte',
          code: 'NORTE',
        });

      expect(createRes.status).toBe(201);
      const createdBranch = createRes.body as unknown as BranchItem;
      expect(createdBranch.code).toBe('NORTE');
      expect(createdBranch.name).toBe('Sucursal Norte');
      expect(createdBranch.id).toBeDefined();

      // 3. Verificar que ahora hay 2 sucursales
      const listAfterRes = await request(app)
        .get(`/api/tenants/${tenantId}/branches`)
        .set('Authorization', `Bearer ${adminToken}`);

      const branchesAfter = listAfterRes.body as unknown as BranchItem[];
      expect(branchesAfter.length).toBe(2);
    });

    it('rechaza crear sucursal con código duplicado o datos inválidos', async () => {
      // Código duplicado
      const duplicateRes = await request(app)
        .post(`/api/tenants/${tenantId}/branches`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Otra Central',
          code: 'CENTRAL',
        });

      expect(duplicateRes.status).toBe(400);
      const duplicateBody = duplicateRes.body as unknown as { error?: string };
      expect(duplicateBody.error).toMatch(/código/i);

      // Nombre vacío
      const invalidRes = await request(app)
        .post(`/api/tenants/${tenantId}/branches`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: '',
          code: 'SUR',
        });

      expect(invalidRes.status).toBe(400);
    });
  });

  describe('Catálogo y Precios (/products)', () => {
    it('permite crear productos con código de barras, categoría y precio', async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'ALM-001',
          name: 'Alfajor Triple Chocolate',
          price: 950.5,
          taxRate: 0.21,
          category: 'Golosinas',
          barcodes: ['7791234567890'],
          tracksStock: true,
        });

      expect(createRes.status).toBe(201);
      const product = createRes.body as unknown as ProductItem;
      expect(product.id).toBeDefined();
      expect(product.sku).toBe('ALM-001');
      expect(product.name).toBe('Alfajor Triple Chocolate');
      expect(product.price).toBe(950.5);
      expect(product.category).toBe('Golosinas');
      expect(product.barcodes).toEqual(['7791234567890']);
      expect(product.tracksStock).toBe(true);
      expect(product.blockedReason).toBeNull();
      expect(product.createdAt).toBeDefined();
      expect(product.updatedAt).toBeDefined();
    });

    it('rechaza crear producto con SKU duplicado o precio negativo', async () => {
      // Crear primero
      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'BEB-001',
          name: 'Agua con Gas 500ml',
          price: 800,
        });

      // Duplicar SKU
      const duplicateRes = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'BEB-001',
          name: 'Agua Sin Gas 500ml',
          price: 800,
        });

      expect(duplicateRes.status).toBe(400);
      const duplicateBody = duplicateRes.body as unknown as { error?: string };
      expect(duplicateBody.error).toMatch(/SKU/i);

      // Precio negativo
      const negativeRes = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'BEB-002',
          name: 'Agua Saborizada',
          price: -50,
        });

      expect(negativeRes.status).toBe(400);
    });

    it('permite listar productos con filtrado por búsqueda y categoría', async () => {
      // Crear 3 productos
      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'BEB-101',
          name: 'Coca Cola 1.5L',
          price: 2500,
          category: 'Bebidas',
          barcodes: ['7790001'],
        });

      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'BEB-102',
          name: 'Sprite 1.5L',
          price: 2400,
          category: 'Bebidas',
          barcodes: ['7790002'],
        });

      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'SNK-201',
          name: 'Papas Fritas 100g',
          price: 1800,
          category: 'Snacks',
          barcodes: ['7790003'],
        });

      // 1. Filtrar por categoría Bebidas
      const catRes = await request(app)
        .get(`/api/tenants/${tenantId}/products?category=Bebidas`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(catRes.status).toBe(200);
      const catProducts = catRes.body as unknown as ProductItem[];
      expect(catProducts.length).toBe(2);

      // 2. Filtrar por término de búsqueda (ej. 'sprite')
      const searchRes = await request(app)
        .get(`/api/tenants/${tenantId}/products?search=sprite`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(searchRes.status).toBe(200);
      const searchProducts = searchRes.body as unknown as ProductItem[];
      expect(searchProducts.length).toBe(1);
      expect(searchProducts[0]?.name).toBe('Sprite 1.5L');

      // 3. Filtrar por código de barras
      const barcodeRes = await request(app)
        .get(`/api/tenants/${tenantId}/products?search=7790003`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(barcodeRes.status).toBe(200);
      const barcodeProducts = barcodeRes.body as unknown as ProductItem[];
      expect(barcodeProducts.length).toBe(1);
      expect(barcodeProducts[0]?.sku).toBe('SNK-201');
    });

    it('permite actualizar un producto y modifica updatedAt', async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'ALM-555',
          name: 'Café Molido 250g',
          price: 4000,
          category: 'Almacén',
        });

      const createBody = createRes.body as unknown as ProductItem;
      const prodId = createBody.id;
      const originalUpdatedAt = createBody.updatedAt;

      // Esperar breve tick para asegurar que timestamp ISO difiera si corre rápido
      await new Promise((r) => setTimeout(r, 10));

      const updateRes = await request(app)
        .put(`/api/tenants/${tenantId}/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          price: 4500,
          name: 'Café Molido Premium 250g',
        });

      expect(updateRes.status).toBe(200);
      const updateBody = updateRes.body as unknown as ProductItem;
      expect(updateBody.price).toBe(4500);
      expect(updateBody.name).toBe('Café Molido Premium 250g');
      expect(updateBody.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('permite archivar/bloquear un producto (soft delete)', async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'DISC-001',
          name: 'Producto Discontinuado',
          price: 100,
        });

      const createBody = createRes.body as unknown as ProductItem;
      const prodId = createBody.id;

      // Bloquear
      const deleteRes = await request(app)
        .delete(`/api/tenants/${tenantId}/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Discontinuado por proveedor' });

      expect(deleteRes.status).toBe(200);
      const deleteBody = deleteRes.body as unknown as { blockedReason?: string };
      expect(deleteBody.blockedReason).toBe('Discontinuado por proveedor');

      // Consultar detalle
      const getRes = await request(app)
        .get(`/api/tenants/${tenantId}/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.status).toBe(200);
      const getBody = getRes.body as unknown as { blockedReason?: string };
      expect(getBody.blockedReason).toBe('Discontinuado por proveedor');
    });

    it('devuelve las categorías únicas ordenadas', async () => {
      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'P1', name: 'Prod 1', price: 10, category: 'Bebidas' });

      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'P2', name: 'Prod 2', price: 20, category: 'Limpieza' });

      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'P3', name: 'Prod 3', price: 30, category: 'Bebidas' });

      const catRes = await request(app)
        .get(`/api/tenants/${tenantId}/categories`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(catRes.status).toBe(200);
      expect(catRes.body).toEqual(['Bebidas', 'Limpieza']);
    });
  });

  describe('Importes del admin (PostgreSQL, fase 4)', () => {
    it('rechaza un precio con más de 2 decimales al crear', async () => {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'DEC-001', name: 'Con tres decimales', price: 10.125 });

      expect(res.status).toBe(400);
      expect((res.body as unknown as { error?: string }).error).toBe('Importe inválido');

      const list = await request(app).get(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${adminToken}`);
      expect(list.body).toHaveLength(0);
    });

    it('rechaza un precio con más de 2 decimales al editar y deja el anterior', async () => {
      const created = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'DEC-002', name: 'Con dos decimales', price: 10.15 });
      expect(created.status).toBe(201);
      const prodId = (created.body as unknown as ProductItem).id;

      const res = await request(app)
        .put(`/api/tenants/${tenantId}/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 10.155 });
      expect(res.status).toBe(400);
      expect((res.body as unknown as { error?: string }).error).toBe('Importe inválido');

      const after = await request(app).get(`/api/tenants/${tenantId}/products/${prodId}`).set('Authorization', `Bearer ${adminToken}`);
      expect((after.body as unknown as ProductItem).price).toBe(10.15);
    });

    it('el precio cero sigue valiendo, al crear y al editar', async () => {
      const created = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'DEC-003', name: 'Gratis', price: 0 });
      expect(created.status).toBe(201);
      const product = created.body as unknown as ProductItem;
      expect(product.price).toBe(0);

      const updated = await request(app)
        .put(`/api/tenants/${tenantId}/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 0 });
      expect(updated.status).toBe(200);
      expect((updated.body as unknown as ProductItem).price).toBe(0);
    });
  });

  describe('Datos en PostgreSQL (fase 4)', () => {
    it('crear un producto que controla stock deja su stock en 0 en cada sucursal, y una sucursal nueva también', async () => {
      const created = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'STK-001', name: 'Con stock', price: 100 });
      const sinStock = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'STK-002', name: 'Sin stock', price: 100, tracksStock: false });
      const prodId = (created.body as unknown as ProductItem).id;
      expect((sinStock.body as unknown as ProductItem).tracksStock).toBe(false);

      const branch = await request(app)
        .post(`/api/tenants/${tenantId}/branches`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Sucursal Norte', code: 'NORTE' });
      const branchId = (branch.body as unknown as BranchItem).id;

      const stock = await db()
        .forTenant(tenantId)
        .selectFrom('stock')
        .select(['product_id', 'branch_id', 'quantity'])
        .orderBy('branch_id')
        .execute();
      expect(stock).toEqual(
        [
          { product_id: prodId, branch_id: 'branch-central', quantity: 0 },
          { product_id: prodId, branch_id: branchId, quantity: 0 },
        ].sort((a, b) => (a.branch_id < b.branch_id ? -1 : 1)),
      );
    });

    it('el borrado definitivo borra el producto y su stock, y deja el kardex', async () => {
      const created = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'DEL-001', name: 'Para borrar', price: 100 });
      const otro = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'DEL-002', name: 'Se queda', price: 100 });
      const prodId = (created.body as unknown as ProductItem).id;
      const otroId = (otro.body as unknown as ProductItem).id;

      const tenantDb = db().forTenant(tenantId);
      await tenantDb
        .insertInto('stock_movements')
        .values({
          id: 'mov-1',
          product_id: prodId,
          branch_id: 'branch-central',
          delta: 5,
          reason: 'inventory_count',
          created_at: new Date().toISOString(),
        })
        .execute();

      const deleteRes = await request(app)
        .delete(`/api/tenants/${tenantId}/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hard: true });
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toEqual({ deleted: true });

      const getRes = await request(app).get(`/api/tenants/${tenantId}/products/${prodId}`).set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.status).toBe(404);

      const stock = await tenantDb.selectFrom('stock').select(['product_id']).execute();
      expect(stock).toEqual([{ product_id: otroId }]);
      const kardex = await tenantDb.selectFrom('stock_movements').select(['id', 'product_id']).execute();
      expect(kardex).toEqual([{ id: 'mov-1', product_id: prodId }]);
    });

    it('borrar un producto que no existe da 400', async () => {
      const res = await request(app)
        .delete(`/api/tenants/${tenantId}/products/no-existe`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hard: true });
      expect(res.status).toBe(400);
      expect((res.body as unknown as { error?: string }).error).toMatch(/no encontrado/);
    });

    it('rechaza cambiar el SKU o el código de sucursal a uno que ya existe', async () => {
      await request(app).post(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${adminToken}`).send({ sku: 'UNI-1', name: 'Uno', price: 1 });
      const dos = await request(app).post(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${adminToken}`).send({ sku: 'UNI-2', name: 'Dos', price: 1 });
      const skuRes = await request(app)
        .put(`/api/tenants/${tenantId}/products/${(dos.body as unknown as ProductItem).id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'UNI-1' });
      expect(skuRes.status).toBe(400);
      expect((skuRes.body as unknown as { error?: string }).error).toBe("Ya existe un producto con el SKU 'UNI-1'");

      const norte = await request(app).post(`/api/tenants/${tenantId}/branches`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'Norte', code: 'NORTE' });
      const codeRes = await request(app)
        .put(`/api/tenants/${tenantId}/branches/${(norte.body as unknown as BranchItem).id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code: 'CENTRAL' });
      expect(codeRes.status).toBe(400);
      expect((codeRes.body as unknown as { error?: string }).error).toBe("Ya existe una sucursal con el código 'CENTRAL'");
    });

    it('lista por nombre y, con el mismo nombre, en orden de alta; busca sin distinguir mayúsculas ni tildes', async () => {
      for (const [sku, name] of [['O-3', 'Café'], ['O-1', 'Azúcar'], ['O-2', 'Café']] as const) {
        await request(app).post(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${adminToken}`).send({ sku, name, price: 1 });
        await new Promise((r) => setTimeout(r, 3));
      }
      const list = await request(app).get(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${adminToken}`);
      expect((list.body as unknown as ProductItem[]).map((p) => p.sku)).toEqual(['O-1', 'O-3', 'O-2']);

      const page = await request(app).get(`/api/tenants/${tenantId}/products?limit=1&offset=1`).set('Authorization', `Bearer ${adminToken}`);
      expect((page.body as unknown as ProductItem[]).map((p) => p.sku)).toEqual(['O-3']);

      const search = await request(app).get(`/api/tenants/${tenantId}/products?search=AZUCAR`).set('Authorization', `Bearer ${adminToken}`);
      expect((search.body as unknown as ProductItem[]).map((p) => p.sku)).toEqual(['O-1']);
    });
  });

  describe('Integración con POS (Connector API sync/pull)', () => {
    it('un producto creado o modificado en el Admin ERP se refleja de inmediato en el pull del POS', async () => {
      // 1. Generar API Key para terminal POS
      const keyRes = await request(app)
        .post(`/api/tenants/${tenantId}/pos-registers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Caja 1',
          branch: 'CENTRAL',
          pointOfSale: 'POS-01',
        });
      const keyBody = keyRes.body as unknown as { rawKey: string };
      const posRawKey = keyBody.rawKey;

      // 2. Crear producto desde el ERP Admin
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sku: 'POS-SYNC-01',
          name: 'Alfajor Marplatense',
          price: 1200,
          category: 'Golosinas',
          barcodes: ['779998877'],
          tracksStock: true,
        });
      expect(createRes.status).toBe(201);
      const createBody = createRes.body as unknown as ProductItem;
      const prodId = createBody.id;

      // 3. El POS realiza sync pull
      const pullRes = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${posRawKey}`)
        .set('X-POS-Contract-Version', '4.2.0')
        .send({
          cursors: {},
          pendingLotIds: [],
        });

      expect(pullRes.status).toBe(200);
      const pullBody = pullRes.body as unknown as ConnectorPullProductsResponse;
      const posProducts = pullBody.products.items;
      const syncedProd = posProducts.find((p) => p.id === prodId);
      expect(syncedProd).toBeDefined();
      expect(syncedProd?.name).toBe('Alfajor Marplatense');
      expect(syncedProd?.price).toBe(1200);

      // 4. Modificar precio en el ERP Admin
      await request(app)
        .put(`/api/tenants/${tenantId}/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          price: 1500,
        });

      // 5. El POS realiza nuevo pull con cursor
      const pullDeltaRes = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${posRawKey}`)
        .set('X-POS-Contract-Version', '4.2.0')
        .send({
          cursors: {
            products: pullBody.products.nextCursor,
          },
          pendingLotIds: [],
        });

      expect(pullDeltaRes.status).toBe(200);
      const pullDeltaBody = pullDeltaRes.body as unknown as ConnectorPullProductsResponse;
      const deltaProducts = pullDeltaBody.products.items;
      const deltaProd = deltaProducts.find((p) => p.id === prodId);
      expect(deltaProd).toBeDefined();
      expect(deltaProd?.price).toBe(1500);
    });
  });
});
