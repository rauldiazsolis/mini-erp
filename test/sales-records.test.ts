import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { createTenantSchema } from '../src/server/db/pg/migrations/migrate.ts';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { saveCashMovement, saveCustomerPayment, saveSale } from '../src/server/sales/records.ts';
import { generateHistoricalDemoActivity } from '../src/server/seeds/demo-activity-generator.ts';
import { argentinaToday } from '../src/shared/argentina-day.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

const origin = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };

describe('escritura de ventas, cobranzas y movimientos con columnas (#20)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let tenantManager: TenantManager;
  let token: string;
  let apiKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    tenantManager = new TenantManager(pgDb(), { inMemory: true });
    const bundle = createApp({ database: pgDb(), tenantManager });
    app = bundle.app;
    const owner = await bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    token = owner.token;
    await tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    // Con bono: las ventas con fechas fijas no dejan al comercio restringido cuando pase la gracia (#21)
    await bundle.billing.grantSignupBonus(tenantId, owner.user.id);
    const key = await request(app)
      .post(`/api/tenants/${tenantId}/pos-registers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    apiKey = (key.body as { rawKey: string }).rawKey;
  });

  const db = () => pgDb().forTenant(tenantId);
  const push = (lotId: string, events: unknown[]) =>
    request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId: 'dev-1', events });

  const pushWith = (lotId: string, deviceId: string, events: unknown[]) =>
    request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId, events });
  const venta = (eventId: string, saleId: string, createdAt: string) => ({
    id: eventId, type: 'sale', createdAt, origin,
    sale: { id: saleId, status: 'closed', total: 100, createdAt, lines: [], payments: [{ method: 'cash', amount: 100 }] },
  });

  it('el push guarda la caja de la key y a qué equipo se cobra (#21)', async () => {
    await pushWith('l-a', 'dev-1', [venta('ev-a', 'va', '2026-10-01T13:00:00.000Z')]);
    await pushWith('l-b', 'dev-2', [venta('ev-b', 'vb', '2026-10-01T14:00:00.000Z')]);
    const rows = await db().selectFrom('sales').select(['id', 'register_id', 'charge_device']).orderBy('id').execute();
    expect(rows[0]).toMatchObject({ id: 'va', charge_device: '' });
    expect(rows[0]?.register_id).toMatch(/^reg_/);
    expect(rows[1]).toMatchObject({ id: 'vb', charge_device: 'dev-2', register_id: rows[0]?.register_id });
  });

  it('reenviar una venta no le cambia la caja ni el equipo cobrado (#21)', async () => {
    await pushWith('l-a', 'dev-1', [venta('ev-a', 'va', '2026-10-01T13:00:00.000Z')]);
    await pushWith('l-b', 'dev-2', [venta('ev-a2', 'va', '2026-10-01T13:00:00.000Z')]);
    expect(await db().selectFrom('sales').select('charge_device').execute()).toEqual([{ charge_device: '' }]);
  });

  it('el push completa día, cliente y números', async () => {
    await push('l1', [
      { id: 'e0', type: 'customer', createdAt: '2026-10-01T12:00:00.000Z', origin, customer: { id: 'c1', name: 'Ana' } },
      {
        id: 'e1', type: 'sale', createdAt: '2026-10-02T03:10:00.000Z', origin,
        sale: { id: 'v1', status: 'closed', total: 100, customerId: 'c1', createdAt: '2026-10-02T03:10:00.000Z', ticket: { date: '2026-10-01', number: 7 }, lines: [], payments: [{ method: 'cash', amount: 100 }] },
      },
      {
        id: 'e2', type: 'customer-payment', createdAt: '2026-10-01T15:00:00.000Z', origin,
        payment: { id: 'p1', customerId: 'c1', total: 50, createdAt: '2026-10-01T15:00:00.000Z', receipt: { date: '2026-10-01', number: 2 }, payments: [{ method: 'cash', amount: 50 }] },
      },
      {
        id: 'e3', type: 'cash-movement', createdAt: '2026-10-02T02:00:00.000Z', origin,
        movement: { id: 'm1', direction: 'in', amount: 10, concept: 'Fondo', source: 'manual', createdAt: '2026-10-02T02:00:00.000Z' },
      },
    ]);
    expect(await db().selectFrom('sales').select(['day', 'customer_id', 'ticket_date', 'ticket_number']).execute()).toEqual([
      { day: '2026-10-01', customer_id: 'c1', ticket_date: '2026-10-01', ticket_number: 7 },
    ]);
    expect(await db().selectFrom('customer_payments').select(['day', 'receipt_date', 'receipt_number']).execute()).toEqual([
      { day: '2026-10-01', receipt_date: '2026-10-01', receipt_number: 2 },
    ]);
    expect(await db().selectFrom('cash_movements').select('day').execute()).toEqual([{ day: '2026-10-01' }]);
  });

  it('la cobranza del admin se guarda con la forma del contrato', async () => {
    await request(app).post(`/api/tenants/${tenantId}/customers`).set('Authorization', `Bearer ${token}`).send({ id: 'c1', name: 'Ana' });
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/customers/c1/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 300, method: 'transfer', reference: 'op-9' });
    expect(res.status).toBe(200);
    const row = await pgDb()
      .forTenant(tenantId)
      .selectFrom('customer_payments')
      .select(['payload', 'day', 'device_id', 'branch', 'point_of_sale', 'customer_id'])
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ day: argentinaToday(new Date()), device_id: 'admin_panel', branch: 'ADMIN', point_of_sale: 'Oficina', customer_id: 'c1' });
    expect(row.payload).toMatchObject({
      customerId: 'c1', total: 300, payments: [{ method: 'transfer', amount: 300, reference: 'op-9' }],
    });
  });
});

describe('records.ts sobre PostgreSQL (fase 4)', () => {
  let t: Kysely<TenantDatabase>;
  const caja = { deviceId: 'dev-1', branch: 'CENTRAL', pointOfSale: 'Caja 1' };
  const recibida = '2026-10-02T03:10:00.000Z'; // 00:10 argentinas del 2

  beforeEach(async () => {
    await createTenantSchema(pgDb().root, 'kiosco');
    t = pgDb().forTenant('kiosco');
  });

  const ventas = async () =>
    await t
      .selectFrom('sales')
      .select(['id', 'payload', 'total', 'day', 'customer_id', 'ticket_date', 'ticket_number', 'register_id', 'charge_device', 'created_at', 'voids_sale_id'])
      .orderBy('id')
      .execute();

  it('saveSale guarda el payload intacto y las columnas derivadas; devuelve el día', async () => {
    const sale = { id: 'v1', total: 0.1 + 0.2, customerId: 'c1', ticket: { date: '2026-10-01', number: 7 }, createdAt: recibida, lines: [{ sku: 'A', tags: ['x'] }] };
    const day = await saveSale(t, sale, { ...caja, registerId: 'reg_1', chargeDevice: '' }, recibida);
    expect(day).toBe('2026-10-01');
    expect(await ventas()).toEqual([
      {
        id: 'v1', payload: sale, total: 0.3, day: '2026-10-01', customer_id: 'c1', ticket_date: '2026-10-01', ticket_number: 7,
        register_id: 'reg_1', charge_device: '', created_at: recibida, voids_sale_id: null,
      },
    ]);
  });

  it('sin ticket, el día es el día argentino del instante; created_at se guarda normalizado', async () => {
    const day = await saveSale(t, { id: 'v1', total: 100, createdAt: '2026-10-01T23:30:00-03:00' }, caja, '2026-10-01T23:30:00-03:00');
    expect(day).toBe('2026-10-01');
    expect(await ventas()).toMatchObject([{ day: '2026-10-01', ticket_date: null, ticket_number: null, created_at: '2026-10-02T02:30:00.000Z' }]);
  });

  it('una fecha de ticket que no existe no se guarda: el día sale del instante', async () => {
    const day = await saveSale(t, { id: 'v1', total: 100, ticket: { date: '2026-02-31', number: 3 }, createdAt: recibida }, caja, recibida);
    expect(day).toBe('2026-10-02');
    expect(await ventas()).toMatchObject([{ day: '2026-10-02', ticket_date: null, ticket_number: 3 }]);

    expect(await saveCustomerPayment(t, { id: 'p1', customerId: 'c1', total: 5, receipt: { date: 'ayer', number: 1 }, createdAt: recibida }, caja, recibida)).toBe(true);
    expect(await t.selectFrom('customer_payments').select(['day', 'receipt_date', 'receipt_number']).execute()).toEqual([
      { day: '2026-10-02', receipt_date: null, receipt_number: 1 },
    ]);
  });

  it('reenviar una venta reescribe payload, día, cliente y ticket, y conserva la caja y el equipo cobrado', async () => {
    await saveSale(t, { id: 'v1', total: 100, createdAt: recibida }, { ...caja, registerId: 'reg_1', chargeDevice: '' }, recibida);
    await saveSale(
      t,
      { id: 'v1', total: 250, customerId: 'c2', ticket: { date: '2026-09-30', number: 9 }, createdAt: recibida },
      { deviceId: 'dev-2', branch: 'OTRA', pointOfSale: 'Caja 9', registerId: 'reg_2', chargeDevice: 'dev-2' },
      '2026-10-05T00:00:00.000Z',
    );
    const [row] = await ventas();
    expect(row).toMatchObject({
      day: '2026-09-30', customer_id: 'c2', ticket_date: '2026-09-30', ticket_number: 9,
      register_id: 'reg_1', charge_device: '',
      // Como en SQLite: el total y el instante de la primera vez no se tocan
      total: 100, created_at: recibida,
    });
    expect(row?.payload).toMatchObject({ total: 250, customerId: 'c2' });
  });

  it('una venta sin caja la toma del reenvío', async () => {
    await saveSale(t, { id: 'v1', total: 100, createdAt: recibida }, caja, recibida);
    await saveSale(t, { id: 'v1', total: 100, createdAt: recibida }, { ...caja, registerId: 'reg_2', chargeDevice: 'dev-2' }, recibida);
    expect(await ventas()).toMatchObject([{ register_id: 'reg_2', charge_device: 'dev-2' }]);
  });

  it('una cobranza nunca se reescribe: la segunda vez devuelve false', async () => {
    const pago = { id: 'p1', customerId: 'c1', total: 50, voidsPaymentId: 'p0', receipt: { date: '2026-10-01', number: 2 }, createdAt: recibida };
    expect(await saveCustomerPayment(t, pago, caja, recibida)).toBe(true);
    expect(await saveCustomerPayment(t, { ...pago, customerId: 'c2', total: 999 }, caja, recibida)).toBe(false);
    expect(
      await t.selectFrom('customer_payments').select(['customer_id', 'payload', 'day', 'receipt_date', 'receipt_number', 'voids_payment_id', 'created_at']).execute(),
    ).toEqual([
      { customer_id: 'c1', payload: pago, day: '2026-10-01', receipt_date: '2026-10-01', receipt_number: 2, voids_payment_id: 'p0', created_at: recibida },
    ]);
  });

  it('un movimiento de caja reenviado reescribe payload y día', async () => {
    await saveCashMovement(t, { id: 'm1', concept: 'Fondo', createdAt: recibida }, caja, recibida);
    await saveCashMovement(t, { id: 'm1', concept: 'Fondo corregido', createdAt: '2026-10-03T15:00:00.000Z' }, caja, '2026-10-03T15:00:00.000Z');
    expect(await t.selectFrom('cash_movements').select(['payload', 'day', 'created_at', 'branch']).execute()).toEqual([
      { payload: { id: 'm1', concept: 'Fondo corregido', createdAt: '2026-10-03T15:00:00.000Z' }, day: '2026-10-03', created_at: recibida, branch: 'CENTRAL' },
    ]);
  });

  it('un carácter nulo en el payload se quita al guardar', async () => {
    await saveSale(t, { id: 'v1', total: 1, createdAt: recibida, note: 'a\u0000b' }, caja, recibida);
    expect((await ventas())[0]?.payload).toMatchObject({ note: 'ab' });
  });
});

describe('semilla de actividad con forma de contrato (#20)', () => {
  it('ventas numeradas, una anulación, una cobranza y movimientos del contrato; nada después de ahora', async () => {
    const db = new DatabaseSync(':memory:');
    initTenantDb(db);
    const now = new Date('2026-10-02T21:00:00.000Z'); // 18:00 argentinas
    db.prepare("INSERT INTO branches (id, name, code, created_at) VALUES ('b1', 'Central', 'CENTRAL', ?)").run(now.toISOString());
    db.prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p1', 'S1', 'Alfajor', 500, ?, ?)").run(now.toISOString(), now.toISOString());
    db.prepare("INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES ('p1', 'b1', 100, ?)").run(now.toISOString());
    db.prepare("INSERT INTO customers (id, name, balance, created_at, updated_at) VALUES ('cust-juan', 'Juan', 0, ?, ?)").run(now.toISOString(), now.toISOString());

    await generateHistoricalDemoActivity(db, 'b1', now);

    const ventas = db.prepare('SELECT payload, day, ticket_number, voids_sale_id, created_at FROM sales').all() as {
      payload: string; day: string | null; ticket_number: number | null; voids_sale_id: string | null; created_at: string;
    }[];
    expect(ventas.length).toBeGreaterThan(0);
    expect(ventas.every((v) => v.day !== null && v.ticket_number !== null)).toBe(true);
    expect(ventas.every((v) => v.created_at <= now.toISOString())).toBe(true);
    expect(ventas.filter((v) => v.voids_sale_id !== null)).toHaveLength(1);

    const cobranzas = db.prepare('SELECT payload FROM customer_payments').all() as { payload: string }[];
    expect(cobranzas).toHaveLength(1);
    expect(JSON.parse(cobranzas[0]?.payload ?? '')).toMatchObject({ customerId: 'cust-juan', payments: [{ method: 'cash' }] });

    const movimientos = (db.prepare('SELECT payload FROM cash_movements').all() as { payload: string }[]).map(
      (m) => JSON.parse(m.payload) as { direction?: string; concept?: string; source?: string },
    );
    expect(movimientos.length).toBeGreaterThan(0);
    expect(movimientos.every((m) => (m.direction === 'in' || m.direction === 'out') && typeof m.concept === 'string' && typeof m.source === 'string')).toBe(true);
    expect(movimientos.some((m) => m.source === 'count-adjustment')).toBe(true);
  });
});
