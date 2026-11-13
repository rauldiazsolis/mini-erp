import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { applyPreset } from '../src/server/seeds/index.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

interface ProductItem {
  id?: string;
  sku: string;
  name: string;
  price: number;
  category?: string;
  barcodes?: string[];
}

interface CustomerItem {
  id?: string;
  name: string;
  document?: string;
  phone?: string;
  creditLimit?: number;
}

interface PresetResult {
  preset: string;
  productsCreated: number;
}

describe('Importación, Exportación y Semillas de Negocio (Etapa 2.5)', () => {
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-io-test';

  beforeEach(async () => {
    tenantManager = new TenantManager(db());
    const created = createApp({ database: db(), tenantManager });
    app = created.app;

    // 1. Registrar usuario administrador
    const registerRes = await created.authService.createUser({
      email: 'admin@io.test',
      password: 'password123',
      name: 'Admin IO',
    });
    adminToken = registerRes.token;

    // 2. Crear tenant sin seed para pruebas controladas
    await tenantManager.createTenant({
      id: tenantId,
      slug: 'kiosco-io-test',
      name: 'Kiosco IO Test',
      ownerUserId: registerRes.user.id,
      seedDemoData: false,
    });
  });

  describe('Exportación CSV y JSON (/export/:entity)', () => {
    beforeEach(async () => {
      // Crear 2 productos
      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'ALM-100', name: 'Arroz Blanco 1kg', price: 1500, category: 'Almacén', barcodes: ['779000100'] });

      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'ALM-200', name: 'Fideos Guiseros 500g', price: 1100, category: 'Almacén' });

      // Crear 1 cliente
      await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Juana Manso', document: '27-11223344-5', creditLimit: 20000 });
    });

    it('exporta el catálogo de productos en formato JSON', async () => {
      const res = await request(app)
        .get(`/api/tenants/${tenantId}/export/products?format=json`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const items = res.body as unknown as ProductItem[];
      expect(Array.isArray(items)).toBe(true);
      expect(items).toHaveLength(2);
      expect(items[0]?.sku).toBe('ALM-100');
      expect(items[0]?.name).toBe('Arroz Blanco 1kg');
    });

    it('exporta el catálogo de productos en formato CSV con cabecera y delimitador estándar', async () => {
      const res = await request(app)
        .get(`/api/tenants/${tenantId}/export/products?format=csv`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.text).toContain('sku,name,price,taxRate,category');
      expect(res.text).toContain('ALM-100,Arroz Blanco 1kg,1500,0.21,Almacén');
    });

    it('exporta los clientes en formato CSV y JSON', async () => {
      // JSON
      const jsonRes = await request(app)
        .get(`/api/tenants/${tenantId}/export/customers?format=json`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(jsonRes.status).toBe(200);
      const customers = jsonRes.body as unknown as CustomerItem[];
      expect(customers).toHaveLength(1);
      expect(customers[0]?.name).toBe('Juana Manso');

      // CSV
      const csvRes = await request(app)
        .get(`/api/tenants/${tenantId}/export/customers?format=csv`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(csvRes.status).toBe(200);
      expect(csvRes.text).toContain('id,name,document,phone,creditLimit');
      expect(csvRes.text).toContain('Juana Manso,27-11223344-5,');
    });

    it('el CSV sale entero y en orden estable: por nombre y, con el mismo nombre, por id', async () => {
      const tenantDb = db().forTenant(tenantId);
      const at = '2026-10-03T12:00:00.000Z';
      await tenantDb
        .insertInto('products')
        .values([
          { id: 'p-b', sku: 'Z-2', name: 'Arroz Blanco 1kg', price: 10.5, tax_rate: 0.105, barcodes: '["1","2"]', tracks_stock: false, blocked_reason: 'Sin "stock", vuelve', created_at: at, updated_at: at },
          { id: 'p-a', sku: 'Z-1', name: 'Arroz Blanco 1kg', price: 0, created_at: at, updated_at: at },
        ])
        .execute();
      await tenantDb.insertInto('stock').values({ product_id: 'p-b', branch_id: 'branch-central', quantity: 1.5, updated_at: at }).execute();
      await tenantDb
        .insertInto('customers')
        .values({ id: 'c-a', name: 'Ana, la de enfrente', credit_limit: 100.5, balance: -20.25, unrestricted: true, created_at: at, updated_at: at })
        .execute();

      const get = async (entity: string) =>
        (await request(app).get(`/api/tenants/${tenantId}/export/${entity}?format=csv`).set('Authorization', `Bearer ${adminToken}`)).text;

      const products = (await get('products')).split('\n');
      expect(products[0]).toBe('id,sku,name,price,taxRate,category,barcodes,tracksStock,blockedReason');
      // Los dos primeros productos (creados por la API) tienen ids al azar: se miran los de id fijo
      expect(products.filter((line) => line.startsWith('p-'))).toEqual([
        'p-a,Z-1,Arroz Blanco 1kg,0,0,General,,true,',
        'p-b,Z-2,Arroz Blanco 1kg,10.5,0.105,General,1;2,false,"Sin ""stock"", vuelve"',
      ]);
      expect(products).toHaveLength(5);
      expect(products.at(-1)).toContain('ALM-200,Fideos Guiseros 500g,1100,0.21,Almacén,,true,');

      const customers = (await get('customers')).split('\n');
      expect(customers[0]).toBe('id,name,document,phone,creditLimit,margin,balance,unrestricted,blockedReason');
      expect(customers[1]).toBe('c-a,"Ana, la de enfrente",,,100.5,0,-20.25,true,');
      expect(customers).toHaveLength(3);

      const stock = (await get('stock')).split('\n');
      expect(stock[0]).toBe('productId,sku,productName,branchId,branchCode,branchName,quantity');
      expect(stock).toContain('p-b,Z-2,Arroz Blanco 1kg,branch-central,CENTRAL,Sucursal Central,1.5');
    });
  });

  // El alta aplica el preset del rubro (#19): ya no hay endpoint /seed-preset
  describe('Semillas de Negocio Preconfiguradas (applyPreset)', () => {
    it('aplica el preset de "kiosco" poblando productos y categorías representativas', async () => {
      const body: PresetResult = await applyPreset(db().forTenant(tenantId), 'kiosco');
      expect(body.preset).toBe('kiosco');
      expect(body.productsCreated).toBeGreaterThanOrEqual(6);

      // Verificar que los productos existen y tienen categorías propias de kiosco
      const prodRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const products = prodRes.body as unknown as ProductItem[];
      expect(products.length).toBeGreaterThanOrEqual(6);
      const categories = products.map((p) => p.category);
      expect(categories).toContain('Golosinas');
      expect(categories).toContain('Bebidas');

      // Verificar que el stock fue inicializado en la sucursal por defecto
      const stockRes = await request(app)
        .get(`/api/tenants/${tenantId}/stock`)
        .set('Authorization', `Bearer ${adminToken}`);

      const stockList = stockRes.body as unknown as Array<{ totalStock: number }>;
      expect(stockList.length).toBeGreaterThanOrEqual(6);
      expect(stockList.every((s) => s.totalStock > 0)).toBe(true);
    });

    it('aplica el preset de "ferreteria" con productos y stock inicial correspondientes', async () => {
      const body: PresetResult = await applyPreset(db().forTenant(tenantId), 'ferreteria');
      expect(body.preset).toBe('ferreteria');

      const prodRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const products = prodRes.body as unknown as ProductItem[];
      const names = products.map((p) => p.name.toLowerCase());
      expect(names.some((n) => n.includes('martillo') || n.includes('destornillador') || n.includes('cinta'))).toBe(true);
    });

    it('es idempotente: aplicarlo dos veces no duplica productos ni pisa el stock', async () => {
      const tenantDb = db().forTenant(tenantId);
      const first = await applyPreset(tenantDb, 'almacen');
      expect(first.stockEntries).toBe(first.productsCreated);
      await tenantDb.updateTable('stock').set({ quantity: 1 }).execute();
      expect(await applyPreset(tenantDb, 'almacen')).toEqual({ preset: 'almacen', productsCreated: 0, stockEntries: 0 });
      expect(await tenantDb.selectFrom('products').select('id').execute()).toHaveLength(first.productsCreated);
      expect((await tenantDb.selectFrom('stock').select('quantity').execute()).every((s) => s.quantity === 1)).toBe(true);
    });
  });
});
