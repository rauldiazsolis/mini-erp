import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { generateHistoricalDemoActivity } from '../src/server/seeds/demo-activity-generator.ts';
import { argentinaToday } from '../src/shared/argentina-day.ts';

const origin = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };

describe('escritura de ventas, cobranzas y movimientos con columnas (#20)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let tenantManager: TenantManager;
  let token: string;
  let apiKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const owner = bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    token = owner.token;
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    const key = await request(app)
      .post(`/api/tenants/${tenantId}/api-keys`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    apiKey = (key.body as { rawKey: string }).rawKey;
  });

  const db = (): DatabaseSync => tenantManager.getTenantDb(tenantId);
  const push = (lotId: string, events: unknown[]) =>
    request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId: 'dev-1', events });

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
    expect(db().prepare('SELECT day, customer_id, ticket_date, ticket_number FROM sales').get()).toEqual({
      day: '2026-10-01', customer_id: 'c1', ticket_date: '2026-10-01', ticket_number: 7,
    });
    expect(db().prepare('SELECT day, receipt_date, receipt_number FROM customer_payments').get()).toEqual({
      day: '2026-10-01', receipt_date: '2026-10-01', receipt_number: 2,
    });
    expect(db().prepare('SELECT day FROM cash_movements').get()).toEqual({ day: '2026-10-01' });
  });

  it('la cobranza del admin se guarda con la forma del contrato', async () => {
    await push('l1', [{ id: 'e0', type: 'customer', createdAt: '2026-10-01T12:00:00.000Z', origin, customer: { id: 'c1', name: 'Ana' } }]);
    const res = await request(app)
      .post(`/api/tenants/${tenantId}/customers/c1/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 300, method: 'transfer', reference: 'op-9' });
    expect(res.status).toBe(200);
    const row = db().prepare('SELECT payload, day, device_id, branch, point_of_sale FROM customer_payments').get() as {
      payload: string; day: string; device_id: string; branch: string; point_of_sale: string;
    };
    expect(row).toMatchObject({ day: argentinaToday(new Date()), device_id: 'admin_panel', branch: 'ADMIN', point_of_sale: 'Oficina' });
    expect(JSON.parse(row.payload)).toMatchObject({
      customerId: 'c1', total: 300, payments: [{ method: 'transfer', amount: 300, reference: 'op-9' }],
    });
  });
});

describe('semilla de actividad con forma de contrato (#20)', () => {
  it('ventas numeradas, una anulación, una cobranza y movimientos del contrato; nada después de ahora', () => {
    const db = new DatabaseSync(':memory:');
    initTenantDb(db);
    const now = new Date('2026-10-02T21:00:00.000Z'); // 18:00 argentinas
    db.prepare("INSERT INTO branches (id, name, code, created_at) VALUES ('b1', 'Central', 'CENTRAL', ?)").run(now.toISOString());
    db.prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p1', 'S1', 'Alfajor', 500, ?, ?)").run(now.toISOString(), now.toISOString());
    db.prepare("INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES ('p1', 'b1', 100, ?)").run(now.toISOString());
    db.prepare("INSERT INTO customers (id, name, balance, created_at, updated_at) VALUES ('cust-juan', 'Juan', 0, ?, ?)").run(now.toISOString(), now.toISOString());

    generateHistoricalDemoActivity(db, 'b1', now);

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
