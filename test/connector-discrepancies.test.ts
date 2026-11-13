import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/server/app.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

const at = '2026-10-02T12:00:00.000Z';
const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };

describe('discrepancias del push (#2)', () => {
  let app: ReturnType<typeof createApp>['app'];
  let tenantManager: TenantManager;
  let apiKey: string;
  const tenantId = 'kiosco';

  beforeEach(async () => {
    tenantManager = new TenantManager(pgDb());
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

  function push(lotId: string, events: unknown[]) {
    return request(app)
      .post('/connector/sync/push')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .set('Idempotency-Key', lotId)
      .send({ deviceId: 'dev-1', events });
  }

  const tenantDb = () => pgDb().forTenant(tenantId);
  const saldo = async (id: string) => (await tenantDb().selectFrom('customers').select('balance').where('id', '=', id).executeTakeFirst())?.balance;
  const abiertas = async () =>
    await tenantDb()
      .selectFrom('discrepancies')
      .select(['kind', 'device_id', 'customer_id', 'ref_type', 'ref_id', 'amount'])
      .where('resolved_at', 'is', null)
      .orderBy('created_at')
      .orderBy('seq')
      .execute();
  const ev = (id: string, type: string, extra: Record<string, unknown>) => ({ id, type, createdAt: at, origin, ...extra });
  const cobranza = (id: string, customerId: string, total: number, voidsPaymentId?: string) =>
    ev(`e-${id}`, 'customer-payment', { payment: { id, customerId, total, payments: [{ method: 'cash', amount: total }], createdAt: at, ...(voidsPaymentId === undefined ? {} : { voidsPaymentId }) } });

  it('venta a cuenta de un cliente desconocido: queda pendiente y se aplica cuando llega el cliente', async () => {
    await push('l1', [ev('e1', 'sale', { sale: { id: 'v1', total: 950, customerId: 'c9', payments: [{ method: 'account', amount: 950 }] } })]);
    expect(await abiertas()).toEqual([{ kind: 'unknown-customer', device_id: 'dev-1', customer_id: 'c9', ref_type: 'sale', ref_id: 'v1', amount: 950 }]);

    await push('l2', [ev('e2', 'customer', { customer: { id: 'c9', name: 'Ana' } })]);
    expect(await saldo('c9')).toBe(950);
    expect(await abiertas()).toEqual([]);
  });

  it('cobranza de un cliente desconocido: queda pendiente', async () => {
    await push('l1', [cobranza('p1', 'c9', 500)]);
    expect(await abiertas()).toEqual([{ kind: 'unknown-customer', device_id: 'dev-1', customer_id: 'c9', ref_type: 'customer-payment', ref_id: 'p1', amount: -500 }]);
  });

  it('anular una cobranza sube el saldo, guarda la referencia y el extracto dice anulación', async () => {
    await push('l1', [ev('e0', 'customer', { customer: { id: 'c1', name: 'Ana' } }), cobranza('p1', 'c1', 500)]);
    expect(await saldo('c1')).toBe(-500);
    await push('l2', [cobranza('p2', 'c1', -500, 'p1')]);
    expect(await saldo('c1')).toBe(0);
    expect(await tenantDb().selectFrom('customer_payments').select('voids_payment_id').where('id', '=', 'p2').executeTakeFirst()).toEqual({ voids_payment_id: 'p1' });
    expect(
      await tenantDb().selectFrom('account_movements').select(['type', 'amount', 'description']).where('customer_id', '=', 'c1').orderBy('created_at').orderBy('seq').execute(),
    ).toEqual([
      { type: 'payment', amount: -500, description: 'Cobranza p1' },
      { type: 'payment-void', amount: 500, description: 'Anulación de cobranza p1' },
    ]);
    expect(await abiertas()).toEqual([]);
  });

  it('anulación inconsistente: se aplica igual y queda la discrepancia', async () => {
    await push('l1', [
      ev('e0', 'customer', { customer: { id: 'c1', name: 'Ana' } }),
      ev('e1', 'customer', { customer: { id: 'c2', name: 'Beto' } }),
      cobranza('p1', 'c1', 500),
    ]);
    await push('l2', [
      cobranza('p2', 'c1', -100, 'no-existe'), // original desconocida
      cobranza('p3', 'c2', -500, 'p1'),        // de otro cliente
      cobranza('p4', 'c1', -500, 'p1'),        // primera anulación válida
      cobranza('p5', 'c1', -500, 'p1'),        // segunda: duplicada
    ]);
    expect((await abiertas()).map((d) => d.kind)).toEqual(['void-unknown-payment', 'void-customer-mismatch', 'void-duplicate']);
    expect(await saldo('c2')).toBe(500);
  });

  it('la original llega después de su anulación: se resuelve sola', async () => {
    await push('l1', [ev('e0', 'customer', { customer: { id: 'c1', name: 'Ana' } }), cobranza('p2', 'c1', -500, 'p1')]);
    expect(await abiertas()).toHaveLength(1);
    await push('l2', [cobranza('p1', 'c1', 500)]);
    expect(await abiertas()).toEqual([]);
  });

  it('repetir un lote no duplica discrepancias ni movimientos', async () => {
    const lote = [ev('e1', 'sale', { sale: { id: 'v1', total: 950, customerId: 'c9', payments: [{ method: 'account', amount: 950 }] } })];
    await push('l1', lote);
    await push('l1', lote);
    expect(await abiertas()).toHaveLength(1);
  });
});
