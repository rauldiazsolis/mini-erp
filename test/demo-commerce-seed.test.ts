import { describe, it, expect } from 'vitest';
import type { Kysely } from 'kysely';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { DEMO_CUSTOMERS, KIOSCO_PRODUCTS } from '../src/server/seeds/index.ts';
import { DEMO_BRANCH_ID, demoProductId, seedDemoCommerce } from '../src/server/seeds/demo-commerce.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

const now = new Date('2026-10-05T15:00:00.000Z');

/** El esquema de un comercio recién creado, que ya trae su sucursal por defecto. */
async function fresh(id = 'comercio'): Promise<Kysely<TenantDatabase>> {
  const manager = new TenantManager(pgDb());
  await manager.createTenant({ id, slug: id, name: id });
  return manager.forTenant(id);
}

const countOf = async (db: Kysely<TenantDatabase>, table: keyof TenantDatabase): Promise<number> =>
  (await db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n;

describe('semilla del comercio demo (#24)', () => {
  it('crea la sucursal, el catálogo con ids deterministas y su stock', async () => {
    const db = await fresh();
    await seedDemoCommerce(db, 'kiosco', now);
    expect(await db.selectFrom('branches').select(['id', 'code']).execute()).toEqual([{ id: DEMO_BRANCH_ID, code: 'CENTRAL' }]);
    const ids = (await db.selectFrom('products').select('id').orderBy('id').execute()).map((r) => r.id);
    expect(ids).toEqual(KIOSCO_PRODUCTS.map((p) => demoProductId(p.sku)).sort());
    const stock = await db.selectFrom('stock').select('product_id').where('branch_id', '=', DEMO_BRANCH_ID).execute();
    expect(stock.length).toBe(KIOSCO_PRODUCTS.length);
  });

  it('en un esquema sin sucursal (después de vaciarlo), la crea', async () => {
    const db = await fresh();
    await db.deleteFrom('branches').execute();
    await seedDemoCommerce(db, 'kiosco', now);
    expect(await db.selectFrom('branches').select(['id', 'name', 'code', 'created_at']).execute()).toEqual([
      { id: DEMO_BRANCH_ID, name: 'Sucursal Central', code: 'CENTRAL', created_at: now.toISOString() },
    ]);
  });

  it('crea los clientes demo y 30 días de historial de dos cajas, nada después de now', async () => {
    const db = await fresh();
    await seedDemoCommerce(db, 'kiosco', now);
    expect(await countOf(db, 'customers')).toBe(DEMO_CUSTOMERS.length);
    const cajas = await db.selectFrom('sales').select('point_of_sale as pos').distinct().orderBy('pos').execute();
    expect(cajas).toEqual([{ pos: 'Caja 1' }, { pos: 'Caja 2' }]);
    const days = await db.selectFrom('sales').select('day').distinct().execute();
    expect(days.length).toBeGreaterThanOrEqual(29);
    const last = await db.selectFrom('sales').select((eb) => eb.fn.max('created_at').as('at')).executeTakeFirstOrThrow();
    expect(last.at <= now.toISOString()).toBe(true);
    expect(await db.selectFrom('sales').select('id').where('register_id', 'is not', null).execute()).toEqual([]);
  });

  it('el historial deja el kardex, el stock y la cuenta corriente cuadrados', async () => {
    const db = await fresh();
    await seedDemoCommerce(db, 'kiosco', now);
    // Las cantidades fijas del historial: 30 días de dos cajas
    expect(await countOf(db, 'sales')).toBe(238);
    expect(await countOf(db, 'stock_movements')).toBe(296);
    expect(await countOf(db, 'cash_movements')).toBe(92);
    expect(await countOf(db, 'customer_payments')).toBe(2);

    // El stock final de cada producto: el de la semilla menos lo vendido, con el piso en cero
    // (los mismos valores que daba la semilla sobre SQLite, venta por venta)
    expect(await db.selectFrom('stock').select(['product_id', 'quantity']).orderBy('product_id').execute()).toEqual([
      { product_id: 'demo_KIO-001', quantity: 2 },
      { product_id: 'demo_KIO-002', quantity: 18 },
      { product_id: 'demo_KIO-003', quantity: 0 },
      { product_id: 'demo_KIO-004', quantity: 22 },
      { product_id: 'demo_KIO-005', quantity: 26 },
      { product_id: 'demo_KIO-006', quantity: 0 },
      { product_id: 'demo_KIO-007', quantity: 0 },
      { product_id: 'demo_KIO-008', quantity: 0 },
    ]);
    // El kardex no baja más de lo que había: un producto que no llegó a cero cuadra con sus movimientos
    const moved = await db.selectFrom('stock_movements').select((eb) => eb.fn.sum<number>('delta').as('delta')).where('product_id', '=', 'demo_KIO-002').executeTakeFirstOrThrow();
    expect(60 + moved.delta).toBe(18);

    // El saldo de Juan es el último `balance_after` y la suma de sus movimientos
    const juan = await db.selectFrom('customers').select('balance').where('id', '=', 'cust-juan').executeTakeFirstOrThrow();
    const movements = await db.selectFrom('account_movements').select(['type', 'amount', 'balance_after']).where('customer_id', '=', 'cust-juan').orderBy('seq').execute();
    expect(movements[0]).toEqual({ type: 'adjustment', amount: 12500, balance_after: 12500 });
    expect(movements.filter((m) => m.type === 'payment')).toHaveLength(2);
    expect(juan.balance).toBe(46300);
    expect(movements.reduce((sum, m) => sum + m.amount, 0)).toBe(juan.balance);
    expect(movements.at(-1)?.balance_after).toBe(juan.balance);
    let running = 0;
    for (const m of movements) {
      running += m.amount;
      expect(m.balance_after).toBe(running);
    }
  });

  it('si falla a mitad de camino, no deja nada (una transacción)', async () => {
    const db = await fresh();
    // Un cliente de la semilla que ya existe hace fallar el insert de clientes, después del catálogo
    await db.insertInto('customers').values({ id: 'cust-juan', name: 'Ya estaba', created_at: now.toISOString(), updated_at: now.toISOString() }).execute();
    await expect(seedDemoCommerce(db, 'kiosco', now)).rejects.toThrow();
    expect(await countOf(db, 'products')).toBe(0);
    expect(await countOf(db, 'stock')).toBe(0);
  });

  it('es determinista salvo las fechas: dos siembras dan los mismos ids', async () => {
    const a = await fresh('a');
    const b = await fresh('b');
    await seedDemoCommerce(a, 'almacen', now);
    await seedDemoCommerce(b, 'almacen', new Date('2026-10-06T15:00:00.000Z'));
    const ids = async (db: Kysely<TenantDatabase>): Promise<string[]> =>
      [
        ...(await db.selectFrom('products').select('id').execute()),
        ...(await db.selectFrom('customers').select('id').execute()),
        ...(await db.selectFrom('sales').select('id').execute()),
        ...(await db.selectFrom('stock_movements').select('id').execute()),
        ...(await db.selectFrom('cash_movements').select('id').execute()),
        ...(await db.selectFrom('customer_payments').select('id').execute()),
      ]
        .map((r) => r.id)
        .sort();
    expect(await ids(a)).toEqual(await ids(b));
  });
});
