import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

interface BulkPricesResponse {
  dryRun: boolean;
  affectedCount: number;
  items?: Array<{
    id?: string;
    sku: string;
    oldPrice: number;
    newPrice: number;
    diff: number;
  }>;
}

interface ProductItem {
  id: string;
  sku: string;
  name: string;
  price: number;
  category?: string;
}

interface BulkInterestsResponse {
  dryRun: boolean;
  affectedCount: number;
  totalInterestAmount: number;
  items?: Array<{
    customerId: string;
    currentBalance: number;
    interestAmount: number;
    newBalance: number;
  }>;
}

interface CustomerItem {
  id: string;
  balance: number;
}

interface MovementItem {
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
}

describe('Operaciones Masivas (Etapa 2.4)', () => {
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-bulk-test';

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const created = createApp({ systemDb, tenantManager });
    app = created.app;

    // 1. Registrar usuario administrador
    const registerRes = created.authService.register({
      email: 'admin@bulk.test',
      password: 'password123',
      name: 'Admin Bulk',
    });
    adminToken = registerRes.token;

    // 2. Crear tenant sin seed para controlar exactamente los datos
    tenantManager.createTenant({
      id: tenantId,
      slug: 'kiosco-bulk-test',
      name: 'Kiosco Bulk Test',
      ownerUserId: registerRes.user.id,
      seedDemoData: false,
    });
  });

  describe('Actualización Masiva de Precios (/bulk/prices)', () => {
    beforeEach(async () => {
      // Crear productos en distintas categorías
      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'BEB-01', name: 'Gaseosa Cola 500ml', price: 1000, category: 'Bebidas' });

      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'BEB-02', name: 'Agua Mineral 500ml', price: 800, category: 'Bebidas' });

      await request(app)
        .post(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ sku: 'GOL-01', name: 'Alfajor Triple', price: 1200, category: 'Golosinas' });
    });

    it('permite previsualizar un aumento porcentual por categoría (dryRun: true) sin alterar la base', async () => {
      const previewRes = await request(app)
        .post(`/api/tenants/${tenantId}/bulk/prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'percentage',
          value: 10, // +10%
          category: 'Bebidas',
          dryRun: true,
        });

      expect(previewRes.status).toBe(200);
      const previewBody = previewRes.body as unknown as BulkPricesResponse;
      expect(previewBody.dryRun).toBe(true);
      expect(previewBody.affectedCount).toBe(2);
      expect(previewBody.items).toHaveLength(2);

      const cola = previewBody.items?.find((i) => i.sku === 'BEB-01');
      expect(cola?.oldPrice).toBe(1000);
      expect(cola?.newPrice).toBe(1100);
      expect(cola?.diff).toBe(100);

      // Comprobar que en la base de datos sigue el precio original
      const getRes = await request(app)
        .get(`/api/tenants/${tenantId}/products?category=Bebidas`)
        .set('Authorization', `Bearer ${adminToken}`);

      const products = getRes.body as unknown as ProductItem[];
      const colaDb = products.find((p) => p.sku === 'BEB-01');
      expect(colaDb?.price).toBe(1000);
    });

    it('aplica un aumento porcentual persistente y redondeo a la decena más cercana', async () => {
      // 1000 + 15% = 1150; 800 + 15% = 920; 1200 + 15% = 1380
      const applyRes = await request(app)
        .post(`/api/tenants/${tenantId}/bulk/prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'percentage',
          value: 15,
          rounding: '50',
          dryRun: false,
        });

      expect(applyRes.status).toBe(200);
      const applyBody = applyRes.body as unknown as BulkPricesResponse;
      expect(applyBody.dryRun).toBe(false);
      expect(applyBody.affectedCount).toBe(3);

      // Verificar que los precios cambiaron en la base
      const prodRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const products = prodRes.body as unknown as ProductItem[];
      const cola = products.find((p) => p.sku === 'BEB-01');
      const agua = products.find((p) => p.sku === 'BEB-02');
      expect(cola?.price).toBe(1150);
      expect(agua?.price).toBe(900); // 920 redondeado a múltiplo de 50 -> 900
    });

    it('aplica actualización de precios a partir de una lista explícita de items (como en una grilla Excel)', async () => {
      const prodRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const products = prodRes.body as unknown as ProductItem[];
      const idCola = products.find((p) => p.sku === 'BEB-01')?.id ?? '';
      const idAlfajor = products.find((p) => p.sku === 'GOL-01')?.id ?? '';

      const itemsRes = await request(app)
        .post(`/api/tenants/${tenantId}/bulk/prices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'items',
          items: [
            { id: idCola, price: 1450 },
            { id: idAlfajor, price: 1600 },
          ],
          dryRun: false,
        });

      expect(itemsRes.status).toBe(200);
      const itemsBody = itemsRes.body as unknown as BulkPricesResponse;
      expect(itemsBody.affectedCount).toBe(2);

      const checkRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const updatedProducts = checkRes.body as unknown as ProductItem[];
      expect(updatedProducts.find((p) => p.id === idCola)?.price).toBe(1450);
      expect(updatedProducts.find((p) => p.id === idAlfajor)?.price).toBe(1600);
    });
  });

  describe('Cálculo Masivo de Intereses en Cuentas Corrientes (/bulk/interests)', () => {
    let cust1Id: string;
    let cust2Id: string;

    beforeEach(async () => {
      // Cliente 1: Deuda de $10,000
      const c1 = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Cliente Deudor Mayor', initialBalance: 10000 });
      const c1Body = c1.body as unknown as CustomerItem;
      cust1Id = c1Body.id;

      // Cliente 2: Deuda menor de $1,000
      const c2 = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Cliente Deudor Menor', initialBalance: 1000 });
      const c2Body = c2.body as unknown as CustomerItem;
      cust2Id = c2Body.id;

      // Cliente 3: Sin deuda (saldo 0)
      await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Cliente Al Día', initialBalance: 0 });
    });

    it('permite previsualizar el cálculo de intereses (dryRun: true) con umbral mínimo', async () => {
      // Interés del 5% a clientes con deuda >= $2000
      const previewRes = await request(app)
        .post(`/api/tenants/${tenantId}/bulk/interests`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          interestRatePercent: 5,
          minimumBalance: 2000,
          description: 'Interés 5% mensual',
          dryRun: true,
        });

      expect(previewRes.status).toBe(200);
      const previewBody = previewRes.body as unknown as BulkInterestsResponse;
      expect(previewBody.dryRun).toBe(true);
      expect(previewBody.affectedCount).toBe(1);
      expect(previewBody.totalInterestAmount).toBe(500); // 5% de 10000

      const item = previewBody.items?.[0];
      expect(item?.customerId).toBe(cust1Id);
      expect(item?.currentBalance).toBe(10000);
      expect(item?.interestAmount).toBe(500);
      expect(item?.newBalance).toBe(10500);

      // Comprobar que en la base el cliente sigue teniendo saldo 10000
      const getRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${cust1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const cust = getRes.body as unknown as CustomerItem;
      expect(cust.balance).toBe(10000);
    });

    it('aplica el interés masivo a todos los deudores y asienta los movimientos en cuenta corriente', async () => {
      // 5% a todos los que tengan deuda > 0
      const applyRes = await request(app)
        .post(`/api/tenants/${tenantId}/bulk/interests`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          interestRatePercent: 10, // 10%
          description: 'Recargo 10% mora fin de mes',
          dryRun: false,
        });

      expect(applyRes.status).toBe(200);
      const applyBody = applyRes.body as unknown as BulkInterestsResponse;
      expect(applyBody.dryRun).toBe(false);
      expect(applyBody.affectedCount).toBe(2);
      expect(applyBody.totalInterestAmount).toBe(1100); // 1000 (c1) + 100 (c2)

      // Verificar saldos actualizados
      const c1Res = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${cust1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const c1 = c1Res.body as unknown as CustomerItem;
      expect(c1.balance).toBe(11000);

      const c2Res = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${cust2Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const c2 = c2Res.body as unknown as CustomerItem;
      expect(c2.balance).toBe(1100);

      // Verificar que se registró el asiento contable con type: 'interest'
      const movsRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${cust1Id}/movements`)
        .set('Authorization', `Bearer ${adminToken}`);

      const movements = movsRes.body as unknown as MovementItem[];
      expect(movements[0]?.type).toBe('interest');
      expect(movements[0]?.amount).toBe(1000);
      expect(movements[0]?.balanceAfter).toBe(11000);
      expect(movements[0]?.description).toBe('Recargo 10% mora fin de mes');
    });
  });
});
