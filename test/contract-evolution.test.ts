import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { backendInfo } from '../src/server/connector/backend-info.ts';

const at = '2026-10-02T12:00:00.000Z';
const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };

describe('reglas de evolución del contrato 4.4.0 (#2)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let tenantManager: TenantManager;
  let apiKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    const systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const { token, user } = bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: user.id });
    // Con bono: las ventas con fechas fijas no dejan al comercio restringido cuando pase la gracia (#21)
    bundle.billing.grantSignupBonus(tenantId, user.id);
    const key = await request(app)
      .post(`/api/tenants/${tenantId}/pos-registers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'POS-01' });
    apiKey = (key.body as { rawKey: string }).rawKey;
  });

  const count = (sql: string): number =>
    (tenantManager.getTenantDb(tenantId).prepare(sql).get() as { n: number }).n;

  function push(lotId: string, events: unknown[]) {
    return request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId: 'dev-1', events });
  }

  it('un tipo de evento desconocido queda como issue y el resto se aplica', async () => {
    await push('l1', [
      { id: 'e1', type: 'loyalty-points', createdAt: at, origin, points: 10 },
      { id: 'e2', type: 'sale', createdAt: at, origin, sale: { id: 'v1', total: 10, payments: [{ method: 'cash', amount: 10 }] } },
    ]);
    expect(count("SELECT COUNT(*) AS n FROM sales WHERE id = 'v1'")).toBe(1);
    const issues = JSON.parse((tenantManager.getTenantDb(tenantId).prepare("SELECT issues FROM push_lots WHERE id = 'l1'").get() as { issues: string }).issues) as { eventId?: string }[];
    expect(issues.map((i) => i.eventId)).toEqual(['e1']);
  });

  it('un medio de pago desconocido se guarda, en una venta y en una cobranza', async () => {
    await push('l1', [
      { id: 'e0', type: 'customer', createdAt: at, origin, customer: { id: 'c1', name: 'Ana' } },
      { id: 'e1', type: 'sale', createdAt: at, origin, sale: { id: 'v1', total: 10, payments: [{ method: 'crypto', amount: 10 }] } },
      { id: 'e2', type: 'customer-payment', createdAt: at, origin, payment: { id: 'p1', customerId: 'c1', total: 10, payments: [{ method: 'crypto', amount: 10 }], createdAt: at } },
    ]);
    expect(count("SELECT COUNT(*) AS n FROM push_lots WHERE id = 'l1' AND status = 'ok'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM sales WHERE json_extract(payload, '$.payments[0].method') = 'crypto'")).toBe(1);
  });

  it('ignora campos desconocidos en el lote, el evento y la venta', async () => {
    const res = await request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', 'l1')
      .send({ deviceId: 'dev-1', futuro: true, events: [
        { id: 'e1', type: 'sale', createdAt: at, origin, prioridad: 'alta', sale: { id: 'v1', total: 10, payments: [{ method: 'cash', amount: 10, cuotas: 3 }], propina: 2 } },
      ] });
    expect(res.status).toBe(200);
    expect(count("SELECT COUNT(*) AS n FROM push_lots WHERE id = 'l1' AND status = 'ok'")).toBe(1);
  });

  it('acepta tickets y recibos con huecos', async () => {
    await push('l1', [
      { id: 'e1', type: 'sale', createdAt: at, origin, sale: { id: 'v1', total: 10, payments: [{ method: 'cash', amount: 10 }], ticket: { date: '2026-10-02', number: 1 } } },
      { id: 'e2', type: 'sale', createdAt: at, origin, sale: { id: 'v2', total: 10, payments: [{ method: 'cash', amount: 10 }], ticket: { date: '2026-10-02', number: 7 } } },
    ]);
    expect(count('SELECT COUNT(*) AS n FROM sales')).toBe(2);
  });

  it('la foto completa no se recorta', async () => {
    const db = tenantManager.getTenantDb(tenantId);
    const insert = db.prepare('INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < 1200; i++) {
      insert.run(`p${String(i)}`, `SKU${String(i)}`, `Producto ${String(i)}`, at, at);
    }
    const res = await request(app).post('/connector/sync/pull').set('Authorization', `Bearer ${apiKey}`).send({ cursors: {}, pendingLotIds: [] });
    expect((res.body as { products: { items: unknown[] } }).products.items).toHaveLength(1200);
  });
});

describe('contrato 4.5.0 (#58)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let apiKey: string;

  beforeEach(async () => {
    const systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const { token, user } = bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco Pepe', ownerUserId: user.id });
    const key = await request(app)
      .post('/api/tenants/kiosco/pos-registers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'POS-01' });
    apiKey = (key.body as { rawKey: string }).rawKey;
  });

  it('/info dice 4.5.0 y el comercio de la key', async () => {
    const res = await request(app).get('/connector/info').set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ contractVersion: '4.5.0', company: { name: 'Kiosco Pepe' } });
  });

  it('un POS 4.4.0 sigue sincronizando con el backend 4.5.0', async () => {
    const res = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .send({ cursors: {}, pendingLotIds: [] });
    expect(res.status).toBe(200);
  });
});

describe('backendInfo (#58)', () => {
  it('sin nombre, o con un nombre vacío, no manda company', () => {
    expect(backendInfo({ status: 'ok', demos: false })).not.toHaveProperty('company');
    expect(backendInfo({ status: 'ok', demos: false, companyName: '  ' })).not.toHaveProperty('company');
    expect(backendInfo({ status: 'ok', demos: false, companyName: 'Kiosco' }).company).toEqual({ name: 'Kiosco' });
  });
});
