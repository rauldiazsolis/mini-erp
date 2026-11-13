import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { TENANT_TABLES } from '../db/pg/tenant-schema.ts';
import type { TenantManager } from '../db/tenant-manager.ts';
import { setStockMany } from '../stock/write-stock.ts';
import {
  DEMO_BRANCH_ID,
  DEMO_CUSTOMERS,
  demoProductRow,
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
    // Vaciar y volver a sembrar es una sola transacción del comercio: nadie ve la demo a medias
    await this.deps.tenantManager.forTenant(tenantId).transaction().execute(async (trx) => {
      for (const table of TABLES_TO_EMPTY) {
        await trx.deleteFrom(table).execute();
      }
      await seedDemoCommerce(trx, template, now);
    });
    // Lo de sistema, después y fuera de esa transacción
    const revoked = await this.deps.sessions.revokeTenant(tenantId, 'reset');
    await this.deps.db.updateTable('demo_tenants').set({ last_full_reset_at: now.toISOString() }).where('tenant_id', '=', tenantId).execute();
    return { revoked };
  }

  async resetPartial(template: DemoTemplate): Promise<void> {
    const tenantId = await this.deps.sessions.ensureDemoTenant(template);
    const at = this.deps.now().toISOString();
    const products = demoSeedProducts(template);
    const customers = DEMO_CUSTOMERS.filter((c): c is SeedCustomer & { id: string } => c.id !== undefined);
    const productIds = products.map((p) => p.id);
    const customerIds = customers.map((c) => c.id);
    await this.deps.tenantManager.forTenant(tenantId).transaction().execute(async (trx) => {
      // Los productos de visitantes afuera (con su stock y su kardex), antes de devolverles el SKU a los de la semilla
      await trx.deleteFrom('stock').where('product_id', 'not in', productIds).execute();
      await trx.deleteFrom('stock_movements').where('product_id', 'not in', productIds).execute();
      await trx.deleteFrom('products').where('id', 'not in', productIds).execute();
      await trx
        .insertInto('products')
        .values(products.map((p) => demoProductRow(p, at)))
        .onConflict((oc) =>
          oc.column('id').doUpdateSet((eb) => ({
            sku: eb.ref('excluded.sku'),
            barcodes: eb.ref('excluded.barcodes'),
            name: eb.ref('excluded.name'),
            price: eb.ref('excluded.price'),
            tax_rate: eb.ref('excluded.tax_rate'),
            category: eb.ref('excluded.category'),
            tracks_stock: true,
            blocked_reason: null,
            updated_at: eb.ref('excluded.updated_at'),
          })),
        )
        .execute();
      await setStockMany(trx, {
        branchId: DEMO_BRANCH_ID,
        items: products.map((p) => ({ productId: p.id, quantity: p.stock })),
        reason: 'inventory_count',
        notes: 'Reinicio parcial de la demo',
        now: at,
      });
      // Los clientes de visitantes sin movimientos ni reservas afuera; con cuenta corriente quedan (su
      // libro sale de ventas que se conservan, y la base no deja borrarlos)
      await trx
        .deleteFrom('customers')
        .where('id', 'not in', customerIds)
        .where('id', 'not in', (eb) => eb.selectFrom('account_movements').select('customer_id'))
        .where('id', 'not in', (eb) => eb.selectFrom('account_holds').select('customer_id'))
        .execute();
      // El saldo no se toca: el de un cliente de la semilla que alguien borró sale de su último movimiento
      const lastBalances = await trx
        .selectFrom('account_movements')
        .distinctOn('customer_id')
        .select(['customer_id', 'balance_after'])
        .where('customer_id', 'in', customerIds)
        .orderBy('customer_id')
        .orderBy('created_at', 'desc')
        .orderBy('seq', 'desc')
        .execute();
      const lastBalance = new Map(lastBalances.map((row) => [row.customer_id, row.balance_after]));
      await trx
        .insertInto('customers')
        .values(
          customers.map((c) => ({
            id: c.id,
            name: c.name,
            document: c.document ?? null,
            phone: c.phone ?? null,
            credit_limit: c.creditLimit,
            margin: c.margin,
            balance: lastBalance.get(c.id) ?? c.balance,
            unrestricted: c.unrestricted === true,
            blocked_reason: null,
            created_at: at,
            updated_at: at,
          })),
        )
        .onConflict((oc) =>
          oc.column('id').doUpdateSet((eb) => ({
            name: eb.ref('excluded.name'),
            document: eb.ref('excluded.document'),
            phone: eb.ref('excluded.phone'),
            credit_limit: eb.ref('excluded.credit_limit'),
            margin: eb.ref('excluded.margin'),
            unrestricted: eb.ref('excluded.unrestricted'),
            blocked_reason: null,
            updated_at: eb.ref('excluded.updated_at'),
          })),
        )
        .execute();
      await trx
        .updateTable('discrepancies')
        .set({ resolved_at: at, resolution: 'dismissed', resolved_by: 'system', note: 'Reinicio parcial de la demo' })
        .where('resolved_at', 'is', null)
        .execute();
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
    const sales = await this.deps.tenantManager
      .forTenant(r.tenant_id)
      .selectFrom('sales')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('day', '=', today)
      .where('voids_sale_id', 'is', null)
      .executeTakeFirstOrThrow();
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
      const seed = demoSeedProducts(template);
      const db = this.deps.tenantManager.forTenant(row.tenant_id);
      // Solo los que siguen en el catálogo: un producto borrado no se repone
      const current = await db
        .selectFrom('stock as s')
        .innerJoin('products as p', 'p.id', 's.product_id')
        .select(['s.product_id', 's.quantity'])
        .where('s.branch_id', '=', DEMO_BRANCH_ID)
        .where('s.product_id', 'in', seed.map((p) => p.id))
        .execute();
      const quantity = new Map(current.map((r) => [r.product_id, r.quantity]));
      const low = seed.filter((p) => {
        const now = quantity.get(p.id);
        return now !== undefined && now < p.stock / 4;
      });
      if (low.length === 0) continue;
      await setStockMany(db, {
        branchId: DEMO_BRANCH_ID,
        items: low.map((p) => ({ productId: p.id, quantity: p.stock })),
        reason: 'restock',
        notes: 'Reposición automática',
        now: at,
      });
      restocked += low.length;
    }
    return restocked;
  }
}

/**
 * Las tablas que vacía el reinicio total: todas las del manifiesto (`schema_migrations` no está),
 * con las que tienen referencias de otras (`branches`, `customers`) al final.
 */
const REFERENCED_TABLES: ReadonlySet<string> = new Set(['branches', 'customers']);
const TENANT_TABLE_NAMES = Object.keys(TENANT_TABLES) as (keyof typeof TENANT_TABLES)[];
const TABLES_TO_EMPTY = [
  ...TENANT_TABLE_NAMES.filter((table) => !REFERENCED_TABLES.has(table)),
  ...TENANT_TABLE_NAMES.filter((table) => REFERENCED_TABLES.has(table)),
];
