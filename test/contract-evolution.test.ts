import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { backendInfo } from '../src/server/connector/backend-info.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

const at = '2026-10-02T12:00:00.000Z';
const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };

describe('reglas de evolución del contrato 4.4.0 (#2)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let tenantManager: TenantManager;
  let apiKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    tenantManager = new TenantManager(pgDb(), { inMemory: true });
    const bundle = createApp({ database: pgDb(), tenantManager });
    app = bundle.app;
    const { token, user } = await bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    await tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: user.id });
    // Con bono: las ventas con fechas fijas no dejan al comercio restringido cuando pase la gracia (#21)
    await bundle.billing.grantSignupBonus(tenantId, user.id);
    const key = await request(app)
      .post(`/api/tenants/${tenantId}/pos-registers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'POS-01' });
    apiKey = (key.body as { rawKey: string }).rawKey;
  });

  const tenantDb = () => pgDb().forTenant(tenantId);
  const lotStatus = async (id: string) => (await tenantDb().selectFrom('push_lots').select('status').where('id', '=', id).executeTakeFirst())?.status;
  const salePayloads = async () => (await tenantDb().selectFrom('sales').select(['id', 'payload']).orderBy('id').execute());

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
    expect((await salePayloads()).map((s) => s.id)).toEqual(['v1']);
    const lot = await tenantDb().selectFrom('push_lots').select('issues').where('id', '=', 'l1').executeTakeFirst();
    expect(lot?.issues).toMatchObject([{ eventId: 'e1' }]);
    expect(lot?.issues).toHaveLength(1);
  });

  it('un medio de pago desconocido se guarda, en una venta y en una cobranza', async () => {
    await push('l1', [
      { id: 'e0', type: 'customer', createdAt: at, origin, customer: { id: 'c1', name: 'Ana' } },
      { id: 'e1', type: 'sale', createdAt: at, origin, sale: { id: 'v1', total: 10, payments: [{ method: 'crypto', amount: 10 }] } },
      { id: 'e2', type: 'customer-payment', createdAt: at, origin, payment: { id: 'p1', customerId: 'c1', total: 10, payments: [{ method: 'crypto', amount: 10 }], createdAt: at } },
    ]);
    expect(await lotStatus('l1')).toBe('ok');
    expect(await salePayloads()).toMatchObject([{ id: 'v1', payload: { payments: [{ method: 'crypto' }] } }]);
    const cobranza = await tenantDb().selectFrom('customer_payments').select('payload').where('id', '=', 'p1').executeTakeFirst();
    expect(cobranza?.payload).toMatchObject({ payments: [{ method: 'crypto' }] });
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
    expect(await lotStatus('l1')).toBe('ok');
  });

  it('acepta tickets y recibos con huecos', async () => {
    await push('l1', [
      { id: 'e1', type: 'sale', createdAt: at, origin, sale: { id: 'v1', total: 10, payments: [{ method: 'cash', amount: 10 }], ticket: { date: '2026-10-02', number: 1 } } },
      { id: 'e2', type: 'sale', createdAt: at, origin, sale: { id: 'v2', total: 10, payments: [{ method: 'cash', amount: 10 }], ticket: { date: '2026-10-02', number: 7 } } },
    ]);
    expect(await salePayloads()).toHaveLength(2);
  });

  it('la foto completa no se recorta', async () => {
    const products = Array.from({ length: 1200 }, (_, i) => ({ id: `p${String(i)}`, sku: `SKU${String(i)}`, name: `Producto ${String(i)}`, created_at: at, updated_at: at }));
    await tenantDb().insertInto('products').values(products).execute();
    const res = await request(app).post('/connector/sync/pull').set('Authorization', `Bearer ${apiKey}`).send({ cursors: {}, pendingLotIds: [] });
    expect((res.body as { products: { items: unknown[] } }).products.items).toHaveLength(1200);
  });
});

describe('contratos 4.5.0 (#58) y 4.6.0 (#63)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let apiKey: string;

  beforeEach(async () => {
    const tenantManager = new TenantManager(pgDb(), { inMemory: true });
    const bundle = createApp({ database: pgDb(), tenantManager });
    app = bundle.app;
    const { token, user } = await bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    await tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco Pepe', ownerUserId: user.id });
    const key = await request(app)
      .post('/api/tenants/kiosco/pos-registers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'POS-01' });
    apiKey = (key.body as { rawKey: string }).rawKey;
  });

  it('/info dice el comercio de la key', async () => {
    const res = await request(app).get('/connector/info').set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ company: { name: 'Kiosco Pepe' } });
  });

  it('/info dice 4.6.0 con la capacidad portal y su objeto (#63, #24)', async () => {
    const res = await request(app).get('/connector/info').set('Authorization', `Bearer ${apiKey}`);
    const body = res.body as { contractVersion: string; capabilities: string[]; portal?: unknown };
    expect(body.contractVersion).toBe('4.6.0');
    expect(body.capabilities).toContain('portal');
    expect(body.portal).toEqual({ command: 'MINI', label: 'Abrir mini' });
  });

  it('POST /portal-links con la key de un comercio real devuelve un link de un uso (#24, M10)', async () => {
    const res = await request(app)
      .post('/connector/portal-links')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.6.0');
    expect(res.status).toBe(201);
    expect((res.body as { url: string }).url).toMatch(/\/portal#t=[\w-]{43}$/);
  });

  it('un POS 4.4.0 sigue sincronizando con el backend 4.6.0', async () => {
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
    expect(backendInfo({ status: 'ok', demos: false, portal: false })).not.toHaveProperty('company');
    expect(backendInfo({ status: 'ok', demos: false, portal: false, companyName: '  ' })).not.toHaveProperty('company');
    expect(backendInfo({ status: 'ok', demos: false, portal: false, companyName: 'Kiosco' }).company).toEqual({ name: 'Kiosco' });
  });
});
