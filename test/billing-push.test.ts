import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import type { BillingService } from '../src/server/billing/billing-service.ts';
import { reconcileCharges } from '../src/server/billing/reconcile.ts';

const origin = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };

function venta(eventId: string, saleId: string, createdAt: string, ticket?: { date: string; number: number }) {
  return {
    id: eventId,
    type: 'sale',
    createdAt,
    origin,
    sale: { id: saleId, status: 'closed', total: 100, createdAt, lines: [], payments: [{ method: 'cash', amount: 100 }], ...(ticket === undefined ? {} : { ticket }) },
  };
}

describe('cargos generados por el push (#21)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let billing: BillingService;
  let key1: string;
  let key2: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => new Date('2026-10-05T15:00:00.000Z') });
    app = bundle.app;
    billing = bundle.billing;
    const owner = bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    billing.grantSignupBonus(tenantId, owner.user.id);
    const crear = async (pointOfSale: string) => {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/pos-registers`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: pointOfSale, branch: 'CENTRAL', pointOfSale });
      return (res.body as { rawKey: string }).rawKey;
    };
    key1 = await crear('Caja 1');
    key2 = await crear('Caja 2');
  });

  const push = (key: string, lotId: string, deviceId: string, events: unknown[]) =>
    request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${key}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId, events });
  const count = () => (systemDb.prepare('SELECT COUNT(*) AS n FROM charges').get() as { n: number }).n;

  it('vender en dos cajas el mismo día genera dos cargos; un día sin ventas, ninguno', async () => {
    await push(key1, 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T13:00:00.000Z')]);
    await push(key2, 'l2', 'dev-2', [venta('e2', 's2', '2026-10-04T14:00:00.000Z')]);
    const rows = systemDb.prepare('SELECT day, device_id, gift_amount FROM charges ORDER BY register_id').all();
    expect(rows).toEqual([
      { day: '2026-10-04', device_id: '', gift_amount: 1000 },
      { day: '2026-10-04', device_id: '', gift_amount: 1000 },
    ]);
  });

  it('una venta offline sincronizada al día siguiente se cobra en su día', async () => {
    await push(key1, 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T01:00:00.000Z', { date: '2026-10-03', number: 1 })]);
    expect(systemDb.prepare('SELECT day FROM charges').all()).toEqual([{ day: '2026-10-03' }]);
  });

  it('varias ventas del mismo día y caja son un solo cargo', async () => {
    await push(key1, 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T13:00:00.000Z'), venta('e2', 's2', '2026-10-04T14:00:00.000Z')]);
    await push(key1, 'l2', 'dev-1', [venta('e3', 's3', '2026-10-04T15:00:00.000Z')]);
    expect(count()).toBe(1);
  });

  it('una anulación sola no cobra; un lote repetido tampoco', async () => {
    const anulacion = {
      ...venta('e1', 's9', '2026-10-04T13:00:00.000Z'),
      sale: { id: 's9', status: 'closed', total: -100, voidsSaleId: 's0', lines: [], payments: [{ method: 'cash', amount: -100 }] },
    };
    await push(key1, 'l1', 'dev-1', [anulacion]);
    expect(count()).toBe(0);
    await push(key1, 'l2', 'dev-1', [venta('e2', 's1', '2026-10-04T13:00:00.000Z')]);
    await push(key1, 'l2', 'dev-1', [venta('e2', 's1', '2026-10-04T13:00:00.000Z')]);
    expect(count()).toBe(1);
  });

  it('otro equipo con la key de la caja cobra aparte', async () => {
    await push(key1, 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T13:00:00.000Z')]);
    await push(key1, 'l2', 'dev-x', [venta('e2', 's2', '2026-10-04T14:00:00.000Z')]);
    expect(systemDb.prepare('SELECT device_id FROM charges ORDER BY device_id').all()).toEqual([{ device_id: '' }, { device_id: 'dev-x' }]);
  });

  it('el barrido crea los cargos que falten y no repite', async () => {
    await push(key1, 'l1', 'dev-1', [venta('e1', 's1', '2026-10-04T13:00:00.000Z')]);
    await push(key1, 'l2', 'dev-x', [venta('e2', 's2', '2026-10-05T13:00:00.000Z')]);
    systemDb.prepare('DELETE FROM gift_consumptions').run();
    systemDb.prepare('DELETE FROM charges').run();
    expect(reconcileCharges({ systemDb, tenantManager, billing })).toBe(2);
    expect(reconcileCharges({ systemDb, tenantManager, billing })).toBe(0);
    expect(systemDb.prepare('SELECT day, device_id FROM charges ORDER BY day').all()).toEqual([
      { day: '2026-10-04', device_id: '' },
      { day: '2026-10-05', device_id: 'dev-x' },
    ]);
  });
});
