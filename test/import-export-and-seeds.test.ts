import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

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

interface ImportResult {
  dryRun: boolean;
  totalRows?: number;
  importedCount: number;
  failedCount?: number;
  updatedCount?: number;
  errors?: Array<{ row: number; error: string }>;
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
    const registerRes = created.authService.register({
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

  describe('Importación CSV y JSON (/import/:entity)', () => {
    it('importa productos desde JSON con previsualización (dryRun: true) y reporte de errores', async () => {
      const payload = {
        dryRun: true,
        items: [
          { sku: 'IMP-01', name: 'Harina 000 1kg', price: 950, category: 'Almacén' },
          { sku: 'IMP-02', name: 'Azúcar Común 1kg', price: 1100, category: 'Almacén' },
          { sku: 'IMP-03', name: 'Producto Inválido', price: -50 }, // Precio negativo inválido
        ],
      };

      const res = await request(app)
        .post(`/api/tenants/${tenantId}/import/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      const body = res.body as unknown as ImportResult;
      expect(body.dryRun).toBe(true);
      expect(body.totalRows).toBe(3);
      expect(body.importedCount).toBe(2);
      expect(body.failedCount).toBe(1);
      expect(body.errors).toHaveLength(1);
      expect(body.errors?.[0]?.row).toBe(3);

      // Comprobar que no se insertaron por ser dryRun
      const getRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);
      const list = getRes.body as unknown as ProductItem[];
      expect(list).toHaveLength(0);
    });

    it('importa productos desde un archivo/texto CSV real persistiendo en la base', async () => {
      const csvContent = [
        'sku,name,price,category,barcodes',
        'CSV-01,"Galletitas de Agua",750,Almacén,779001',
        'CSV-02,"Mermelada de Frutilla",1800,Dulces,779002;779003',
      ].join('\n');

      const res = await request(app)
        .post(`/api/tenants/${tenantId}/import/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          csv: csvContent,
          dryRun: false,
        });

      expect(res.status).toBe(200);
      const body = res.body as unknown as ImportResult;
      expect(body.dryRun).toBe(false);
      expect(body.importedCount).toBe(2);
      expect(body.failedCount).toBe(0);

      // Verificar en base de datos
      const listRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const list = listRes.body as unknown as ProductItem[];
      expect(list).toHaveLength(2);
      const mermelada = list.find((p) => p.sku === 'CSV-02');
      expect(mermelada?.price).toBe(1800);
      expect(mermelada?.barcodes).toEqual(['779002', '779003']);
    });

    it('actualiza productos existentes por SKU si updateExisting es true', async () => {
      // 1. Crear producto
      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'UPD-01', name: 'Nombre Viejo', price: 500 });

      // 2. Importar actualización
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/import/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          items: [{ sku: 'UPD-01', name: 'Nombre Renovado', price: 650 }],
          updateExisting: true,
          dryRun: false,
        });

      expect(res.status).toBe(200);
      const body = res.body as unknown as ImportResult;
      expect(body.updatedCount).toBe(1);
      expect(body.importedCount).toBe(0);

      const checkRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const list = checkRes.body as unknown as ProductItem[];
      const prod = list.find((p) => p.sku === 'UPD-01');
      expect(prod?.name).toBe('Nombre Renovado');
      expect(prod?.price).toBe(650);
    });

    it('importa clientes desde CSV con documentos y límites de crédito', async () => {
      const csvContent = [
        'name,document,phone,creditLimit,margin',
        '"Ignacio Copani",20-11223344-9,11-5566-7788,40000,8000',
        '"Sandra Mihanovich",27-22334455-8,,25000,5000',
      ].join('\n');

      const res = await request(app)
        .post(`/api/tenants/${tenantId}/import/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          csv: csvContent,
          dryRun: false,
        });

      expect(res.status).toBe(200);
      const body = res.body as unknown as ImportResult;
      expect(body.importedCount).toBe(2);

      const listRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`);

      const list = listRes.body as unknown as CustomerItem[];
      expect(list).toHaveLength(2);
      expect((list[0]?.creditLimit ?? 0)).toBeGreaterThanOrEqual(25000);
    });
  });

  describe('Semillas de Negocio Preconfiguradas (/seed-preset)', () => {
    it('aplica el preset de "kiosco" poblando productos y categorías representativas', async () => {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/seed-preset`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ preset: 'kiosco' });

      expect(res.status).toBe(200);
      const body = res.body as unknown as PresetResult;
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
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/seed-preset`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ preset: 'ferreteria' });

      expect(res.status).toBe(200);
      const body = res.body as unknown as PresetResult;
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
