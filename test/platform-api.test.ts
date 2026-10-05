import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import type { BillingService } from '../src/server/billing/billing-service.ts';
import type { PlatformPaymentItem } from '../src/shared/credits-types.ts';

describe('API de plataforma de cobro (#21)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let billing: BillingService;
  let tokens: { root: string; support: string; owner: string };
  let ownerId: string;
  const tenantId = 'kiosco';

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => new Date('2026-10-05T15:00:00.000Z') });
    app = bundle.app;
    billing = bundle.billing;
    bundle.authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const support = bundle.authService.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Soporte' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    ownerId = owner.user.id;
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco', ownerUserId: owner.user.id });
    tokens = {
      root: bundle.authService.login({ email: 'root@x.com', password: 'password123' }).token,
      support: bundle.authService.login({ email: 'soporte@x.com', password: 'password123' }).token,
      owner: owner.token,
    };
  });

  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const base = `/api/platform/tenants/${tenantId}`;
  const audit = (action: string) =>
    systemDb.prepare('SELECT tenant_id, details FROM audit_log WHERE action = ?').all(action) as { tenant_id: string | null; details: string }[];

  it('root y soporte registran pagos, otorgan y anulan créditos, extienden la gracia y cambian el titular', async () => {
    for (const who of ['root', 'support'] as const) {
      const pay = await request(app).post(`${base}/payments`).set(as(who)).send({ day: '2026-10-05', amount: 5000, info: 'Transf. 123' });
      expect(pay.status).toBe(201);
      const grant = await request(app).post(`${base}/gift-credits`).set(as(who)).send({ amount: 1000, expiresOn: '2026-12-31', reason: 'Cortesía' });
      expect(grant.status).toBe(201);
      const creditId = (grant.body as { id: string }).id;
      expect((await request(app).delete(`${base}/gift-credits/${creditId}`).set(as(who)).send({ reason: 'Error' })).status).toBe(200);
      expect((await request(app).post(`${base}/grace`).set(as(who)).send({ until: '2026-10-20' })).status).toBe(200);
      expect((await request(app).put(`${base}/holder`).set(as(who)).send({ userId: ownerId })).status).toBe(200);
    }
    expect(billing.summary(tenantId).paidBalance).toBe(10000);
    expect(audit('billing.payment_registered')).toHaveLength(2);
    expect(audit('billing.payment_registered')[0]?.tenant_id).toBe(tenantId);
    expect(JSON.parse(audit('billing.payment_registered')[0]?.details ?? '{}')).toMatchObject({ amount: 5000, day: '2026-10-05' });
    for (const action of ['billing.credits_granted', 'billing.credit_voided', 'billing.grace_extended', 'billing.holder_changed']) {
      expect(audit(action)).toHaveLength(2);
    }
  });

  it('la devolución y la configuración son solo de root', async () => {
    await request(app).post(`${base}/payments`).set(as('root')).send({ day: '2026-10-05', amount: 5000 });
    expect((await request(app).post(`${base}/refunds`).set(as('support')).send({ amount: 100 })).status).toBe(403);
    expect((await request(app).post(`${base}/refunds`).set(as('root')).send({ amount: 100, info: 'Baja' })).status).toBe(201);
    expect(audit('billing.refund')).toHaveLength(1);

    expect((await request(app).get('/api/platform/settings').set(as('support'))).status).toBe(200);
    expect((await request(app).put('/api/platform/settings').set(as('support')).send({ paidShare: 0.7 })).status).toBe(403);
    const put = await request(app).put('/api/platform/settings').set(as('root')).send({ paidShare: 0.7, paymentAlias: 'mini.contax' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ paidShare: 0.7, paymentAlias: 'mini.contax', pricePerRegisterDay: 1000 });
    expect(audit('billing.settings_updated')).toEqual([{ tenant_id: null, details: JSON.stringify({ keys: ['paidShare', 'paymentAlias'] }) }]);
    expect((await request(app).put('/api/platform/settings').set(as('root')).send({ nada: 1 })).status).toBe(400);
    expect((await request(app).put('/api/platform/settings').set(as('root')).send({ paidShare: 2 })).status).toBe(400);
  });

  it('un owner común no entra a la plataforma', async () => {
    expect((await request(app).post(`${base}/payments`).set(as('owner')).send({ day: '2026-10-05', amount: 5000 })).status).toBe(403);
    expect((await request(app).get('/api/platform/payments').set(as('owner'))).status).toBe(403);
    expect((await request(app).get('/api/platform/settings').set(as('owner'))).status).toBe(403);
  });

  it('validaciones: importe, fecha, comercio, devolución mayor que el saldo y titular inválido', async () => {
    expect((await request(app).post(`${base}/payments`).set(as('root')).send({ day: '2026-10-05', amount: 0 })).status).toBe(400);
    expect((await request(app).post(`${base}/payments`).set(as('root')).send({ day: '05/10/2026', amount: 10 })).status).toBe(400);
    expect((await request(app).post('/api/platform/tenants/nada/payments').set(as('root')).send({ day: '2026-10-05', amount: 10 })).status).toBe(404);
    const refund = await request(app).post(`${base}/refunds`).set(as('root')).send({ amount: 10 });
    expect(refund.status).toBe(400);
    expect((refund.body as { error: string }).error).toBe('La devolución supera el saldo pagado');
    expect((await request(app).put(`${base}/holder`).set(as('root')).send({ userId: 'nadie' })).status).toBe(400);
    expect((await request(app).delete(`${base}/gift-credits/gift_nada`).set(as('root')).send({ reason: 'x' })).status).toBe(404);
    expect((await request(app).delete(`${base}/gift-credits/gift_nada`).set(as('root')).send({})).status).toBe(400);
  });

  describe('planilla de cobranzas', () => {
    const sheet = [
      'fecha;comercio;importe;info',
      '05/10/2026;kiosco;5.000,00;op 1',
      '05/10/2026;nada;100;op 2',
      '05/10/2026;kiosco;5000;op 1',
      '05/10/2026;demo-x;100;op 3',
      '31/02/2026;kiosco;100;op 4',
    ].join('\n');
    type SheetResponse = { applied: boolean; rows: { line: number; status: string; message?: string; tenantName?: string; amount?: number }[] };
    const subir = (csv: string, dryRun: boolean, who: keyof typeof tokens = 'support') =>
      request(app).post(`/api/platform/payments/import${dryRun ? '?dryRun=1' : ''}`).set(as(who)).send({ csv });

    beforeEach(() => {
      systemDb.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES ('demo-x', 'demo-x', 'Demo', '2026-10-01T00:00:00.000Z')").run();
      systemDb.prepare("INSERT INTO demo_tenants (tenant_id, template, last_full_reset_at) VALUES ('demo-x', 'kiosco', '2026-10-01T00:00:00.000Z')").run();
    });

    it('la vista previa marca cada fila y no registra nada', async () => {
      const res = await subir(sheet, true);
      expect(res.status).toBe(200);
      const body = res.body as SheetResponse;
      expect(body.applied).toBe(false);
      expect(body.rows.map((r) => [r.line, r.status, r.message ?? ''])).toEqual([
        [2, 'ok', ''],
        [3, 'error', 'Comercio no encontrado'],
        [4, 'duplicate', 'Repetido en la planilla'],
        [5, 'error', 'Las demos no se cobran'],
        [6, 'error', 'Fecha inválida'],
      ]);
      expect(body.rows[0]).toMatchObject({ tenantName: 'Kiosco', amount: 5000 });
      expect(billing.listPayments()).toEqual([]);
    });

    it('registra las filas buenas una sola vez: volver a subirla da "ya registrado"', async () => {
      const first = (await subir(sheet, false)).body as SheetResponse;
      expect(first.applied).toBe(true);
      expect(first.rows[0]?.status).toBe('ok');
      expect(billing.summary(tenantId).paidBalance).toBe(5000);
      const again = (await subir(sheet, false)).body as SheetResponse;
      expect(again.rows[0]).toMatchObject({ status: 'duplicate', message: 'Ya registrado' });
      expect(billing.listPayments()).toHaveLength(1);
      expect(billing.listPayments()[0]?.fromSheet).toBe(true);
      expect(audit('billing.payment_registered')).toHaveLength(1);
      expect(JSON.parse(audit('billing.payment_registered')[0]?.details ?? '{}')).toMatchObject({ fromSheet: true, line: 2 });
    });

    it('una planilla vacía da 400 y un owner común 403', async () => {
      expect((await subir('', true)).status).toBe(400);
      expect((await subir(sheet, true, 'owner')).status).toBe(403);
    });
  });

  it('la lista de pagos', async () => {
    await request(app).post(`${base}/payments`).set(as('support')).send({ day: '2026-10-05', amount: 5000, info: 'op 1' });
    const res = await request(app).get('/api/platform/payments').set(as('root'));
    expect(res.status).toBe(200);
    expect(res.body as PlatformPaymentItem[]).toEqual([
      expect.objectContaining({ amount: 5000, info: 'op 1', tenantId, tenantName: 'Kiosco', holderName: 'Owner', createdByName: 'Soporte', fromSheet: false }),
    ]);
  });
});
