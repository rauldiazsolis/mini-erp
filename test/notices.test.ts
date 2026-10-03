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
  let systemDb: DatabaseSync;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    systemDb = new DatabaseSync(':memory:');
    initSystemDb(systemDb);
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    // Reloj fijo: la deuda y su fecha límite no dependen del día en que corre el test
    const bundle = createApp({ systemDb, tenantManager, now: () => new Date('2026-10-03T12:00:00.000Z') });
    app = bundle.app;
    const { token, user } = bundle.authService.createUser({ email: 'o@k.com', password: 'password123', name: 'O' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: user.id });
    // Con bono, para que los avisos de créditos no se mezclen con los de discrepancias (#21)
    bundle.billing.grantSignupBonus(tenantId, user.id);
    const key = await request(app)
      .post(`/api/tenants/${tenantId}/pos-registers`)
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
    // El otro equipo no ve la discrepancia (sí, el aviso de equipo ajeno: #21)
    expect((await notices('dev-2')).filter((n) => n.id.startsWith('discrepancy:'))).toEqual([]);
    expect(await notices()).toEqual([]);
  });

  it('otro equipo con la key de la caja recibe el aviso de equipo ajeno; el ligado, el de key compartida (#21)', async () => {
    await push('l1', [ventaACuenta]);
    const ajeno = await notices('dev-2');
    expect(ajeno.map((n) => [n.id, n.severity, n.ref?.type])).toEqual([['register:foreign-device', 'warning', 'register']]);
    const ligado = await notices('dev-1');
    expect(ligado.map((n) => n.id)).toEqual(['register:shared-key', expect.stringMatching(/^discrepancy:/)]);
  });

  it('sin créditos, todos los equipos reciben el aviso critical de deuda (#21)', async () => {
    systemDb.prepare('DELETE FROM gift_credits').run();
    await push('l1', [{ ...ventaACuenta, sale: { ...ventaACuenta.sale, customerId: undefined, payments: [{ method: 'cash', amount: 950 }] } }]);
    const avisos = await notices('dev-1');
    expect(avisos.map((n) => [n.id, n.severity])).toEqual([['credits:debt', 'critical']]);
    expect(avisos[0]?.message).toMatch(/^mini contax: sin créditos, debés \$ 1\.000\. Pagá antes del \d\d\/\d\d/);
  });

  it('el aviso desaparece cuando la discrepancia se resuelve', async () => {
    await push('l1', [ventaACuenta]);
    await push('l2', [{ id: 'e2', type: 'customer', createdAt: at, origin, customer: { id: 'c9', name: 'Ana' } }]);
    expect(await notices('dev-1')).toEqual([]);
  });
});
