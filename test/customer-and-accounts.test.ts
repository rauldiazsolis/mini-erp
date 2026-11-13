import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

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
  let tenantManager: TenantManager;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken: string;
  const tenantId = 'kiosco-customers-test';

  beforeEach(async () => {
    tenantManager = new TenantManager(db());
    const created = createApp({ database: db(), tenantManager });
    app = created.app;

    // 1. Registrar usuario administrador
    const registerRes = await created.authService.createUser({
      email: 'admin@customers.test',
      password: 'password123',
      name: 'Admin Clientes',
    });
    adminToken = registerRes.token;

    // 2. Crear tenant sin seed para pruebas limpias
    await tenantManager.createTenant({
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

    it('busca sin distinguir mayúsculas ni tildes, por nombre, documento o teléfono', async () => {
      const crear = (body: Record<string, unknown>) =>
        request(app).post(`/api/tenants/${tenantId}/customers`).set('Authorization', `Bearer ${adminToken}`).send(body);
      await crear({ name: 'Ángela Núñez', document: '20-11111111-1', phone: '11-5555-0001' });
      await crear({ name: 'Bruno 100% Díaz', document: '20-22222222-2', phone: '11-5555-0002' });

      const buscar = async (q: string) => {
        const res = await request(app)
          .get(`/api/tenants/${tenantId}/customers?search=${encodeURIComponent(q)}`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        return (res.body as CustomerResponse[]).map((c) => c.name);
      };
      expect(await buscar('angela nunez')).toEqual(['Ángela Núñez']);
      expect(await buscar('DÍAZ')).toEqual(['Bruno 100% Díaz']);
      expect(await buscar('5555-0002')).toEqual(['Bruno 100% Díaz']);
      // Los comodines del usuario son texto
      expect(await buscar('100%')).toEqual(['Bruno 100% Díaz']);
      expect(await buscar('%')).toEqual(['Bruno 100% Díaz']);
      expect(await buscar('_')).toEqual([]);
    });

    it('un id repetido da 409 y no pisa al cliente', async () => {
      const crear = (name: string) =>
        request(app).post(`/api/tenants/${tenantId}/customers`).set('Authorization', `Bearer ${adminToken}`).send({ id: 'c-fijo', name });
      expect((await crear('Primero')).status).toBe(201);
      const repetido = await crear('Segundo');
      expect(repetido.status).toBe(409);
      expect((repetido.body as { error: string }).error).toBe('Ya existe un cliente con ese id');
      const rows = await db().forTenant(tenantId).selectFrom('customers').select('name').execute();
      expect(rows).toEqual([{ name: 'Primero' }]);
    });

    it('actualizar solo toca los campos que llegan y un cliente que no existe da 404', async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/customers`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Lucía', document: '30111222', phone: '11-1', creditLimit: 1000, margin: 200, initialBalance: 300 });
      const id = (createRes.body as CustomerResponse).id;
      const put = (customerId: string, body: Record<string, unknown>) =>
        request(app).put(`/api/tenants/${tenantId}/customers/${customerId}`).set('Authorization', `Bearer ${adminToken}`).send(body);

      const res = await put(id, { phone: null, unrestricted: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        name: 'Lucía', document: '30111222', phone: null, creditLimit: 1000, margin: 200, balance: 300, unrestricted: true, availableCredit: null,
      });
      expect((await put('nadie', { name: 'X' })).status).toBe(404);
    });
  });

  describe('Dinero del admin: a lo sumo 2 decimales (PostgreSQL, fase 4)', () => {
    const post = (path: string, body: Record<string, unknown>) =>
      request(app).post(`/api/tenants/${tenantId}/${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
    const put = (path: string, body: Record<string, unknown>) =>
      request(app).put(`/api/tenants/${tenantId}/${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
    const invalido = (res: { status: number; body: unknown }) => {
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe('Importe inválido');
    };

    it('el alta rechaza límite, margen y saldo inicial con más de 2 decimales, y no crea nada', async () => {
      invalido(await post('customers', { name: 'A', creditLimit: 100.123 }));
      invalido(await post('customers', { name: 'A', margin: 0.001 }));
      invalido(await post('customers', { name: 'A', initialBalance: 10.005 }));
      invalido(await post('customers', { name: 'A', initialBalance: -10.005 }));
      invalido(await post('customers', { name: 'A', creditLimit: 1e15 }));
      expect(await db().forTenant(tenantId).selectFrom('customers').select('id').execute()).toEqual([]);
    });

    it('el alta sigue admitiendo lo que admitía: cero, 2 decimales y un saldo inicial negativo', async () => {
      const res = await post('customers', { name: 'A', creditLimit: 0, margin: 10.5, initialBalance: -250.75 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ creditLimit: 0, margin: 10.5, balance: -250.75, isDebtor: false });
      // Un límite o un margen negativo sigue sin valer, con su mensaje
      const negativo = await post('customers', { name: 'B', creditLimit: -1 });
      expect(negativo.status).toBe(400);
      expect((negativo.body as { error: string }).error).toBe('El límite de crédito no puede ser negativo');
    });

    it('la edición, la cobranza y el ajuste rechazan más de 2 decimales, sin mover el saldo', async () => {
      const id = ((await post('customers', { name: 'A', initialBalance: 1000 })).body as CustomerResponse).id;
      invalido(await put(`customers/${id}`, { creditLimit: 10.999 }));
      invalido(await put(`customers/${id}`, { margin: 10.999 }));
      invalido(await post(`customers/${id}/payments`, { amount: 10.001 }));
      invalido(await post(`customers/${id}/adjustments`, { type: 'debit', amount: 0.125, reason: 'x' }));
      invalido(await post(`customers/${id}/adjustments`, { type: 'set', amount: 99.999, reason: 'x' }));

      const t = db().forTenant(tenantId);
      expect(await t.selectFrom('customers').select(['balance', 'credit_limit', 'margin']).execute()).toEqual([
        { balance: 1000, credit_limit: 0, margin: 0 },
      ]);
      expect(await t.selectFrom('account_movements').select('id').execute()).toHaveLength(1);
      expect(await t.selectFrom('customer_payments').select('id').execute()).toEqual([]);
    });

    it('con 2 decimales el saldo no acumula error de coma flotante y el extracto cuadra', async () => {
      const id = ((await post('customers', { name: 'A' })).body as CustomerResponse).id;
      expect((await post(`customers/${id}/adjustments`, { type: 'debit', amount: 0.1, reason: 'a' })).status).toBe(200);
      expect((await post(`customers/${id}/adjustments`, { type: 'debit', amount: 0.2, reason: 'b' })).status).toBe(200);
      const pago = await post(`customers/${id}/payments`, { amount: 0.3 });
      expect(pago.body).toMatchObject({ previousBalance: 0.3, amount: 0.3, newBalance: 0 });
      const fijar = await post(`customers/${id}/adjustments`, { type: 'set', amount: 10.15, reason: 'c' });
      expect(fijar.body).toMatchObject({ previousBalance: 0, delta: 10.15, newBalance: 10.15 });

      const filas = await db().forTenant(tenantId).selectFrom('account_movements').select(['amount', 'balance_after']).orderBy('seq').execute();
      expect(filas).toEqual([
        { amount: 0.1, balance_after: 0.1 },
        { amount: 0.2, balance_after: 0.3 },
        { amount: -0.3, balance_after: 0 },
        { amount: 10.15, balance_after: 10.15 },
      ]);
    });
  });

  describe('Borrar un cliente (PostgreSQL, fase 4)', () => {
    const crear = async (body: Record<string, unknown>) =>
      ((await request(app).post(`/api/tenants/${tenantId}/customers`).set('Authorization', `Bearer ${adminToken}`).send(body)).body as CustomerResponse).id;
    const borrar = (id: string, body: Record<string, unknown>) =>
      request(app).delete(`/api/tenants/${tenantId}/customers/${id}`).set('Authorization', `Bearer ${adminToken}`).send(body);
    const quedan = async () => (await db().forTenant(tenantId).selectFrom('customers').select('id').execute()).map((c) => c.id);

    it('sin movimientos ni reservas, el borrado hard lo borra', async () => {
      const id = await crear({ name: 'Sin cuenta' });
      const res = await borrar(id, { hard: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true });
      expect(await quedan()).toEqual([]);
    });

    it('con movimientos da 409 y no se lleva el libro', async () => {
      const id = await crear({ name: 'Con cuenta', initialBalance: 500 });
      const res = await borrar(id, { hard: true });
      expect(res.status).toBe(409);
      expect((res.body as { error: string }).error).toBe('El cliente tiene movimientos: archivalo');
      expect(await quedan()).toEqual([id]);
      expect(await db().forTenant(tenantId).selectFrom('account_movements').select('customer_id').execute()).toEqual([{ customer_id: id }]);
    });

    it('con una reserva da 409', async () => {
      const id = await crear({ name: 'Con reserva' });
      await db()
        .forTenant(tenantId)
        .insertInto('account_holds')
        .values({ id: 'hold-1', customer_id: id, amount: 100, status: 'pending', created_at: new Date().toISOString() })
        .execute();
      expect((await borrar(id, { hard: true })).status).toBe(409);
      expect(await quedan()).toEqual([id]);
    });

    it('archivarlo sigue andando aunque tenga movimientos, y uno que no existe da 404', async () => {
      const id = await crear({ name: 'Con cuenta', initialBalance: 500 });
      const res = await borrar(id, {});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, blockedReason: 'Archivado por administración', balance: 500 });
      expect((await borrar('nadie', { hard: true })).status).toBe(404);
      expect((await borrar('nadie', {})).status).toBe(404);
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

    it('el extracto sale del más nuevo al más viejo, se pide por tramos y filtra por tipo', async () => {
      const post = (path: string, body: Record<string, unknown>) =>
        request(app).post(`/api/tenants/${tenantId}/customers/${customerId}/${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
      await post('adjustments', { type: 'debit', amount: 1, reason: 'uno' });
      await post('payments', { amount: 2 });
      await post('adjustments', { type: 'debit', amount: 3, reason: 'tres' });
      // Todos con el mismo instante: el orden lo da el de inserción
      await db().forTenant(tenantId).updateTable('account_movements').set({ created_at: '2026-10-02T12:00:00.000Z' }).execute();

      const pedir = async (query: string) => {
        const res = await request(app)
          .get(`/api/tenants/${tenantId}/customers/${customerId}/movements${query}`)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        return (res.body as AccountMovement[]).map((m) => m.amount);
      };
      expect(await pedir('')).toEqual([3, -2, 1, 12000]);
      expect(await pedir('?limit=2')).toEqual([3, -2]);
      expect(await pedir('?limit=2&offset=2')).toEqual([1, 12000]);
      expect(await pedir('?type=payment')).toEqual([-2]);
      expect(await pedir('?from=2026-10-02&to=2026-10-03')).toEqual([3, -2, 1, 12000]);
      expect(await pedir('?from=2026-10-03')).toEqual([]);

      const mala = await request(app)
        .get(`/api/tenants/${tenantId}/customers/${customerId}/movements?from=ayer`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(mala.status).toBe(400);
    });

    it('la cobranza escribe el movimiento, el saldo y la cobranza juntos; a un cliente que no existe, 404 y nada', async () => {
      const t = db().forTenant(tenantId);
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/customers/nadie/payments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100 });
      expect(res.status).toBe(404);
      expect(await t.selectFrom('customer_payments').select('id').execute()).toEqual([]);

      const ajuste = await request(app)
        .post(`/api/tenants/${tenantId}/customers/nadie/adjustments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ type: 'set', amount: 100, reason: 'x' });
      expect(ajuste.status).toBe(404);
      expect(await t.selectFrom('account_movements').select('id').execute()).toHaveLength(1);
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
        .post(`/api/tenants/${tenantId}/pos-registers`)
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
        .set('X-POS-Contract-Version', '4.2.0')
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
        .set('X-POS-Contract-Version', '4.2.0')
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
