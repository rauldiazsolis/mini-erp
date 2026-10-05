import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { DemoSessionService } from '../src/server/demo/demo-session-service.ts';
import { DemoResetService } from '../src/server/demo/demo-reset-service.ts';

const DAY = 24 * 60 * 60 * 1000;

describe('reinicios del comercio demo (#24)', () => {
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let apiKeyService: ApiKeyService;
  let service: DemoSessionService;
  let resets: DemoResetService;
  let clock: Date;
  let db: DatabaseSync;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    apiKeyService = new ApiKeyService(systemDb);
    clock = new Date('2026-10-05T15:00:00.000Z');
    service = new DemoSessionService({
      systemDb,
      tenantManager,
      apiKeyService,
      config: { enabled: true, ttlHours: 24, maxActive: 200, resetHour: 4 },
      now: () => clock,
    });
    resets = new DemoResetService({ systemDb, tenantManager, sessions: service, now: () => clock });
    service.ensureDemoTenants();
    db = tenantManager.getTenantDb('demo-kiosco');
  });

  it('el total deja el comercio como recién sembrado y revoca las cajas', () => {
    const a = service.create('kiosco');
    db.prepare("INSERT INTO products (id, sku, name, created_at, updated_at) VALUES ('p_x', 'X-1', 'Vandalismo', 'x', 'x')").run();
    db.prepare("UPDATE products SET price = 1 WHERE id = 'demo_KIO-001'").run();
    clock = new Date(clock.getTime() + DAY);
    expect(resets.resetFull('kiosco')).toEqual({ revoked: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM products WHERE id = 'p_x'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT price FROM products WHERE id = 'demo_KIO-001'").get()).toEqual({ price: 950 });
    expect(apiKeyService.validateApiKey(a.apiKey)).toBeUndefined();
    expect(systemDb.prepare('SELECT revoke_reason AS r FROM demo_sessions').all()).toEqual([{ r: 'reset' }]);
    const last = db.prepare('SELECT MAX(created_at) AS at FROM sales').get() as { at: string };
    expect(last.at > new Date(clock.getTime() - DAY).toISOString()).toBe(true); // historial al día
    expect(systemDb.prepare("SELECT last_full_reset_at AS at FROM demo_tenants WHERE template = 'kiosco'").get()).toEqual({
      at: clock.toISOString(),
    });
  });

  it('el total vacía todas las tablas del comercio, también las que no siembra', () => {
    db.prepare("INSERT INTO push_lots (id, device_id, status, events, created_at, updated_at) VALUES ('l1', 'd', 'ok', '[]', 'x', 'x')").run();
    db.prepare("INSERT INTO tenant_settings (key, value) VALUES ('k', 'v')").run();
    resets.resetFull('kiosco');
    expect(db.prepare('SELECT COUNT(*) AS n FROM push_lots').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tenant_settings').get()).toEqual({ n: 0 });
  });

  it('el total de un rubro no toca a los otros', () => {
    const b = service.create('almacen');
    resets.resetFull('kiosco');
    expect(apiKeyService.validateApiKey(b.apiKey)).toBeDefined();
  });

  it('el parcial restaura productos, stock y clientes y conserva ventas, saldos y cajas', () => {
    const a = service.create('kiosco');
    const salesBefore = (db.prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number }).n;
    const juanBalance = (db.prepare("SELECT balance FROM customers WHERE id = 'cust-juan'").get() as { balance: number }).balance;
    db.prepare("UPDATE products SET price = 1, name = 'ROTO', blocked_reason = 'x' WHERE id = 'demo_KIO-001'").run();
    db.prepare("DELETE FROM products WHERE id = 'demo_KIO-002'").run();
    db.prepare("INSERT INTO products (id, sku, name, created_at, updated_at) VALUES ('p_x', 'KIO-002', 'Robó el SKU', 'x', 'x')").run();
    db.prepare("UPDATE stock SET quantity = 0 WHERE product_id = 'demo_KIO-003'").run();
    db.prepare("UPDATE customers SET name = 'ROTO', credit_limit = 1 WHERE id = 'cust-maria'").run();
    db.prepare("INSERT INTO customers (id, name, created_at, updated_at) VALUES ('c_x', 'Sin movimientos', 'x', 'x')").run();
    db.prepare("INSERT INTO customers (id, name, created_at, updated_at) VALUES ('c_y', 'Con movimientos', 'x', 'x')").run();
    db.prepare("INSERT INTO account_movements (id, customer_id, type, amount, balance_after, created_at) VALUES ('m_y', 'c_y', 'sale', 10, 10, 'x')").run();
    db.prepare(
      "INSERT INTO discrepancies (id, kind, customer_id, ref_type, ref_id, amount, created_at) VALUES ('d1', 'k', 'c', 'sale', 's', 1, 'x')",
    ).run();
    clock = new Date(clock.getTime() + 60_000);

    resets.resetPartial('kiosco');

    expect(db.prepare("SELECT name, price, blocked_reason FROM products WHERE id = 'demo_KIO-001'").get()).toEqual({
      name: 'Alfajor Triple Dulce de Leche',
      price: 950,
      blocked_reason: null,
    });
    expect(db.prepare("SELECT sku FROM products WHERE id = 'demo_KIO-002'").get()).toEqual({ sku: 'KIO-002' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM products WHERE id = 'p_x'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT quantity FROM stock WHERE product_id = 'demo_KIO-003'").get()).toEqual({ quantity: 35 });
    expect(
      db.prepare("SELECT reason FROM stock_movements WHERE product_id = 'demo_KIO-003' ORDER BY created_at DESC LIMIT 1").get(),
    ).toEqual({ reason: 'inventory_count' });
    expect(db.prepare("SELECT name, credit_limit FROM customers WHERE id = 'cust-maria'").get()).toEqual({
      name: 'María Gómez',
      credit_limit: 30000,
    });
    expect(db.prepare("SELECT id FROM customers WHERE id IN ('c_x', 'c_y')").all()).toEqual([{ id: 'c_y' }]);
    expect(db.prepare("SELECT balance FROM customers WHERE id = 'cust-juan'").get()).toEqual({ balance: juanBalance });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: salesBefore });
    expect(db.prepare("SELECT resolution FROM discrepancies WHERE id = 'd1'").get()).toEqual({ resolution: 'dismissed' });
    expect(apiKeyService.validateApiKey(a.apiKey)).toBeDefined();
    expect(db.prepare("SELECT updated_at FROM products WHERE id = 'demo_KIO-004'").get()).toEqual({ updated_at: clock.toISOString() });
    expect(db.prepare("SELECT updated_at FROM customers WHERE id = 'cust-cf'").get()).toEqual({ updated_at: clock.toISOString() });
    expect(systemDb.prepare("SELECT last_partial_reset_at AS at FROM demo_tenants WHERE template = 'kiosco'").get()).toEqual({
      at: clock.toISOString(),
    });
  });
});
