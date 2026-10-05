import type { DatabaseSync } from 'node:sqlite';
import type { TenantManager } from '../db/tenant-manager.ts';
import { writeStock } from '../stock/write-stock.ts';
import {
  DEMO_BRANCH_ID,
  DEMO_CUSTOMERS,
  demoSeedProducts,
  isDemoTemplate,
  seedDemoCommerce,
  type DemoTemplate,
  type SeedCustomer,
} from '../seeds/index.ts';
import type { DemoSessionService } from './demo-session-service.ts';
import { lastResetBoundary } from './reset-schedule.ts';
import { argentinaToday } from '../../shared/argentina-day.ts';
import type { DemoStatusItem } from '../../shared/demo-types.ts';

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

  /** Los rubros cuyo último reinicio total es anterior a la hora del reinicio automático más reciente. */
  dueTemplates(): DemoTemplate[] {
    const boundary = lastResetBoundary(this.deps.now(), this.deps.sessions.resetHour()).toISOString();
    const rows = this.deps.systemDb
      .prepare('SELECT template FROM demo_tenants WHERE last_full_reset_at < ? ORDER BY rowid')
      .all(boundary) as { template: string }[];
    return rows.map((r) => r.template).filter(isDemoTemplate);
  }

  /** El reinicio automático (#24): hace los que tocan y devuelve cuáles. */
  runDue(): DemoTemplate[] {
    const due = this.dueTemplates();
    for (const t of due) this.resetFull(t);
    return due;
  }

  /** El estado de los comercios demo para la plataforma (#24): cajas activas, demos y ventas de hoy, reinicios. */
  status(): DemoStatusItem[] {
    const today = argentinaToday(this.deps.now());
    const dayStart = new Date(`${today}T00:00:00.000-03:00`).toISOString();
    const rows = this.deps.systemDb
      .prepare(
        `SELECT d.tenant_id, d.template, d.last_full_reset_at, d.last_partial_reset_at, t.name,
           (SELECT COUNT(*) FROM demo_sessions s WHERE s.tenant_id = d.tenant_id AND s.revoked_at IS NULL) AS active,
           (SELECT COUNT(*) FROM demo_sessions s WHERE s.tenant_id = d.tenant_id AND s.created_at >= ?) AS created
         FROM demo_tenants d JOIN tenants t ON t.id = d.tenant_id ORDER BY d.rowid`,
      )
      .all(dayStart) as {
      tenant_id: string;
      template: string;
      last_full_reset_at: string;
      last_partial_reset_at: string | null;
      name: string;
      active: number;
      created: number;
    }[];
    return rows.map((r) => {
      const db = this.deps.tenantManager.getTenantDb(r.tenant_id);
      const sales = db.prepare('SELECT COUNT(*) AS n FROM sales WHERE day = ? AND voids_sale_id IS NULL').get(today) as { n: number };
      return {
        template: r.template,
        tenantId: r.tenant_id,
        name: r.name,
        activeRegisters: r.active,
        createdToday: r.created,
        salesToday: sales.n,
        lastFullResetAt: r.last_full_reset_at,
        lastPartialResetAt: r.last_partial_reset_at,
      };
    });
  }

  /** Repone los productos de la semilla que bajaron de un cuarto de su cantidad inicial. Un producto borrado no. */
  restock(): number {
    const at = this.deps.now().toISOString();
    let restocked = 0;
    const rows = this.deps.systemDb.prepare('SELECT tenant_id, template FROM demo_tenants ORDER BY rowid').all() as {
      tenant_id: string;
      template: string;
    }[];
    for (const row of rows) {
      const template = row.template;
      if (!isDemoTemplate(template)) continue;
      const db = this.deps.tenantManager.getTenantDb(row.tenant_id);
      const qty = db.prepare('SELECT s.quantity FROM stock s JOIN products p ON p.id = s.product_id WHERE s.product_id = ? AND s.branch_id = ?');
      inTransaction(db, () => {
        for (const p of demoSeedProducts(template)) {
          const current = (qty.get(p.id, DEMO_BRANCH_ID) as { quantity: number } | undefined)?.quantity;
          if (current === undefined || current >= p.stock / 4) continue;
          writeStock(db, {
            productId: p.id,
            branchId: DEMO_BRANCH_ID,
            type: 'set',
            quantity: p.stock,
            reason: 'restock',
            notes: 'Reposición automática',
            now: at,
          });
          restocked++;
        }
      });
    }
    return restocked;
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
