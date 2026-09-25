import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('Catálogo, Precios y Sucursales (Etapa 2.1)', () => {
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-central';

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const created = createApp({ systemDb, tenantManager });
    app = created.app;

    // 1. Registrar usuario administrador (primer usuario es root)
    const registerRes = created.authService.register({
      email: 'admin@tienda.com',
      password: 'password123',
      name: 'Dueño Tienda',
    });
    adminToken = registerRes.token;

    // 2. Crear tenant sin seed para pruebas limpias
    tenantManager.createTenant({
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
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body.length).toBe(1);
      expect(listRes.body[0]?.code).toBe('CENTRAL');

      // 2. Crear nueva sucursal
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/branches`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Sucursal Norte',
          code: 'NORTE',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.code).toBe('NORTE');
      expect(createRes.body.name).toBe('Sucursal Norte');
      expect(createRes.body.id).toBeDefined();

      // 3. Verificar que ahora hay 2 sucursales
      const listAfterRes = await request(app)
        .get(`/api/tenants/${tenantId}/branches`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listAfterRes.body.length).toBe(2);
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
      expect(duplicateRes.body.error).toMatch(/código/i);

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
      expect(createRes.body.id).toBeDefined();
      expect(createRes.body.sku).toBe('ALM-001');
      expect(createRes.body.name).toBe('Alfajor Triple Chocolate');
      expect(createRes.body.price).toBe(950.5);
      expect(createRes.body.category).toBe('Golosinas');
      expect(createRes.body.barcodes).toEqual(['7791234567890']);
      expect(createRes.body.tracksStock).toBe(true);
      expect(createRes.body.blockedReason).toBeNull();
      expect(createRes.body.createdAt).toBeDefined();
      expect(createRes.body.updatedAt).toBeDefined();
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
      expect(duplicateRes.body.error).toMatch(/SKU/i);

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
      expect(catRes.body.length).toBe(2);

      // 2. Filtrar por término de búsqueda (ej. 'sprite')
      const searchRes = await request(app)
        .get(`/api/tenants/${tenantId}/products?search=sprite`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.length).toBe(1);
      expect(searchRes.body[0]?.name).toBe('Sprite 1.5L');

      // 3. Filtrar por código de barras
      const barcodeRes = await request(app)
        .get(`/api/tenants/${tenantId}/products?search=7790003`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(barcodeRes.status).toBe(200);
      expect(barcodeRes.body.length).toBe(1);
      expect(barcodeRes.body[0]?.sku).toBe('SNK-201');
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

      const prodId = createRes.body.id as string;
      const originalUpdatedAt = createRes.body.updatedAt as string;

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
      expect(updateRes.body.price).toBe(4500);
      expect(updateRes.body.name).toBe('Café Molido Premium 250g');
      expect(updateRes.body.updatedAt).not.toBe(originalUpdatedAt);
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

      const prodId = createRes.body.id as string;

      // Bloquear
      const deleteRes = await request(app)
        .delete(`/api/tenants/${tenantId}/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Discontinuado por proveedor' });

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.blockedReason).toBe('Discontinuado por proveedor');

      // Consultar detalle
      const getRes = await request(app)
        .get(`/api/tenants/${tenantId}/products/${prodId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.blockedReason).toBe('Discontinuado por proveedor');
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

  describe('Integración con POS (Connector API sync/pull)', () => {
    it('un producto creado o modificado en el Admin ERP se refleja de inmediato en el pull del POS', async () => {
      // 1. Generar API Key para terminal POS
      const keyRes = await request(app)
        .post(`/api/tenants/${tenantId}/api-keys`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Caja 1',
          branch: 'CENTRAL',
          pointOfSale: 'POS-01',
        });
      const posRawKey = keyRes.body.rawKey as string;

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
      const prodId = createRes.body.id as string;

      // 3. El POS realiza sync pull
      const pullRes = await request(app)
        .post('/connector/sync/pull')
        .set('Authorization', `Bearer ${posRawKey}`)
        .set('X-POS-Contract-Version', '4.0.0')
        .send({
          cursors: {},
          pendingLotIds: [],
        });

      expect(pullRes.status).toBe(200);
      const posProducts = pullRes.body.products.items as Array<{ id: string; sku: string; price: number; name: string }>;
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
        .set('X-POS-Contract-Version', '4.0.0')
        .send({
          cursors: {
            products: pullRes.body.products.nextCursor,
          },
          pendingLotIds: [],
        });

      expect(pullDeltaRes.status).toBe(200);
      const deltaProducts = pullDeltaRes.body.products.items as Array<{ id: string; price: number }>;
      const deltaProd = deltaProducts.find((p) => p.id === prodId);
      expect(deltaProd).toBeDefined();
      expect(deltaProd?.price).toBe(1500);
    });
  });
});
