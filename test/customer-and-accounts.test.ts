import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('Clientes, Cuentas Corrientes y Ajustes de Saldo (Etapa 2.3)', () => {
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-customers-test';

  beforeEach(async () => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const created = createApp({ systemDb, tenantManager });
    app = created.app;

    // 1. Registrar usuario administrador
    const registerRes = created.authService.register({
      email: 'admin@customers.test',
      password: 'password123',
      name: 'Admin Clientes',
    });
    adminToken = registerRes.token;

    // 2. Crear tenant sin seed para pruebas limpias
    tenantManager.createTenant({
      id: tenantId,
      slug: 'kiosco-customers-test',
      name: 'Kiosco Customers Test',
      ownerUserId: registerRes.user.id,
      seedDemoData: false,
    });
  });

  describe('CRUD de Clientes (/customers)', () => {
    it('permite crear un cliente con límites de crédito y consultar el saldo disponible', async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Roberto Gómez',
          document: '20-33445566-7',
          phone: '11-2233-4455',
          creditLimit: 50000,
          margin: 10000,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.id).toBeDefined();
      expect(createRes.body.name).toBe('Roberto Gómez');
      expect(createRes.body.document).toBe('20-33445566-7');
      expect(createRes.body.creditLimit).toBe(50000);
      expect(createRes.body.margin).toBe(10000);
      expect(createRes.body.balance).toBe(0);
      expect(createRes.body.availableCredit).toBe(60000); // 50000 + 10000 - 0
      expect(createRes.body.isDebtor).toBe(false);
    });

    it('permite crear un cliente con saldo inicial y registra el movimiento de cuenta corriente', async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Ana Laura Díaz',
          creditLimit: 30000,
          margin: 5000,
          initialBalance: 7500,
        });

      expect(createRes.status).toBe(201);
      const customerId = createRes.body.id as string;
      expect(createRes.body.balance).toBe(7500);
      expect(createRes.body.availableCredit).toBe(27500); // 35000 - 7500
      expect(createRes.body.isDebtor).toBe(true);

      // Comprobar que en su extracto existe el movimiento inicial
      const movRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${customerId}/movements`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(movRes.status).toBe(200);
      expect(movRes.body.length).toBe(1);
      expect(movRes.body[0]?.type).toBe('adjustment');
      expect(movRes.body[0]?.amount).toBe(7500);
      expect(movRes.body[0]?.balanceAfter).toBe(7500);
      expect(movRes.body[0]?.description).toMatch(/saldo inicial/i);
    });

    it('permite listar clientes con filtro por búsqueda y estado deudor', async () => {
      // Cliente al día
      await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Carlos Paz', document: '20-11111111-1', initialBalance: 0 });

      // Cliente deudor
      await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Esteban Quito', document: '20-22222222-2', initialBalance: 4000 });

      // 1. Filtrar solo deudores
      const debtorsRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers?debtorsOnly=true`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(debtorsRes.status).toBe(200);
      expect(debtorsRes.body.length).toBe(1);
      expect(debtorsRes.body[0]?.name).toBe('Esteban Quito');

      // 2. Búsqueda por documento
      const searchRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers?search=11111111`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.length).toBe(1);
      expect(searchRes.body[0]?.name).toBe('Carlos Paz');
    });

    it('permite actualizar datos del cliente y bloquearlo (soft delete/bloqueo)', async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Lucas Moyano', creditLimit: 10000 });

      const customerId = createRes.body.id as string;

      // Actualizar datos
      const updateRes = await request(app)
        .put(`/api/tenants/${tenantId}/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Lucas Moyano Jr.',
          creditLimit: 15000,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.name).toBe('Lucas Moyano Jr.');
      expect(updateRes.body.creditLimit).toBe(15000);

      // Bloquear / archivar
      const deleteRes = await request(app)
        .delete(`/api/tenants/${tenantId}/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Exceso de morosidad reiterada' });

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.blockedReason).toBe('Exceso de morosidad reiterada');
    });
  });

  describe('Cuentas Corrientes: Pagos y Ajustes Transparentes', () => {
    let customerId: string;

    beforeEach(async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Martín Fierro',
          creditLimit: 40000,
          margin: 5000,
          initialBalance: 12000,
        });
      customerId = createRes.body.id as string;
    });

    it('registra una cobranza manual y acredita el saldo del cliente', async () => {
      const payRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers/${customerId}/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          amount: 5000,
          method: 'cash',
          reference: 'REC-0001',
          description: 'Pago en efectivo en administración',
        });

      expect(payRes.status).toBe(200);
      expect(payRes.body.previousBalance).toBe(12000);
      expect(payRes.body.amount).toBe(5000);
      expect(payRes.body.newBalance).toBe(7000);
      expect(payRes.body.movementId).toBeDefined();

      // Comprobar cliente actualizado
      const custRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(custRes.body.balance).toBe(7000);
      expect(custRes.body.availableCredit).toBe(38000); // 45000 - 7000
    });

    it('aplica un ajuste manual de saldo auditado (débito, crédito y set)', async () => {
      // 1. Ajuste tipo crédito (-2000) por bonificación
      const creditRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers/${customerId}/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'credit',
          amount: 2000,
          reason: 'Bonificación por pronto pago autorizada',
        });

      expect(creditRes.status).toBe(200);
      expect(creditRes.body.previousBalance).toBe(12000);
      expect(creditRes.body.delta).toBe(-2000);
      expect(creditRes.body.newBalance).toBe(10000);

      // 2. Ajuste tipo débito (+1500) por recargo administrativo
      const debitRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers/${customerId}/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'debit',
          amount: 1500,
          reason: 'Cargo por gestión de cobranza',
        });

      expect(debitRes.status).toBe(200);
      expect(debitRes.body.previousBalance).toBe(10000);
      expect(debitRes.body.delta).toBe(1500);
      expect(debitRes.body.newBalance).toBe(11500);

      // 3. Ajuste tipo set (fijar saldo a 0) por condonación total
      const setRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers/${customerId}/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'set',
          amount: 0,
          reason: 'Condonación y cierre de cuenta pactado',
        });

      expect(setRes.status).toBe(200);
      expect(setRes.body.previousBalance).toBe(11500);
      expect(setRes.body.delta).toBe(-11500);
      expect(setRes.body.newBalance).toBe(0);

      // 4. Verificar extracto histórico completo
      const ledgerRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${customerId}/movements`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(ledgerRes.status).toBe(200);
      expect(ledgerRes.body.length).toBe(4); // initial (12000), credit (-2000), debit (+1500), set (-11500)
      expect(ledgerRes.body[0]?.balanceAfter).toBe(0); // El más reciente
    });

    it('rechaza ajustes sin motivo especificado o con montos negativos', async () => {
      const invalidRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers/${customerId}/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'credit',
          amount: -500,
          reason: 'Sin motivo válido',
        });

      expect(invalidRes.status).toBe(400);

      const noReasonRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers/${customerId}/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'credit',
          amount: 500,
        });

      expect(noReasonRes.status).toBe(400);
    });
  });

  describe('Integración con Connector API (Holds y Sincronización)', () => {
    it('un ajuste de saldo en ERP altera inmediatamente el margen de crédito disponible en /connector/account-holds', async () => {
      // 1. Crear API Key de POS
      const keyRes = await request(app)
        .post(`/api/tenants/${tenantId}/api-keys`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
      const posRawKey = keyRes.body.rawKey as string;

      // 2. Crear cliente con límite $10,000 y margen $2,000 (total disponible $12,000)
      const custRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Florencia Peña',
          creditLimit: 10000,
          margin: 2000,
          initialBalance: 0,
        });
      const customerId = custRes.body.id as string;

      // 3. POS solicita hold por $11,000 -> Debe ser APROBADO (12000 >= 11000)
      const hold1Res = await request(app)
        .post('/connector/account-holds')
        .set('Authorization', `Bearer ${posRawKey}`)
        .set('X-POS-Contract-Version', '4.0.0')
        .set('Idempotency-Key', 'hold_pos_1')
        .send({
          customerId,
          amount: 11000,
        });

      expect(hold1Res.status).toBe(200);
      expect(hold1Res.body.approved).toBe(true);
      expect(typeof hold1Res.body.holdId).toBe('string');

      // 4. Admin registra un cargo/ajuste de débito en cuenta de $5,000
      await request(app)
        .post(`/api/tenants/${tenantId}/customers/${customerId}/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          type: 'debit',
          amount: 5000,
          reason: 'Venta telefónica de sucursal',
        });

      // Ahora el balance es 5,000. Disponible total = 12000 - 5000 = 7,000.
      // 5. POS solicita nuevo hold por $8,000 -> Debe ser RECHAZADO (7000 < 8000)
      const hold2Res = await request(app)
        .post('/connector/account-holds')
        .set('Authorization', `Bearer ${posRawKey}`)
        .set('X-POS-Contract-Version', '4.0.0')
        .set('Idempotency-Key', 'hold_pos_2')
        .send({
          customerId,
          amount: 8000,
        });

      expect(hold2Res.status).toBe(200);
      expect(hold2Res.body.approved).toBe(false);
      expect(hold2Res.body.reasonCode).toBe('insufficient-credit');
    });
  });
});
