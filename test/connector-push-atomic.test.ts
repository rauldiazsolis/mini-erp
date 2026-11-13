import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

const at = '2026-10-02T12:00:00.000Z';
const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };

describe('push transaccional (#2)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let tenantManager: TenantManager;
  let apiKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    tenantManager = new TenantManager(db());
    const bundle = createApp({ database: db(), tenantManager });
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

  const tenantDb = () => db().forTenant(tenantId);

  async function count(table: 'sales' | 'customers' | 'stock_movements' | 'push_lots', id?: string): Promise<number> {
    let query = tenantDb().selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n'));
    if (id !== undefined) {
      query = query.where('id', '=', id);
    }
    return (await query.executeTakeFirstOrThrow()).n;
  }

  function push(lotId: string, events: unknown[]) {
    return request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId: 'dev-1', events });
  }

  const lote = [
    { id: 'e1', type: 'sale', createdAt: at, origin, sale: { id: 'v1', total: 100, payments: [{ method: 'cash', amount: 100 }] } },
    // Un total que no entra en la columna: PostgreSQL tira un error, que sin savepoint abortaría el lote entero
    { id: 'e2', type: 'sale', createdAt: at, origin, sale: { id: 'v-enorme', total: 1e15, payments: [{ method: 'cash', amount: 1e15 }] } },
    { id: 'e3', type: 'customer', createdAt: at, origin, customer: { id: 'c1', name: 'Ana' } },
  ];

  it('un evento que falla se deshace solo, queda como issue y el resto se aplica', async () => {
    const res = await push('lote-1', lote);
    expect(res.status).toBe(200);

    const pull = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ cursors: {}, pendingLotIds: ['lote-1'] });
    const lot = (pull.body as { lots: Record<string, { status: string; issues?: { message: string; eventId?: string }[] }> }).lots['lote-1'];
    expect(lot?.status).toBe('issues');
    expect(lot?.issues?.map((i) => i.eventId)).toEqual(['e2']);
    expect(lot?.issues?.[0]?.message).toMatch(/^No se pudo aplicar: .*numeric/);

    expect(await count('sales', 'v1')).toBe(1);
    expect(await count('customers', 'c1')).toBe(1);
    expect(await count('sales', 'v-enorme')).toBe(0);
  });

  it('un lote con eventos inválidos de cada tipo, un no-objeto y un tipo desconocido responde 200 y aplica lo válido', async () => {
    const valida = {
      id: 'ok',
      type: 'sale',
      createdAt: at,
      origin,
      futuro: 1,
      sale: { id: 'v9', total: 50, futuro: { x: 1 }, payments: [{ method: 'cash', amount: 50 }] },
    };
    const invalidos = [
      { id: 'b1', type: 'sale', createdAt: at, origin, sale: { id: 'v8', total: 'cien', payments: [] } },
      { id: 'b2', type: 'stock-movement', createdAt: at, origin, movement: { id: 'm8', productId: 'p1', reason: 'sale' } },
      { id: 'b3', type: 'customer', createdAt: at, origin, customer: { id: 'c8' } },
      { id: 'b4', type: 'account-hold-confirm', createdAt: at, origin, holdId: 'h1' },
      { id: 'b5', type: 'account-hold-release', createdAt: at, origin },
      { id: 'b6', type: 'cash-movement', createdAt: at, origin, movement: { amount: 10 } },
      { id: 'b7', type: 'customer-payment', createdAt: at, origin, payment: { id: 'cp8', customerId: 'c1', total: '5' } },
      { id: 'b8', type: 'session-open', createdAt: at, origin },
      null,
    ];
    const res = await push('lote-mixto', [valida, ...invalidos]);
    expect(res.status).toBe(200);

    const pull = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ cursors: {}, pendingLotIds: ['lote-mixto'] });
    const lot = (pull.body as { lots: Record<string, { status: string; issues?: { message: string; eventId?: string }[] }> }).lots['lote-mixto'];
    expect(lot?.status).toBe('issues');
    expect(lot?.issues?.map((i) => i.eventId)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', undefined]);

    const stored = await tenantDb().selectFrom('sales').select('payload').where('id', '=', 'v9').executeTakeFirst();
    expect(stored?.payload).toMatchObject({ futuro: { x: 1 } });
  });

  it('un carácter nulo en el lote (un texto, el deviceId) no tumba el push: se quita y el lote se aplica', async () => {
    const res = await request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', 'lote-nul')
      .send({ deviceId: 'dev\u0000-1', events: [{ id: 'e1', type: 'customer', createdAt: at, origin, customer: { id: 'c1', name: 'An\u0000a' } }] });
    expect(res.status).toBe(200);

    expect(await tenantDb().selectFrom('customers').select(['id', 'name']).execute()).toEqual([{ id: 'c1', name: 'Ana' }]);
    expect(await tenantDb().selectFrom('push_lots').select(['id', 'status', 'device_id']).execute()).toEqual([{ id: 'lote-nul', status: 'ok', device_id: 'dev-1' }]);
  });

  it('repetir el lote no duplica nada', async () => {
    await push('lote-1', lote);
    await push('lote-1', lote);
    expect(await count('sales')).toBe(1);
    const lots = await tenantDb().selectFrom('push_lots').select(['id', 'status']).execute();
    expect(lots).toEqual([{ id: 'lote-1', status: 'issues' }]);
  });
});
