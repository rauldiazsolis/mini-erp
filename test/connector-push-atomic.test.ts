import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

const at = '2026-10-02T12:00:00.000Z';
const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };

describe('push transaccional (#2)', () => {
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

  const lote = [
    { id: 'e1', type: 'sale', createdAt: at, origin, sale: { id: 'v1', total: 100, payments: [{ method: 'cash', amount: 100 }] } },
    // Producto inexistente: la clave foránea de stock_movements tira un error
    { id: 'e2', type: 'stock-movement', createdAt: at, origin, movement: { id: 'm1', productId: 'no-existe', delta: -1, reason: 'sale' } },
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
    expect(lot?.issues?.[0]?.message).toMatch(/^No se pudo aplicar: .*FOREIGN KEY/);

    expect(count("SELECT COUNT(*) AS n FROM sales WHERE id = 'v1'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM customers WHERE id = 'c1'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM stock_movements WHERE id = 'm1'")).toBe(0);
  });

  it('repetir el lote no duplica nada', async () => {
    await push('lote-1', lote);
    await push('lote-1', lote);
    expect(count('SELECT COUNT(*) AS n FROM sales')).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM push_lots WHERE id = 'lote-1' AND status = 'issues'")).toBe(1);
  });
});
