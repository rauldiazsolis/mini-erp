import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

interface CustomerResponse {
  id: string;
  name: string;
  document?: string;
  phone?: string;
  creditLimit: number;
  margin: number;
  balance: number;
  availableCredit: number;
  isDebtor: boolean;
  blockedReason?: string | null;
}

interface AccountMovement {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
}

interface PaymentResponse {
  previousBalance: number;
  amount: number;
  newBalance: number;
  movementId: string;
}

interface AdjustmentResponse {
  previousBalance: number;
  delta: number;
  newBalance: number;
}

interface HoldResponse {
  approved: boolean;
  holdId?: string;
  reasonCode?: string;
}

describe('Clientes, Cuentas Corrientes y Ajustes de Saldo (Etapa 2.3)', () => {
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-customers-test';

  beforeEach(() => {
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
      const customer = createRes.body as unknown as CustomerResponse;
      expect(customer.id).toBeDefined();
      expect(customer.name).toBe('Roberto Gómez');
      expect(customer.document).toBe('20-33445566-7');
      expect(customer.creditLimit).toBe(50000);
      expect(customer.margin).toBe(10000);
      expect(customer.balance).toBe(0);
      expect(customer.availableCredit).toBe(60000); // 50000 + 10000 - 0
      expect(customer.isDebtor).toBe(false);
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
      const createBody = createRes.body as unknown as CustomerResponse;
      const customerId = createBody.id;
      expect(createBody.balance).toBe(7500);
      expect(createBody.availableCredit).toBe(27500); // 35000 - 7500
      expect(createBody.isDebtor).toBe(true);

      // Comprobar que en su extracto existe el movimiento inicial
      const movRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${customerId}/movements`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(movRes.status).toBe(200);
      const movements = movRes.body as unknown as AccountMovement[];
      expect(movements.length).toBe(1);
      expect(movements[0]?.type).toBe('adjustment');
      expect(movements[0]?.amount).toBe(7500);
      expect(movements[0]?.balanceAfter).toBe(7500);
      expect(movements[0]?.description).toMatch(/saldo inicial/i);
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
      const debtors = debtorsRes.body as unknown as CustomerResponse[];
      expect(debtors.length).toBe(1);
      expect(debtors[0]?.name).toBe('Esteban Quito');

      // 2. Búsqueda por documento
      const searchRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers?search=11111111`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(searchRes.status).toBe(200);
      const searchResults = searchRes.body as unknown as CustomerResponse[];
      expect(searchResults.length).toBe(1);
      expect(searchResults[0]?.name).toBe('Carlos Paz');
    });

    it('permite actualizar datos del cliente y bloquearlo (soft delete/bloqueo)', async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Lucas Moyano', creditLimit: 10000 });

      const createBody = createRes.body as unknown as CustomerResponse;
      const customerId = createBody.id;

      // Actualizar datos
      const updateRes = await request(app)
        .put(`/api/tenants/${tenantId}/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Lucas Moyano Jr.',
          creditLimit: 15000,
        });

      expect(updateRes.status).toBe(200);
      const updateBody = updateRes.body as unknown as CustomerResponse;
      expect(updateBody.name).toBe('Lucas Moyano Jr.');
      expect(updateBody.creditLimit).toBe(15000);

      // Bloquear / archivar
      const deleteRes = await request(app)
        .delete(`/api/tenants/${tenantId}/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Exceso de morosidad reiterada' });

      expect(deleteRes.status).toBe(200);
      const deleteBody = deleteRes.body as unknown as CustomerResponse;
      expect(deleteBody.blockedReason).toBe('Exceso de morosidad reiterada');
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
      const customer = createRes.body as unknown as CustomerResponse;
      customerId = customer.id;
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
      const payBody = payRes.body as unknown as PaymentResponse;
      expect(payBody.previousBalance).toBe(12000);
      expect(payBody.amount).toBe(5000);
      expect(payBody.newBalance).toBe(7000);
      expect(payBody.movementId).toBeDefined();

      // Comprobar cliente actualizado
      const custRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      const custBody = custRes.body as unknown as CustomerResponse;
      expect(custBody.balance).toBe(7000);
      expect(custBody.availableCredit).toBe(38000); // 45000 - 7000
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
      const creditBody = creditRes.body as unknown as AdjustmentResponse;
      expect(creditBody.previousBalance).toBe(12000);
      expect(creditBody.delta).toBe(-2000);
      expect(creditBody.newBalance).toBe(10000);

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
      const debitBody = debitRes.body as unknown as AdjustmentResponse;
      expect(debitBody.previousBalance).toBe(10000);
      expect(debitBody.delta).toBe(1500);
      expect(debitBody.newBalance).toBe(11500);

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
      const setBody = setRes.body as unknown as AdjustmentResponse;
      expect(setBody.previousBalance).toBe(11500);
      expect(setBody.delta).toBe(-11500);
      expect(setBody.newBalance).toBe(0);

      // 4. Verificar extracto histórico completo
      const ledgerRes = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${customerId}/movements`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(ledgerRes.status).toBe(200);
      const ledger = ledgerRes.body as unknown as AccountMovement[];
      expect(ledger.length).toBe(4); // initial (12000), credit (-2000), debit (+1500), set (-11500)
      expect(ledger[0]?.balanceAfter).toBe(0); // El más reciente
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
      const keyBody = keyRes.body as unknown as { rawKey: string };
      const posRawKey = keyBody.rawKey;

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
      const custBody = custRes.body as unknown as CustomerResponse;
      const customerId = custBody.id;

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
      const hold1Body = hold1Res.body as unknown as HoldResponse;
      expect(hold1Body.approved).toBe(true);
      expect(typeof hold1Body.holdId).toBe('string');

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
      const hold2Body = hold2Res.body as unknown as HoldResponse;
      expect(hold2Body.approved).toBe(false);
      expect(hold2Body.reasonCode).toBe('insufficient-credit');
    });
  });
});
