import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { ConnectorService } from '../src/server/connector/connector-service.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

const at = '2026-10-02T12:00:00.000Z';
const origin = { branch: 'CENTRAL', pointOfSale: 'POS-01' };

/** El Connector API sobre PostgreSQL: lo decidido en la fase 4 de la migración. */
describe('push, pull y reservas sobre PostgreSQL (fase 4)', () => {
  const tenantId = 'kiosco';
  let t: Kysely<TenantDatabase>;
  let connector: ConnectorService;

  beforeEach(async () => {
    const tenantManager = new TenantManager(pgDb());
    await tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco' });
    t = pgDb().forTenant(tenantId);
    connector = new ConnectorService(t);
  });

  const push = (lotId: string, events: unknown[], deviceId = 'dev-1') =>
    connector.processPushLot({ lotId, deviceId, events, defaultBranchId: 'CENTRAL', registerId: 'reg_1', chargeDevice: '' });
  const venta = (id: string, sale: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) => ({
    id: `e-${id}`,
    type: 'sale',
    createdAt: at,
    origin,
    ...envelope,
    sale: { id, total: 100, payments: [{ method: 'cash', amount: 100 }], ...sale },
  });
  const cliente = (id: string, customer: Record<string, unknown> = {}) => ({
    id: `e-${id}`,
    type: 'customer',
    createdAt: at,
    origin,
    customer: { id, name: 'Ana', ...customer },
  });
  const movimiento = (id: string, productId: string, delta: number, eventId = `e-${id}`) => ({
    id: eventId,
    type: 'stock-movement',
    createdAt: at,
    origin,
    movement: { id, productId, delta, reason: 'sale' },
  });
  const ids = async (table: 'sales' | 'customer_payments' | 'cash_movements' | 'customers') =>
    (await t.selectFrom(table).select('id').orderBy('id').execute()).map((r) => r.id);
  const saldo = async (id: string) => (await t.selectFrom('customers').select('balance').where('id', '=', id).executeTakeFirst())?.balance;
  const stockDe = async (productId: string) =>
    await t.selectFrom('stock').select(['branch_id', 'quantity']).where('product_id', '=', productId).orderBy('branch_id').execute();

  it('dos lotes simultáneos que tocan los mismos clientes en orden inverso se aplican de a uno, sin trabarse', async () => {
    await push('l0', [cliente('c1'), cliente('c2')]);
    const fiado = (id: string, customerId: string) => venta(id, { customerId, payments: [{ method: 'account', amount: 100 }] });
    const lotes = Array.from({ length: 6 }, (_, i) =>
      push(`l-${String(i)}`, i % 2 === 0 ? [fiado(`a${String(i)}`, 'c1'), fiado(`b${String(i)}`, 'c2')] : [fiado(`a${String(i)}`, 'c2'), fiado(`b${String(i)}`, 'c1')]),
    );

    const results = await Promise.all(lotes);

    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(await saldo('c1')).toBe(600);
    expect(await saldo('c2')).toBe(600);
  });

  describe('fechas e instantes validados en la frontera', () => {
    it('un ticket con una fecha que no existe queda como aviso con su eventId; no se guarda y el resto se aplica', async () => {
      const result = await push('l1', [venta('v-mala', { ticket: { date: '2026-02-31', number: 1 } }), venta('v-buena', { ticket: { date: '2026-02-28', number: 2 } })]);

      expect(result.status).toBe('issues');
      expect(result.issues).toEqual([{ eventId: 'e-v-mala', message: expect.stringMatching(/sale\.ticket\.date: tiene que ser un día que exista/) as string }]);
      expect(await ids('sales')).toEqual(['v-buena']);
      // El día de la venta rechazada no se cobra
      expect(result.saleDays).toEqual(['2026-02-28']);
    });

    it('un recibo con una fecha que no existe: la cobranza no se guarda ni mueve el saldo', async () => {
      const result = await push('l1', [
        cliente('c1'),
        { id: 'e-p1', type: 'customer-payment', createdAt: at, origin, payment: { id: 'p1', customerId: 'c1', total: 50, receipt: { date: '2026-13-01', number: 1 } } },
      ]);

      expect(result.issues?.map((i) => i.eventId)).toEqual(['e-p1']);
      expect(await ids('customer_payments')).toEqual([]);
      expect(await saldo('c1')).toBe(0);
    });

    it('un createdAt ilegible, en el sobre o adentro, queda como aviso en castellano y el lote sigue', async () => {
      const result = await push('l1', [
        venta('v1', {}, { createdAt: 'ayer a la tarde' }),
        venta('v2', { createdAt: '2026-10-02 12:00' }),
        // Sin zona no es un instante: no se adivina
        venta('v3', { createdAt: '2026-10-02T12:00:00' }),
        { id: 'e-p1', type: 'customer-payment', createdAt: at, origin, payment: { id: 'p1', customerId: 'c1', total: 50, createdAt: '02/10/2026' } },
        { id: 'e-m1', type: 'cash-movement', createdAt: at, origin, movement: { id: 'm1', createdAt: 'nunca' } },
        venta('v-buena'),
      ]);

      expect(result.issues?.map((i) => i.eventId)).toEqual(['e-v1', 'e-v2', 'e-v3', 'e-p1', 'e-m1']);
      for (const issue of result.issues ?? []) {
        expect(issue.message).toMatch(/createdAt: tiene que ser una fecha y hora ISO 8601 con zona/);
      }
      expect(await ids('sales')).toEqual(['v-buena']);
      expect(await ids('customer_payments')).toEqual([]);
      expect(await ids('cash_movements')).toEqual([]);
    });

    it('acepta lo que manda el POS (toISOString) y un instante con offset, y lo guarda normalizado; createdAt sigue siendo opcional', async () => {
      const ahora = new Date().toISOString();
      const result = await push('l1', [
        venta('v1', { createdAt: ahora }, { createdAt: ahora }),
        venta('v2', { createdAt: '2026-10-02T09:00:00-03:00' }, { createdAt: '2026-10-02T09:00:00-03:00' }),
        { id: 'e-v3', type: 'sale', origin, sale: { id: 'v3', total: 1, payments: [] } },
      ]);

      expect(result.status).toBe('ok');
      const rows = await t.selectFrom('sales').select(['id', 'created_at']).orderBy('id').execute();
      expect(rows[0]).toEqual({ id: 'v1', created_at: ahora });
      expect(rows[1]).toEqual({ id: 'v2', created_at: '2026-10-02T12:00:00.000Z' });
      expect(rows[2]?.id).toBe('v3');
    });
  });

  describe('el carácter nulo se quita al entrar', () => {
    it('un evento con \\u0000 en un texto se aplica sin el carácter y no tumba el push', async () => {
      const result = await push(
        'l1',
        [cliente('c1', { name: 'An\u0000a' }), venta('v1', { note: 'a\u0000b', 'cla\u0000ve': 1 })],
        'dev\u0000-1',
      );

      expect(result.status).toBe('ok');
      expect(await t.selectFrom('customers').select('name').execute()).toEqual([{ name: 'Ana' }]);
      const sale = await t.selectFrom('sales').select(['payload', 'device_id']).executeTakeFirstOrThrow();
      expect(sale).toMatchObject({ device_id: 'dev-1', payload: { note: 'ab', clave: 1 } });
      // El lote guardado también queda limpio
      const lot = await t.selectFrom('push_lots').select(['device_id', 'events']).executeTakeFirstOrThrow();
      expect(lot.device_id).toBe('dev-1');
      expect(JSON.stringify(lot.events)).not.toContain('\\u0000');
    });
  });

  describe('redondeo', () => {
    it('un total con ruido de coma flotante se guarda: la columna redondea al centavo y el payload queda como llegó', async () => {
      const total = 0.1 + 0.2;
      const result = await push('l1', [cliente('c1'), venta('v1', { total, customerId: 'c1', payments: [{ method: 'account', amount: total }] })]);

      expect(result.status).toBe('ok');
      const sale = await t.selectFrom('sales').select(['total', 'payload']).executeTakeFirstOrThrow();
      expect(sale.total).toBe(0.3);
      expect(sale.payload).toMatchObject({ total: 0.30000000000000004 });
      // El libro también redondea
      expect(await saldo('c1')).toBe(0.3);
      expect(await t.selectFrom('account_movements').select(['amount', 'balance_after']).execute()).toEqual([{ amount: 0.3, balance_after: 0.3 }]);
    });
  });

  describe('stock', () => {
    it('el movimiento de un producto que el comercio no tiene se guarda igual, en el kardex y en el stock, con el instante del evento', async () => {
      const result = await push('l1', [movimiento('m1', 'no-existe', -2)]);

      expect(result.status).toBe('ok');
      expect(await t.selectFrom('stock_movements').select(['id', 'product_id', 'branch_id', 'delta', 'device_id', 'branch', 'created_at']).execute()).toEqual([
        { id: 'm1', product_id: 'no-existe', branch_id: 'branch-central', delta: -2, device_id: 'dev-1', branch: 'CENTRAL', created_at: at },
      ]);
      expect(await stockDe('no-existe')).toEqual([{ branch_id: 'branch-central', quantity: -2 }]);
    });

    it('el stock se suma en la base y solo si el movimiento se insertó: reenviado en otro lote no vuelve a sumar', async () => {
      await push('l1', [movimiento('m1', 'p1', 10), movimiento('m2', 'p1', -0.25)]);
      expect(await stockDe('p1')).toEqual([{ branch_id: 'branch-central', quantity: 9.75 }]);

      // El mismo movimiento, en otro lote (el POS lo reenvió): el kardex no lo duplica y el stock no cambia
      const result = await push('l2', [movimiento('m1', 'p1', 10, 'e-otra-vez'), movimiento('m3', 'p1', -1)]);
      expect(result.status).toBe('ok');
      expect(await stockDe('p1')).toEqual([{ branch_id: 'branch-central', quantity: 8.75 }]);
      expect((await t.selectFrom('stock_movements').select('id').orderBy('seq').execute()).map((r) => r.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('sin sucursal en el origen ni en la key, va a la primera sucursal (la de menor seq)', async () => {
      await t.insertInto('branches').values({ id: 'aaa-otra', name: 'Otra', code: 'AAA', created_at: at }).execute();
      await connector.processPushLot({ lotId: 'l1', deviceId: 'dev-1', events: [{ ...movimiento('m1', 'p1', 3), origin: {} }] });
      expect(await stockDe('p1')).toEqual([{ branch_id: 'branch-central', quantity: 3 }]);
    });
  });

  describe('lote en una transacción, evento en un savepoint', () => {
    it('un error de PostgreSQL en un evento no aborta el lote: se deshace entero ese evento y su día no se cobra', async () => {
      const result = await push('l1', [
        venta('v1', { ticket: { date: '2026-10-01', number: 1 } }),
        // La venta entra, pero el importe a cuenta no entra en la columna: el evento entero se deshace
        venta('v2', { customerId: 'c1', ticket: { date: '2026-10-05', number: 2 }, payments: [{ method: 'account', amount: 1e15 }] }),
        cliente('c1'),
      ]);

      expect(result.status).toBe('issues');
      expect(result.issues).toEqual([{ eventId: 'e-v2', message: expect.stringMatching(/^No se pudo aplicar: /) as string }]);
      expect(await ids('sales')).toEqual(['v1']);
      expect(await ids('customers')).toEqual(['c1']);
      expect(result.saleDays).toEqual(['2026-10-01']);
      expect(await t.selectFrom('push_lots').select(['id', 'status', 'issues']).execute()).toEqual([{ id: 'l1', status: 'issues', issues: result.issues }]);
    });

    it('un lote ya procesado devuelve su estado guardado sin repetir efectos', async () => {
      const lote = [cliente('c1'), venta('v1', { customerId: 'c1', payments: [{ method: 'account', amount: 100 }] }), { id: 'e-x', type: 'no-existe' }];
      const first = await push('l1', lote);
      const again = await push('l1', lote);

      expect(first.saleDays).toEqual(['2026-10-02']);
      expect(again).toEqual({ status: 'issues', issues: first.issues, saleDays: [] });
      expect(await saldo('c1')).toBe(100);
    });

    it('dos pedidos simultáneos con el mismo lote lo aplican una sola vez', async () => {
      const lote = [
        cliente('c1'),
        venta('v1', { customerId: 'c1', payments: [{ method: 'account', amount: 100 }] }),
        movimiento('m1', 'p1', -1),
        { id: 'e-p1', type: 'customer-payment', createdAt: at, origin, payment: { id: 'p1', customerId: 'c1', total: 30 } },
      ];
      const results = await Promise.all([push('l1', lote), push('l1', lote), push('l1', lote)]);

      // Uno solo lo aplicó (el que informa el día a cobrar); los otros esperaron y devolvieron el estado guardado
      expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
      expect(results.filter((r) => r.saleDays.length > 0)).toHaveLength(1);
      expect(await saldo('c1')).toBe(70);
      expect(await stockDe('p1')).toEqual([{ branch_id: 'branch-central', quantity: -1 }]);
      expect(await t.selectFrom('account_movements').select('type').orderBy('seq').execute()).toEqual([{ type: 'sale' }, { type: 'payment' }]);
    });
  });

  describe('reservas de cuenta corriente', () => {
    const confirmar = (eventId: string, holdId: string) => ({ id: eventId, type: 'account-hold-confirm', createdAt: at, origin, holdId, saleId: 'v1' });
    const liberar = (eventId: string, holdId: string) => ({ id: eventId, type: 'account-hold-release', createdAt: at, origin, holdId });

    beforeEach(async () => {
      await push('l0', [cliente('c1', { creditLimit: 1000, margin: 0 })]);
    });

    async function reservar(amount: number): Promise<string> {
      const hold = await connector.requestAccountHold({ customerId: 'c1', amount });
      if (!hold.approved) {
        throw new Error(`reserva rechazada: ${hold.reasonCode}`);
      }
      return hold.holdId;
    }
    const estado = async (holdId: string) => (await t.selectFrom('account_holds').select('status').where('id', '=', holdId).executeTakeFirst())?.status;

    it('confirmar mueve el saldo una sola vez, aunque la confirmación llegue de nuevo en otro lote', async () => {
      const holdId = await reservar(400);
      await push('l1', [confirmar('e1', holdId)]);
      await push('l2', [confirmar('e2', holdId)]);

      expect(await estado(holdId)).toBe('confirmed');
      expect(await saldo('c1')).toBe(400);
      expect(await t.selectFrom('account_movements').select(['type', 'amount', 'sale_id']).execute()).toEqual([{ type: 'sale', amount: 400, sale_id: 'v1' }]);
    });

    it('una reserva liberada no se confirma después, y una confirmada no se libera', async () => {
      const liberada = await reservar(100);
      const confirmada = await reservar(200);
      await push('l1', [liberar('e1', liberada), confirmar('e2', confirmada)]);
      await push('l2', [confirmar('e3', liberada), liberar('e4', confirmada)]);

      expect(await estado(liberada)).toBe('released');
      expect(await estado(confirmada)).toBe('confirmed');
      expect(await saldo('c1')).toBe(200);
    });

    it('lo reservado cuenta contra el disponible; sin cuenta o sin cliente, no-account', async () => {
      await reservar(700);
      expect(await connector.requestAccountHold({ customerId: 'c1', amount: 301 })).toEqual({ approved: false, reasonCode: 'insufficient-credit' });
      expect((await connector.requestAccountHold({ customerId: 'c1', amount: 300 })).approved).toBe(true);

      await push('l1', [cliente('c2')]);
      expect(await connector.requestAccountHold({ customerId: 'c2', amount: 1 })).toEqual({ approved: false, reasonCode: 'no-account' });
      expect(await connector.requestAccountHold({ customerId: 'nadie', amount: 1 })).toEqual({ approved: false, reasonCode: 'no-account' });
    });

    it('pedidos simultáneos no aprueban entre todos más que el límite', async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => connector.requestAccountHold({ customerId: 'c1', amount: 600 })));

      expect(results.filter((r) => r.approved)).toHaveLength(1);
      expect(await t.selectFrom('account_holds').select(['amount', 'status']).execute()).toEqual([{ amount: 600, status: 'pending' }]);
    });
  });

  describe('pull', () => {
    it('el cursor trae solo lo cambiado después, en orden estable; uno ilegible devuelve la foto completa', async () => {
      const viejo = '2026-10-01T10:00:00.000Z';
      const nuevo = '2026-10-01T11:00:00.000Z';
      await t
        .insertInto('products')
        .values([
          { id: 'p-b', sku: 'B', name: 'B', created_at: viejo, updated_at: viejo },
          { id: 'p-a', sku: 'A', name: 'A', created_at: viejo, updated_at: viejo },
          { id: 'p-c', sku: 'C', name: 'C', created_at: viejo, updated_at: nuevo, tracks_stock: false, blocked_reason: 'Discontinuado' },
        ])
        .execute();
      await t.insertInto('customers').values({ id: 'c1', name: 'Ana', unrestricted: true, credit_limit: 10, created_at: viejo, updated_at: nuevo }).execute();

      const full = await connector.pullCatalog({ cursors: {}, pendingLotIds: [] });
      expect(full.products.items.map((p) => p.id)).toEqual(['p-a', 'p-b', 'p-c']);
      expect(full.products.nextCursor).toBe(nuevo);
      expect(full.products.items[2]).toMatchObject({ barcodes: [], tracksStock: false, blocked: { reason: 'Discontinuado' }, createdAt: viejo });
      expect(full.products.items[0]).toMatchObject({ tracksStock: true, price: 0 });
      expect(full.customers.items).toEqual([{ id: 'c1', name: 'Ana', createdAt: viejo, updatedAt: nuevo, creditLimit: 10, unrestricted: true }]);

      const delta = await connector.pullCatalog({ cursors: { products: viejo, customers: nuevo }, pendingLotIds: [] });
      expect(delta.products.items.map((p) => p.id)).toEqual(['p-c']);
      expect(delta.customers.items).toEqual([]);
      expect(delta.customers).not.toHaveProperty('nextCursor');

      const roto = await connector.pullCatalog({ cursors: { products: 'no-es-un-cursor' }, pendingLotIds: [] });
      expect(roto.products.items).toHaveLength(3);
    });

    it('el stock es el de la sucursal pedida o, sin sucursal, la suma por producto', async () => {
      await t.insertInto('branches').values({ id: 'b2', name: 'Norte', code: 'NORTE', created_at: at }).execute();
      await t
        .insertInto('stock')
        .values([
          { product_id: 'p1', branch_id: 'branch-central', quantity: 5, updated_at: '2026-10-01T10:00:00.000Z' },
          { product_id: 'p1', branch_id: 'b2', quantity: 2.5, updated_at: '2026-10-01T11:00:00.000Z' },
          { product_id: 'p2', branch_id: 'b2', quantity: 1, updated_at: '2026-10-01T10:00:00.000Z' },
        ])
        .execute();

      expect((await connector.pullCatalog({ cursors: {}, pendingLotIds: [] })).stock).toEqual([
        { productId: 'p1', quantity: 7.5, updatedAt: '2026-10-01T11:00:00.000Z' },
        { productId: 'p2', quantity: 1, updatedAt: '2026-10-01T10:00:00.000Z' },
      ]);
      expect((await connector.pullCatalog({ cursors: {}, pendingLotIds: [], branchId: 'NORTE' })).stock).toEqual([
        { productId: 'p1', quantity: 2.5, updatedAt: '2026-10-01T11:00:00.000Z' },
        { productId: 'p2', quantity: 1, updatedAt: '2026-10-01T10:00:00.000Z' },
      ]);
    });

    it('devuelve el estado de los lotes consultados, con sus avisos', async () => {
      await push('l-ok', [venta('v1')]);
      await push('l-mal', [{ id: 'e-x', type: 'no-existe' }]);

      const pull = await connector.pullCatalog({ cursors: {}, pendingLotIds: ['l-ok', 'l-mal', 'l-nunca'] });
      expect(pull.lots).toEqual({
        'l-ok': { status: 'ok' },
        'l-mal': { status: 'issues', issues: [{ eventId: 'e-x', message: 'Tipo de evento no reconocido: no-existe' }] },
      });
    });
  });
});
