import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { DEMO_CUSTOMERS, KIOSCO_PRODUCTS } from '../src/server/seeds/index.ts';
import { DEMO_BRANCH_ID, demoProductId, seedDemoCommerce } from '../src/server/seeds/demo-commerce.ts';

const now = new Date('2026-10-05T15:00:00.000Z');

function fresh(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  initTenantDb(db);
  return db;
}

describe('semilla del comercio demo (#24)', () => {
  it('crea la sucursal, el catálogo con ids deterministas y su stock', () => {
    const db = fresh();
    seedDemoCommerce(db, 'kiosco', now);
    expect(db.prepare('SELECT id, code FROM branches').all()).toEqual([{ id: DEMO_BRANCH_ID, code: 'CENTRAL' }]);
    const ids = (db.prepare('SELECT id FROM products ORDER BY id').all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(KIOSCO_PRODUCTS.map((p) => demoProductId(p.sku)).sort());
    const stock = db.prepare('SELECT COUNT(*) AS n FROM stock WHERE branch_id = ?').get(DEMO_BRANCH_ID) as { n: number };
    expect(stock.n).toBe(KIOSCO_PRODUCTS.length);
  });

  it('crea los clientes demo y 30 días de historial de dos cajas, nada después de now', () => {
    const db = fresh();
    seedDemoCommerce(db, 'kiosco', now);
    expect((db.prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number }).n).toBe(DEMO_CUSTOMERS.length);
    const cajas = db.prepare('SELECT DISTINCT point_of_sale AS pos FROM sales ORDER BY pos').all();
    expect(cajas).toEqual([{ pos: 'Caja 1' }, { pos: 'Caja 2' }]);
    const days = db.prepare('SELECT COUNT(DISTINCT day) AS n FROM sales').get() as { n: number };
    expect(days.n).toBeGreaterThanOrEqual(29);
    const last = db.prepare('SELECT MAX(created_at) AS at FROM sales').get() as { at: string };
    expect(last.at <= now.toISOString()).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sales WHERE register_id IS NOT NULL').get()).toEqual({ n: 0 });
  });

  it('es determinista salvo las fechas: dos siembras dan los mismos ids', () => {
    const a = fresh();
    const b = fresh();
    seedDemoCommerce(a, 'almacen', now);
    seedDemoCommerce(b, 'almacen', new Date('2026-10-06T15:00:00.000Z'));
    const ids = (db: DatabaseSync): unknown => db.prepare('SELECT id FROM products UNION ALL SELECT id FROM customers ORDER BY 1').all();
    expect(ids(a)).toEqual(ids(b));
  });
});
