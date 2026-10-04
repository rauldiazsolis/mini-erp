import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { applyPreset } from '../src/server/seeds/index.ts';

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
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-io-test';

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const created = createApp({ systemDb, tenantManager });
    app = created.app;

    // 1. Registrar usuario administrador
    const registerRes = created.authService.createUser({
      email: 'admin@io.test',
      password: 'password123',
      name: 'Admin IO',
    });
    adminToken = registerRes.token;

    // 2. Crear tenant sin seed para pruebas controladas
    tenantManager.createTenant({
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
  });

  // El alta aplica el preset del rubro (#19): ya no hay endpoint /seed-preset
  describe('Semillas de Negocio Preconfiguradas (applyPreset)', () => {
    it('aplica el preset de "kiosco" poblando productos y categorías representativas', async () => {
      const body: PresetResult = applyPreset(tenantManager.getTenantDb(tenantId), 'kiosco');
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
      const body: PresetResult = applyPreset(tenantManager.getTenantDb(tenantId), 'ferreteria');
      expect(body.preset).toBe('ferreteria');

      const prodRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const products = prodRes.body as unknown as ProductItem[];
      const names = products.map((p) => p.name.toLowerCase());
      expect(names.some((n) => n.includes('martillo') || n.includes('destornillador') || n.includes('cinta'))).toBe(true);
    });
  });
});
