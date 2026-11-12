import type { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
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
  db: Kysely<SystemDatabase>;
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

  async resetFull(template: DemoTemplate): Promise<{ revoked: number }> {
    const tenantId = await this.deps.sessions.ensureDemoTenant(template);
    const now = this.deps.now();
    const db = this.deps.tenantManager.getTenantDb(tenantId);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    await inTransaction(db, async () => {
      for (const t of tables) db.exec(`DELETE FROM "${t.name}"`);
      await seedDemoCommerce(db, template, now);
    });
    const revoked = await this.deps.sessions.revokeTenant(tenantId, 'reset');
    await this.deps.db.updateTable('demo_tenants').set({ last_full_reset_at: now.toISOString() }).where('tenant_id', '=', tenantId).execute();
    return { revoked };
  }

  async resetPartial(template: DemoTemplate): Promise<void> {
    const tenantId = await this.deps.sessions.ensureDemoTenant(template);
    const at = this.deps.now().toISOString();
    const db = this.deps.tenantManager.getTenantDb(tenantId);
    const products = demoSeedProducts(template);
    const customers = DEMO_CUSTOMERS.filter((c): c is SeedCustomer & { id: string } => c.id !== undefined);
    const productIds = sqlList(products.map((p) => p.id));
    const customerIds = sqlList(customers.map((c) => c.id));
    await inTransaction(db, async () => {
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
        await writeStock(db, {
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
    await this.deps.db.updateTable('demo_tenants').set({ last_partial_reset_at: at }).where('tenant_id', '=', tenantId).execute();
  }

  /** Los rubros cuyo último reinicio total es anterior a la hora del reinicio automático más reciente. */
  async dueTemplates(): Promise<DemoTemplate[]> {
    const boundary = lastResetBoundary(this.deps.now(), this.deps.sessions.resetHour()).toISOString();
    const rows = await this.deps.db.selectFrom('demo_tenants').select('template').where('last_full_reset_at', '<', boundary).orderBy('seq').execute();
    return rows.map((r) => r.template).filter(isDemoTemplate);
  }

  /** El reinicio automático (#24): hace los que tocan y devuelve cuáles. */
  async runDue(): Promise<DemoTemplate[]> {
    const due = await this.dueTemplates();
    for (const t of due) await this.resetFull(t);
    return due;
  }

  /** El estado de los comercios demo para la plataforma (#24): cajas activas, demos y ventas de hoy, reinicios. */
  async status(): Promise<DemoStatusItem[]> {
    const today = argentinaToday(this.deps.now());
    const dayStart = new Date(`${today}T00:00:00.000-03:00`).toISOString();
    const rows = await this.deps.db
      .selectFrom('demo_tenants as d')
      .innerJoin('tenants as t', 't.id', 'd.tenant_id')
      .select((eb) => [
        'd.tenant_id',
        'd.template',
        'd.last_full_reset_at',
        'd.last_partial_reset_at',
        't.name',
        eb
          .selectFrom('demo_sessions as s')
          .select((sub) => sub.fn.countAll<number>().as('n'))
          .whereRef('s.tenant_id', '=', 'd.tenant_id')
          .where('s.revoked_at', 'is', null)
          .as('active'),
        eb
          .selectFrom('demo_sessions as s')
          .select((sub) => sub.fn.countAll<number>().as('n'))
          .whereRef('s.tenant_id', '=', 'd.tenant_id')
          .where('s.created_at', '>=', dayStart)
          .as('created'),
      ])
      .orderBy('d.seq')
      .execute();
    const items: DemoStatusItem[] = [];
    for (const r of rows) {
      items.push(await this.salesToday({ ...r, active: r.active ?? 0, created: r.created ?? 0 }, today));
    }
    return items;
  }

  /** La fila de un comercio demo con sus ventas de hoy (su base de comercio). */
  private async salesToday(
    r: { tenant_id: string; template: string; last_full_reset_at: string; last_partial_reset_at: string | null; name: string; active: number; created: number },
    today: string,
  ): Promise<DemoStatusItem> {
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
  }

  /** Repone los productos de la semilla que bajaron de un cuarto de su cantidad inicial. Un producto borrado no. */
  async restock(): Promise<number> {
    const at = this.deps.now().toISOString();
    let restocked = 0;
    const rows = await this.deps.db.selectFrom('demo_tenants').select(['tenant_id', 'template']).orderBy('seq').execute();
    for (const row of rows) {
      const template = row.template;
      if (!isDemoTemplate(template)) continue;
      const db = this.deps.tenantManager.getTenantDb(row.tenant_id);
      const qty = db.prepare('SELECT s.quantity FROM stock s JOIN products p ON p.id = s.product_id WHERE s.product_id = ? AND s.branch_id = ?');
      await inTransaction(db, async () => {
        for (const p of demoSeedProducts(template)) {
          const current = (qty.get(p.id, DEMO_BRANCH_ID) as { quantity: number } | undefined)?.quantity;
          if (current === undefined || current >= p.stock / 4) continue;
          await writeStock(db, {
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

async function inTransaction(db: DatabaseSync, work: () => Promise<void>): Promise<void> {
  db.exec('BEGIN');
  try {
    await work();
    db.exec('COMMIT');
  } catch (err: unknown) {
    db.exec('ROLLBACK');
    throw err;
  }
}
