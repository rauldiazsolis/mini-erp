import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('Operaciones Masivas (Etapa 2.4)', () => {
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-bulk-test';

  beforeEach(async () => {
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
      expect(previewRes.body.dryRun).toBe(true);
      expect(previewRes.body.affectedCount).toBe(2);
      expect(previewRes.body.items).toHaveLength(2);

      const cola = previewRes.body.items.find((i: { sku: string }) => i.sku === 'BEB-01');
      expect(cola.oldPrice).toBe(1000);
      expect(cola.newPrice).toBe(1100);
      expect(cola.diff).toBe(100);

      // Comprobar que en la base de datos sigue el precio original
      const getRes = await request(app)
        .get(`/api/tenants/${tenantId}/products?category=Bebidas`)
        .set('Authorization', `Bearer ${adminToken}`);

      const colaDb = getRes.body.find((p: { sku: string }) => p.sku === 'BEB-01');
      expect(colaDb.price).toBe(1000);
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
      expect(applyRes.body.dryRun).toBe(false);
      expect(applyRes.body.affectedCount).toBe(3);

      // Verificar que los precios cambiaron en la base
      const prodRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const cola = prodRes.body.find((p: { sku: string }) => p.sku === 'BEB-01');
      const agua = prodRes.body.find((p: { sku: string }) => p.sku === 'BEB-02');
      expect(cola.price).toBe(1150);
      expect(agua.price).toBe(900); // 920 redondeado a múltiplo de 50 -> 900
    });

    it('aplica actualización de precios a partir de una lista explícita de items (como en una grilla Excel)', async () => {
      const prodRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      const idCola = prodRes.body.find((p: { sku: string }) => p.sku === 'BEB-01').id;
      const idAlfajor = prodRes.body.find((p: { sku: string }) => p.sku === 'GOL-01').id;

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
      expect(itemsRes.body.affectedCount).toBe(2);

      const checkRes = await request(app)
        .get(`/api/tenants/${tenantId}/products`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(checkRes.body.find((p: { id: string }) => p.id === idCola).price).toBe(1450);
      expect(checkRes.body.find((p: { id: string }) => p.id === idAlfajor).price).toBe(1600);
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
      cust1Id = c1.body.id;

      // Cliente 2: Deuda menor de $1,000
      const c2 = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Cliente Deudor Menor', initialBalance: 1000 });
      cust2Id = c2.body.id;

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
      expect(previewRes.body.dryRun).toBe(true);
      expect(previewRes.body.affectedCount).toBe(1);
      expect(previewRes.body.totalInterestAmount).toBe(500); // 5% de 10000

      const item = previewRes.body.items[0];
      expect(item.customerId).toBe(cust1Id);
      expect(item.currentBalance).toBe(10000);
      expect(item.interestAmount).toBe(500);
      expect(item.newBalance).toBe(10500);

      // Comprobar que en la base el cliente sigue teniendo saldo 10000
      const getRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${cust1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.body.balance).toBe(10000);
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
      expect(applyRes.body.dryRun).toBe(false);
      expect(applyRes.body.affectedCount).toBe(2);
      expect(applyRes.body.totalInterestAmount).toBe(1100); // 1000 (c1) + 100 (c2)

      // Verificar saldos actualizados
      const c1Res = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${cust1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(c1Res.body.balance).toBe(11000);

      const c2Res = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${cust2Id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(c2Res.body.balance).toBe(1100);

      // Verificar que se registró el asiento contable con type: 'interest'
      const movsRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${cust1Id}/movements`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(movsRes.body[0]?.type).toBe('interest');
      expect(movsRes.body[0]?.amount).toBe(1000);
      expect(movsRes.body[0]?.balanceAfter).toBe(11000);
      expect(movsRes.body[0]?.description).toBe('Recargo 10% mora fin de mes');
    });
  });
});
