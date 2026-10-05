import type { DatabaseSync } from 'node:sqlite';
import type { TenantManager } from '../db/tenant-manager.ts';
import { writeStock } from '../stock/write-stock.ts';
import { DEMO_BRANCH_ID, DEMO_CUSTOMERS, demoSeedProducts, seedDemoCommerce, type DemoTemplate, type SeedCustomer } from '../seeds/index.ts';
import type { DemoSessionService } from './demo-session-service.ts';

export type DemoResetDeps = {
  systemDb: DatabaseSync;
  tenantManager: TenantManager;
  sessions: DemoSessionService;
  now: () => Date;
};

/**
 * Reinicios de los comercios demo (#24). El total vuelve a la foto inicial (vacía y vuelve a sembrar)
 * y revoca las cajas de visitante; el parcial deshace el vandalismo en catálogo, stock y clientes sin
 * cortarle la demo a nadie. Sincrónicos: ningún push queda en el medio.
 */
export class DemoResetService {
  private deps: DemoResetDeps;

  constructor(deps: DemoResetDeps) {
    this.deps = deps;
  }

  resetFull(template: DemoTemplate): { revoked: number } {
    const tenantId = this.deps.sessions.ensureDemoTenant(template);
    const now = this.deps.now();
    const db = this.deps.tenantManager.getTenantDb(tenantId);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    inTransaction(db, () => {
      for (const t of tables) db.exec(`DELETE FROM "${t.name}"`);
      seedDemoCommerce(db, template, now);
    });
    const revoked = this.deps.sessions.revokeTenant(tenantId, 'reset');
    this.deps.systemDb.prepare('UPDATE demo_tenants SET last_full_reset_at = ? WHERE tenant_id = ?').run(now.toISOString(), tenantId);
    return { revoked };
  }

  resetPartial(template: DemoTemplate): void {
    const tenantId = this.deps.sessions.ensureDemoTenant(template);
    const at = this.deps.now().toISOString();
    const db = this.deps.tenantManager.getTenantDb(tenantId);
    const products = demoSeedProducts(template);
    const customers = DEMO_CUSTOMERS.filter((c): c is SeedCustomer & { id: string } => c.id !== undefined);
    const productIds = sqlList(products.map((p) => p.id));
    const customerIds = sqlList(customers.map((c) => c.id));
    inTransaction(db, () => {
      // Los productos de visitantes afuera (con su stock y su kardex), antes de devolverles el SKU a los de la semilla
      db.exec(`DELETE FROM stock WHERE product_id NOT IN (${productIds})`);
      db.exec(`DELETE FROM stock_movements WHERE product_id NOT IN (${productIds})`);
      db.exec(`DELETE FROM products WHERE id NOT IN (${productIds})`);
      const upsertProduct = db.prepare(
        `INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET sku = excluded.sku, barcodes = excluded.barcodes, name = excluded.name, price = excluded.price,
           tax_rate = excluded.tax_rate, category = excluded.category, tracks_stock = 1, blocked_reason = NULL, updated_at = excluded.updated_at`,
      );
      for (const p of products) {
        upsertProduct.run(p.id, p.sku, JSON.stringify(p.barcodes), p.name, p.price, p.taxRate ?? 0.21, p.category, at, at);
        writeStock(db, {
          productId: p.id,
          branchId: DEMO_BRANCH_ID,
          type: 'set',
          quantity: p.stock,
          reason: 'inventory_count',
          notes: 'Reinicio parcial de la demo',
          now: at,
        });
      }
      // Los clientes de visitantes sin movimientos afuera; con movimientos quedan (su libro sale de ventas que se conservan)
      db.exec(`DELETE FROM customers WHERE id NOT IN (${customerIds}) AND id NOT IN (SELECT customer_id FROM account_movements)`);
      const lastBalance = db.prepare(
        'SELECT balance_after FROM account_movements WHERE customer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      );
      const upsertCustomer = db.prepare(
        `INSERT INTO customers (id, name, document, phone, credit_limit, margin, balance, unrestricted, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, document = excluded.document, phone = excluded.phone,
           credit_limit = excluded.credit_limit, margin = excluded.margin, unrestricted = excluded.unrestricted,
           blocked_reason = NULL, updated_at = excluded.updated_at`,
      );
      for (const c of customers) {
        const balance = (lastBalance.get(c.id) as { balance_after: number } | undefined)?.balance_after ?? c.balance;
        upsertCustomer.run(c.id, c.name, c.document ?? null, c.phone ?? null, c.creditLimit, c.margin, balance, c.unrestricted === true ? 1 : 0, at, at);
      }
      db.prepare(
        "UPDATE discrepancies SET resolved_at = ?, resolution = 'dismissed', resolved_by = 'system', note = 'Reinicio parcial de la demo' WHERE resolved_at IS NULL",
      ).run(at);
    });
    this.deps.systemDb.prepare('UPDATE demo_tenants SET last_partial_reset_at = ? WHERE tenant_id = ?').run(at, tenantId);
  }
}

/** Ids fijos del código (nunca de un visitante) como lista de SQL. */
function sqlList(ids: string[]): string {
  return ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
}

function inTransaction(db: DatabaseSync, work: () => void): void {
  db.exec('BEGIN');
  try {
    work();
    db.exec('COMMIT');
  } catch (err: unknown) {
    db.exec('ROLLBACK');
    throw err;
  }
}
