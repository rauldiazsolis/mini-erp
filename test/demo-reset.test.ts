import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import { TENANT_TABLES, type TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { DemoSessionService } from '../src/server/demo/demo-session-service.ts';
import { DemoResetService } from '../src/server/demo/demo-reset-service.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

const DAY = 24 * 60 * 60 * 1000;
const AT = '2026-10-05T12:00:00.000Z';
const TENANT_TABLE_NAMES = Object.keys(TENANT_TABLES) as (keyof TenantDatabase)[];

describe('reinicios del comercio demo (#24)', () => {
  let tenantManager: TenantManager;
  let apiKeyService: ApiKeyService;
  let service: DemoSessionService;
  let resets: DemoResetService;
  let clock: Date;
  let db: Kysely<TenantDatabase>;

  beforeEach(async () => {
    tenantManager = new TenantManager(pgDb());
    apiKeyService = new ApiKeyService(pgDb().system);
    clock = new Date('2026-10-05T15:00:00.000Z');
    service = new DemoSessionService({
      db: pgDb().system,
      tenantManager,
      apiKeyService,
      config: { enabled: true, ttlHours: 24, maxActive: 200, resetHour: 4 },
      now: () => clock,
    });
    resets = new DemoResetService({ db: pgDb().system, tenantManager, sessions: service, now: () => clock });
    await service.ensureDemoTenants();
    db = tenantManager.forTenant('demo-kiosco');
  });

  const countOf = async (table: keyof TenantDatabase): Promise<number> =>
    (await db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n;
  const product = (id: string, sku: string, name: string) => ({ id, sku, name, created_at: AT, updated_at: AT });
  const customer = (id: string, name: string) => ({ id, name, created_at: AT, updated_at: AT });

  it('el total deja el comercio como recién sembrado y revoca las cajas', async () => {
    const a = await service.create('kiosco');
    await db.insertInto('products').values(product('p_x', 'X-1', 'Vandalismo')).execute();
    await db.updateTable('products').set({ price: 1 }).where('id', '=', 'demo_KIO-001').execute();
    clock = new Date(clock.getTime() + DAY);
    expect(await resets.resetFull('kiosco')).toEqual({ revoked: 1 });
    expect(await db.selectFrom('products').select('id').where('id', '=', 'p_x').execute()).toEqual([]);
    expect(await db.selectFrom('products').select('price').where('id', '=', 'demo_KIO-001').executeTakeFirst()).toEqual({ price: 950 });
    expect(await apiKeyService.validateApiKey(a.apiKey)).toBeUndefined();
    expect(await pgDb().system.selectFrom('demo_sessions').select('revoke_reason as r').execute()).toEqual([{ r: 'reset' }]);
    const last = await db.selectFrom('sales').select((eb) => eb.fn.max('created_at').as('at')).executeTakeFirstOrThrow();
    expect(last.at > new Date(clock.getTime() - DAY).toISOString()).toBe(true); // historial al día
    expect(await pgDb().system.selectFrom('demo_tenants').select('last_full_reset_at as at').where('template', '=', 'kiosco').executeTakeFirst()).toEqual({
      at: clock.toISOString(),
    });
  });

  it('el total vacía todas las tablas del comercio, también las que no siembra', async () => {
    await db.insertInto('push_lots').values({ id: 'l1', device_id: 'd', status: 'ok', events: '[]', created_at: AT, updated_at: AT }).execute();
    await db.insertInto('tenant_settings').values({ key: 'k', value: 'v' }).execute();
    await db.insertInto('idempotency_keys').values({ key: 'i', status: 200, body: '{}', created_at: AT }).execute();
    await db
      .insertInto('discrepancies')
      .values({ id: 'd1', kind: 'k', customer_id: 'c', ref_type: 'sale', ref_id: 's', amount: 1, created_at: AT })
      .execute();
    // Un cliente de visitante con libro y reserva: las FK no frenan el vaciado
    await db.insertInto('customers').values(customer('c_y', 'Con movimientos')).execute();
    await db.insertInto('account_movements').values({ id: 'm_y', customer_id: 'c_y', type: 'sale', amount: 10, balance_after: 10, created_at: AT }).execute();
    await db.insertInto('account_holds').values({ id: 'h_y', customer_id: 'c_y', amount: 5, status: 'pending', created_at: AT }).execute();
    // Todas las tablas del manifiesto tienen algo antes del reinicio
    for (const table of TENANT_TABLE_NAMES) {
      expect(await countOf(table), table).toBeGreaterThan(0);
    }

    await resets.resetFull('kiosco');

    for (const table of ['push_lots', 'tenant_settings', 'idempotency_keys', 'discrepancies', 'account_holds'] as const) {
      expect(await countOf(table), table).toBe(0);
    }
    expect(await db.selectFrom('customers').select('id').where('id', '=', 'c_y').execute()).toEqual([]);
    expect(await db.selectFrom('account_movements').select('id').where('customer_id', '=', 'c_y').execute()).toEqual([]);
  });

  it('el total deja exactamente la semilla: lo mismo que un comercio recién sembrado', async () => {
    const snapshot = async (): Promise<Record<string, number>> => {
      const out: Record<string, number> = {};
      for (const table of TENANT_TABLE_NAMES) out[table] = await countOf(table);
      return out;
    };
    const seeded = await snapshot();
    await db.insertInto('products').values(product('p_x', 'X-1', 'Vandalismo')).execute();
    await db.deleteFrom('stock').where('product_id', '=', 'demo_KIO-003').execute();
    await resets.resetFull('kiosco');
    expect(await snapshot()).toEqual(seeded);
    // La sucursal por defecto vuelve a existir, con el stock de cada producto
    expect(await db.selectFrom('branches').select(['id', 'code']).execute()).toEqual([{ id: 'branch-central', code: 'CENTRAL' }]);
    expect(await db.selectFrom('stock').select('branch_id').distinct().execute()).toEqual([{ branch_id: 'branch-central' }]);
  });

  it('el total es atómico: si la siembra falla, el comercio queda como estaba', async () => {
    await db.insertInto('products').values(product('p_x', 'X-1', 'Vandalismo')).execute();
    const salesBefore = await countOf('sales');
    // La hora del reinicio no es una fecha: la siembra falla después de vaciar
    clock = new Date(Number.NaN);
    await expect(resets.resetFull('kiosco')).rejects.toThrow();
    expect(await countOf('sales')).toBe(salesBefore);
    expect(await db.selectFrom('products').select('id').where('id', '=', 'p_x').execute()).toEqual([{ id: 'p_x' }]);
  });

  it('el total de un rubro no toca a los otros', async () => {
    const b = await service.create('almacen');
    const almacen = tenantManager.forTenant('demo-almacen');
    await almacen.insertInto('tenant_settings').values({ key: 'k', value: 'v' }).execute();
    await resets.resetFull('kiosco');
    expect(await apiKeyService.validateApiKey(b.apiKey)).toBeDefined();
    expect(await almacen.selectFrom('tenant_settings').select('key').execute()).toEqual([{ key: 'k' }]);
  });

  it('el parcial restaura productos, stock y clientes y conserva ventas, saldos y cajas', async () => {
    const a = await service.create('kiosco');
    const salesBefore = await countOf('sales');
    const juanBalance = (await db.selectFrom('customers').select('balance').where('id', '=', 'cust-juan').executeTakeFirstOrThrow()).balance;
    await db.updateTable('products').set({ price: 1, name: 'ROTO', blocked_reason: 'x' }).where('id', '=', 'demo_KIO-001').execute();
    await db.deleteFrom('products').where('id', '=', 'demo_KIO-002').execute();
    await db.insertInto('products').values(product('p_x', 'KIO-002', 'Robó el SKU')).execute();
    await db.insertInto('stock').values({ product_id: 'p_x', branch_id: 'branch-central', quantity: 3, updated_at: AT }).execute();
    await db.insertInto('stock_movements').values({ id: 'k_x', product_id: 'p_x', branch_id: 'branch-central', delta: 3, reason: 'adjustment', created_at: AT }).execute();
    await db.updateTable('stock').set({ quantity: 0 }).where('product_id', '=', 'demo_KIO-003').execute();
    await db.updateTable('customers').set({ name: 'ROTO', credit_limit: 1 }).where('id', '=', 'cust-maria').execute();
    await db.insertInto('customers').values([customer('c_x', 'Sin movimientos'), customer('c_y', 'Con movimientos'), customer('c_z', 'Con una reserva')]).execute();
    await db.insertInto('account_movements').values({ id: 'm_y', customer_id: 'c_y', type: 'sale', amount: 10, balance_after: 10, created_at: AT }).execute();
    // Con una reserva y sin movimientos: la FK no deja borrarlo, así que tampoco se intenta
    await db.insertInto('account_holds').values({ id: 'h_z', customer_id: 'c_z', amount: 5, status: 'pending', created_at: AT }).execute();
    await db
      .insertInto('discrepancies')
      .values({ id: 'd1', kind: 'k', customer_id: 'c', ref_type: 'sale', ref_id: 's', amount: 1, created_at: AT })
      .execute();
    clock = new Date(clock.getTime() + 60_000);

    await resets.resetPartial('kiosco');

    expect(await db.selectFrom('products').select(['name', 'price', 'blocked_reason']).where('id', '=', 'demo_KIO-001').executeTakeFirst()).toEqual({
      name: 'Alfajor Triple Dulce de Leche',
      price: 950,
      blocked_reason: null,
    });
    expect(await db.selectFrom('products').select('sku').where('id', '=', 'demo_KIO-002').executeTakeFirst()).toEqual({ sku: 'KIO-002' });
    expect(await db.selectFrom('products').select('id').where('id', '=', 'p_x').execute()).toEqual([]);
    expect(await db.selectFrom('stock').select('product_id').where('product_id', '=', 'p_x').execute()).toEqual([]);
    expect(await db.selectFrom('stock_movements').select('id').where('product_id', '=', 'p_x').execute()).toEqual([]);
    expect(await db.selectFrom('stock').select('quantity').where('product_id', '=', 'demo_KIO-003').executeTakeFirst()).toEqual({ quantity: 35 });
    expect(
      await db
        .selectFrom('stock_movements')
        .select(['reason', 'notes', 'delta'])
        .where('product_id', '=', 'demo_KIO-003')
        .orderBy('seq', 'desc')
        .limit(1)
        .executeTakeFirst(),
    ).toEqual({ reason: 'inventory_count', notes: 'Reinicio parcial de la demo', delta: 35 });
    // Un movimiento de inventario por producto de la semilla
    expect(await db.selectFrom('stock_movements').select('id').where('reason', '=', 'inventory_count').execute()).toHaveLength(8);
    expect(await db.selectFrom('customers').select(['name', 'credit_limit']).where('id', '=', 'cust-maria').executeTakeFirst()).toEqual({
      name: 'María Gómez',
      credit_limit: 30000,
    });
    expect(await db.selectFrom('customers').select('id').where('id', 'in', ['c_x', 'c_y', 'c_z']).orderBy('id').execute()).toEqual([{ id: 'c_y' }, { id: 'c_z' }]);
    expect(await db.selectFrom('customers').select('balance').where('id', '=', 'cust-juan').executeTakeFirst()).toEqual({ balance: juanBalance });
    expect(await countOf('sales')).toBe(salesBefore);
    expect(await db.selectFrom('discrepancies').select(['resolution', 'resolved_at', 'resolved_by']).where('id', '=', 'd1').executeTakeFirst()).toEqual({
      resolution: 'dismissed',
      resolved_at: clock.toISOString(),
      resolved_by: 'system',
    });
    expect(await apiKeyService.validateApiKey(a.apiKey)).toBeDefined();
    expect(await db.selectFrom('products').select('updated_at').where('id', '=', 'demo_KIO-004').executeTakeFirst()).toEqual({ updated_at: clock.toISOString() });
    expect(await db.selectFrom('customers').select('updated_at').where('id', '=', 'cust-cf').executeTakeFirst()).toEqual({ updated_at: clock.toISOString() });
    expect(
      await pgDb().system.selectFrom('demo_tenants').select('last_partial_reset_at as at').where('template', '=', 'kiosco').executeTakeFirst(),
    ).toEqual({ at: clock.toISOString() });
  });

  it('el parcial devuelve un cliente de la semilla borrado con el saldo de su último movimiento', async () => {
    const juanBalance = (await db.selectFrom('customers').select('balance').where('id', '=', 'cust-juan').executeTakeFirstOrThrow()).balance;
    // María no tiene movimientos: se puede borrar; a Juan se le pisa el saldo
    await db.deleteFrom('customers').where('id', '=', 'cust-maria').execute();
    await db.updateTable('customers').set({ balance: 1 }).where('id', '=', 'cust-juan').execute();
    await resets.resetPartial('kiosco');
    expect(await db.selectFrom('customers').select(['name', 'balance']).where('id', '=', 'cust-maria').executeTakeFirst()).toEqual({ name: 'María Gómez', balance: 0 });
    // El saldo de uno que sigue ahí no se toca (conserva saldos): ni siquiera el pisado a mano
    expect(juanBalance).toBeGreaterThan(1);
    expect(await db.selectFrom('customers').select('balance').where('id', '=', 'cust-juan').executeTakeFirst()).toEqual({ balance: 1 });
  });
});
