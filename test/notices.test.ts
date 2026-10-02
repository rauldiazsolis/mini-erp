import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

const at = '2026-10-02T12:00:00.000Z';
const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };

describe('notices en el pull (#2)', () => {
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
    const key = await request(app)
      .post(`/api/tenants/${tenantId}/api-keys`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'POS-01' });
    apiKey = (key.body as { rawKey: string }).rawKey;
  });

  function push(lotId: string, events: unknown[]) {
    return request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId: 'dev-1', events });
  }

  function pull(deviceId?: string) {
    return request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ cursors: {}, pendingLotIds: [], ...(deviceId === undefined ? {} : { deviceId }) });
  }

  type Notice = { id: string; severity: string; message: string; ref?: { type: string; id: string } };
  const notices = async (deviceId?: string): Promise<Notice[]> => ((await pull(deviceId)).body as { notices: Notice[] }).notices;
  const ventaACuenta = { id: 'e1', type: 'sale', createdAt: at, origin, sale: { id: 'v1', total: 950, customerId: 'c9', payments: [{ method: 'account', amount: 950 }] } };

  it('el equipo que generó la discrepancia la ve como aviso; otro no', async () => {
    await push('l1', [ventaACuenta]);
    const propios = await notices('dev-1');
    expect(propios).toHaveLength(1);
    expect(propios[0]?.id).toMatch(/^discrepancy:disc_/);
    expect(propios[0]).toEqual({
      id: propios[0]?.id,
      severity: 'warning',
      message: 'La venta a cuenta de $950 es de un cliente que mini contax todavía no tiene: se suma a su saldo cuando llegue el cliente.',
      ref: { type: 'sale', id: 'v1' },
    });
    expect(await notices('dev-2')).toEqual([]);
    expect(await notices()).toEqual([]);
  });

  it('el aviso desaparece cuando la discrepancia se resuelve', async () => {
    await push('l1', [ventaACuenta]);
    await push('l2', [{ id: 'e2', type: 'customer', createdAt: at, origin, customer: { id: 'c9', name: 'Ana' } }]);
    expect(await notices('dev-1')).toEqual([]);
  });
});
