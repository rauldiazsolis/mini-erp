import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

const at = '2026-10-02T12:00:00.000Z';
const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };

describe('discrepancias del push (#2)', () => {
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

  const saldo = (id: string) =>
    (tenantManager.getTenantDb(tenantId).prepare('SELECT balance FROM customers WHERE id = ?').get(id) as { balance: number } | undefined)?.balance;
  const abiertas = () =>
    tenantManager.getTenantDb(tenantId)
      .prepare('SELECT kind, device_id, customer_id, ref_type, ref_id, amount FROM discrepancies WHERE resolved_at IS NULL ORDER BY created_at, rowid')
      .all();
  const ev = (id: string, type: string, extra: Record<string, unknown>) => ({ id, type, createdAt: at, origin, ...extra });
  const cobranza = (id: string, customerId: string, total: number, voidsPaymentId?: string) =>
    ev(`e-${id}`, 'customer-payment', { payment: { id, customerId, total, payments: [{ method: 'cash', amount: total }], createdAt: at, ...(voidsPaymentId === undefined ? {} : { voidsPaymentId }) } });

  it('venta a cuenta de un cliente desconocido: queda pendiente y se aplica cuando llega el cliente', async () => {
    await push('l1', [ev('e1', 'sale', { sale: { id: 'v1', total: 950, customerId: 'c9', payments: [{ method: 'account', amount: 950 }] } })]);
    expect(abiertas()).toEqual([{ kind: 'unknown-customer', device_id: 'dev-1', customer_id: 'c9', ref_type: 'sale', ref_id: 'v1', amount: 950 }]);

    await push('l2', [ev('e2', 'customer', { customer: { id: 'c9', name: 'Ana' } })]);
    expect(saldo('c9')).toBe(950);
    expect(abiertas()).toEqual([]);
  });

  it('cobranza de un cliente desconocido: queda pendiente', async () => {
    await push('l1', [cobranza('p1', 'c9', 500)]);
    expect(abiertas()).toEqual([{ kind: 'unknown-customer', device_id: 'dev-1', customer_id: 'c9', ref_type: 'customer-payment', ref_id: 'p1', amount: -500 }]);
  });

  it('anular una cobranza sube el saldo, guarda la referencia y el extracto dice anulación', async () => {
    await push('l1', [ev('e0', 'customer', { customer: { id: 'c1', name: 'Ana' } }), cobranza('p1', 'c1', 500)]);
    expect(saldo('c1')).toBe(-500);
    await push('l2', [cobranza('p2', 'c1', -500, 'p1')]);
    expect(saldo('c1')).toBe(0);
    const db = tenantManager.getTenantDb(tenantId);
    expect(db.prepare("SELECT voids_payment_id FROM customer_payments WHERE id = 'p2'").get()).toEqual({ voids_payment_id: 'p1' });
    expect(db.prepare("SELECT type, amount, description FROM account_movements WHERE customer_id = 'c1' ORDER BY created_at, rowid").all()).toEqual([
      { type: 'payment', amount: -500, description: 'Cobranza p1' },
      { type: 'payment-void', amount: 500, description: 'Anulación de cobranza p1' },
    ]);
    expect(abiertas()).toEqual([]);
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
    expect(abiertas().map((d) => (d as { kind: string }).kind)).toEqual(['void-unknown-payment', 'void-customer-mismatch', 'void-duplicate']);
    expect(saldo('c2')).toBe(500);
  });

  it('la original llega después de su anulación: se resuelve sola', async () => {
    await push('l1', [ev('e0', 'customer', { customer: { id: 'c1', name: 'Ana' } }), cobranza('p2', 'c1', -500, 'p1')]);
    expect(abiertas()).toHaveLength(1);
    await push('l2', [cobranza('p1', 'c1', 500)]);
    expect(abiertas()).toEqual([]);
  });

  it('repetir un lote no duplica discrepancias ni movimientos', async () => {
    const lote = [ev('e1', 'sale', { sale: { id: 'v1', total: 950, customerId: 'c9', payments: [{ method: 'account', amount: 950 }] } })];
    await push('l1', lote);
    await push('l1', lote);
    expect(abiertas()).toHaveLength(1);
  });
});
